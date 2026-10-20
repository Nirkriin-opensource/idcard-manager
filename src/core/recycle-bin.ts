import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type pg from "pg";
import { z } from "zod";
import { audit, tenant, type Actor } from "./auth.ts";
import { AppError } from "./errors.ts";
import { retentionLock } from "./retention-lock.ts";
import { bulkRecords } from "./bulk-records.ts";
import { storagePath } from "./storage.ts";

const kindSchema = z.enum(["people", "photos"]);
type Kind = z.infer<typeof kindSchema>;
const sorted = (values: string[]) => [...new Set(values)].sort();
async function manifest(
  c: pg.PoolClient,
  org: string,
  kind: Kind,
  ids: string[],
) {
  const rows = (
    await c.query(
      kind === "people"
        ? "SELECT id,external_id,deleted_at FROM people WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NOT NULL ORDER BY id"
        : "SELECT id,deleted_at FROM assets WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NOT NULL AND kind='PHOTO' AND NOT collection_private ORDER BY id",
      [org, ids],
    )
  ).rows;
  if (rows.length !== ids.length)
    throw new AppError(
      409,
      "The recycle bin selection changed.",
      "Refresh and select deleted records again.",
    );
  const people = kind === "people" ? sorted(ids) : [];
  const photos = kind === "photos" ? sorted(ids) : [];
  const queryIds = async (sql: string, values: unknown[]) =>
    sorted((await c.query(sql, values)).rows.map((r) => r.id));
  const cards = await queryIds(
    "SELECT id FROM cards WHERE organization_id=$1 AND person_id=ANY($2::uuid[])",
    [org, people],
  );
  // Do not remove a replacement chain belonging to a person outside the selection.
  if (
    (
      await c.query(
        "SELECT id FROM cards WHERE organization_id=$1 AND supersedes_id=ANY($2::uuid[]) AND NOT(id=ANY($2::uuid[])) LIMIT 1",
        [org, cards],
      )
    ).rowCount
  )
    throw new AppError(
      409,
      "Another card depends on this card history.",
      "Review the replacement chain before purging.",
    );
  const renders = await queryIds(
    "SELECT id FROM card_renders WHERE organization_id=$1 AND (card_id=ANY($2::uuid[]) OR EXISTS(SELECT 1 FROM unnest($3::uuid[]) p WHERE snapshot::text LIKE '%'||p::text||'%'))",
    [org, cards, photos],
  );
  const jobs = await queryIds(
    "SELECT DISTINCT job_id id FROM generation_items WHERE organization_id=$1 AND (person_id=ANY($2::uuid[]) OR EXISTS(SELECT 1 FROM unnest($3::uuid[]) p WHERE snapshot::text LIKE '%'||p::text||'%'))",
    [org, people, photos],
  );
  const exports = await queryIds(
    "SELECT id FROM export_jobs WHERE organization_id=$1 AND render_ids ?| $2::text[]",
    [org, renders],
  );
  const submissions = await queryIds(
    "SELECT id FROM collection_submissions WHERE organization_id=$1 AND person_id=ANY($2::uuid[])",
    [org, people],
  );
  const assets = sorted([
    ...photos,
    ...(
      await c.query(
        `SELECT asset_id id FROM person_assets WHERE organization_id=$1 AND person_id=ANY($2::uuid[])
         UNION SELECT front_asset_id FROM card_renders WHERE organization_id=$1 AND id=ANY($3::uuid[])
         UNION SELECT back_asset_id FROM card_renders WHERE organization_id=$1 AND id=ANY($3::uuid[]) AND back_asset_id IS NOT NULL
         UNION SELECT value::text::uuid FROM collection_submissions s CROSS JOIN LATERAL jsonb_each_text(s.assets) WHERE s.organization_id=$1 AND s.id=ANY($4::uuid[])
         UNION SELECT a.id FROM assets a WHERE a.organization_id=$1 AND a.kind IN ('PHOTO','SIGNATURE') AND
          (EXISTS(SELECT 1 FROM people p WHERE p.organization_id=$1 AND p.id=ANY($2::uuid[]) AND p.custom_fields::text LIKE '%'||a.id::text||'%')
           OR EXISTS(SELECT 1 FROM card_renders r WHERE r.organization_id=$1 AND r.id=ANY($3::uuid[]) AND r.card_id IN (SELECT id FROM cards WHERE organization_id=$1 AND person_id=ANY($2::uuid[])) AND r.snapshot::text LIKE '%'||a.id::text||'%')
           OR EXISTS(SELECT 1 FROM generation_items g WHERE g.organization_id=$1 AND g.person_id=ANY($2::uuid[]) AND g.snapshot::text LIKE '%'||a.id::text||'%'))`,
        [org, people, renders, submissions],
      )
    ).rows.map((r) => r.id),
  ]);
  // References left after the planned deletion protect shared assets, including immutable templates and live form responses.
  const deletableAssets = await queryIds(
    `SELECT a.id FROM assets a WHERE a.organization_id=$1 AND a.id=ANY($2::uuid[]) AND a.kind IN ('PHOTO','SIGNATURE','RENDER')
     AND NOT EXISTS(SELECT 1 FROM person_assets p WHERE p.asset_id=a.id AND NOT(p.person_id=ANY($3::uuid[])))
     AND NOT EXISTS(SELECT 1 FROM people p WHERE p.organization_id=$1 AND NOT(p.id=ANY($3::uuid[])) AND p.custom_fields::text LIKE '%'||a.id::text||'%')
     AND NOT EXISTS(SELECT 1 FROM card_renders r WHERE r.organization_id=$1 AND NOT(r.id=ANY($4::uuid[])) AND (r.front_asset_id=a.id OR r.back_asset_id=a.id OR r.snapshot::text LIKE '%'||a.id::text||'%'))
     AND NOT EXISTS(SELECT 1 FROM generation_items g WHERE g.organization_id=$1 AND NOT(g.job_id=ANY($5::uuid[])) AND g.snapshot::text LIKE '%'||a.id::text||'%')
     AND NOT EXISTS(SELECT 1 FROM generation_jobs g WHERE g.organization_id=$1 AND NOT(g.id=ANY($5::uuid[])) AND g.style_snapshot::text LIKE '%'||a.id::text||'%')
     AND NOT EXISTS(SELECT 1 FROM template_versions v WHERE v.organization_id=$1 AND v.document::text LIKE '%'||a.id::text||'%')
     AND NOT EXISTS(SELECT 1 FROM organizations o WHERE o.id=$1 AND (o.card_profiles::text LIKE '%'||a.id::text||'%' OR o.appearance::text LIKE '%'||a.id::text||'%'))
     AND NOT EXISTS(SELECT 1 FROM app_branding b WHERE b.logo_asset_id=a.id)
     AND NOT EXISTS(SELECT 1 FROM locations l WHERE l.map_asset_id=a.id)
     AND NOT EXISTS(SELECT 1 FROM collection_submissions s WHERE s.organization_id=$1 AND NOT(s.id=ANY($6::uuid[])) AND s.assets::text LIKE '%'||a.id::text||'%')`,
    [org, assets, people, renders, jobs, submissions],
  );
  if (photos.some((id) => !deletableAssets.includes(id)))
    throw new AppError(
      409,
      "A selected photo is still used by another record or template.",
      "Restore the photo or remove its remaining references before permanent deletion.",
    );
  const imports = (
    await c.query(
      "SELECT batch_id,row_number FROM import_rows WHERE organization_id=$1 AND normalized->>'external_id'=ANY($2::text[]) ORDER BY batch_id,row_number",
      [org, rows.map((r) => r.external_id).filter(Boolean)],
    )
  ).rows;
  const events = await queryIds(
    "SELECT id FROM card_events WHERE organization_id=$1 AND card_id=ANY($2::uuid[])",
    [org, cards],
  );
  const generationItems = await queryIds(
    "SELECT id FROM generation_items WHERE organization_id=$1 AND job_id=ANY($2::uuid[])",
    [org, jobs],
  );
  return {
    kind,
    ids: sorted(ids),
    deleted: rows.map((r) => [r.id, new Date(r.deleted_at).toISOString()]),
    people,
    photos,
    cards,
    renders,
    jobs,
    exports,
    submissions,
    assets: deletableAssets,
    sharedAssets: assets.filter((id) => !deletableAssets.includes(id)),
    imports,
    events,
    generationItems,
  };
}

export async function recycleBinRoute(
  req: Request,
  actor: Actor,
  org: string,
  body: () => Promise<unknown>,
) {
  if (actor.tokenOrg)
    throw new AppError(
      403,
      "Recycle bin requires a signed-in administrator.",
      "Sign in as an Organization Admin or Super Admin.",
    );
  return tenant(actor, org, "admin", async (c) => {
    const reply = (data: unknown) =>
      Response.json(data, { headers: { "Cache-Control": "no-store" } });
    const url = new URL(req.url);
    if (req.method === "GET") {
      const kind = kindSchema.parse(url.searchParams.get("kind") || "people");
      const offset = z.coerce
        .number()
        .int()
        .min(0)
        .max(10000000)
        .parse(url.searchParams.get("offset") || 0);
      const sql =
        kind === "people"
          ? "SELECT id,name,external_id,deleted_at FROM people WHERE organization_id=$1 AND deleted_at IS NOT NULL"
          : "SELECT id,original_name name,deleted_at FROM assets WHERE organization_id=$1 AND deleted_at IS NOT NULL AND kind='PHOTO' AND NOT collection_private";
      return reply({
        items: (
          await c.query(
            sql + " ORDER BY deleted_at DESC,id LIMIT 100 OFFSET $2",
            [org, offset],
          )
        ).rows,
        total: Number(
          (await c.query(`SELECT count(*) FROM (${sql}) selected`, [org]))
            .rows[0].count,
        ),
      });
    }
    if (req.method !== "POST")
      throw new AppError(
        405,
        "Method not supported.",
        "Use a recycle bin preview and confirmation.",
      );
    await retentionLock(c, org, true);
    const raw = await body();
    const action = z
      .object({ action: z.enum(["restore", "preview", "confirm"]) })
      .parse(raw).action;
    if (action === "restore")
      return reply(
        await bulkRecords(c, org, actor, {
          ...z
            .object({
              kind: kindSchema,
              ids: z.array(z.uuid()).min(1).max(1000),
            })
            .parse(raw),
          action: "restore",
        }),
      );
    const idle = async () => {
      if (
        (
          await c.query(
            "SELECT 1 FROM generation_jobs WHERE organization_id=$1 AND status IN ('QUEUED','RUNNING') UNION ALL SELECT 1 FROM export_jobs WHERE organization_id=$1 AND status IN ('QUEUED','RUNNING') LIMIT 1",
            [org],
          )
        ).rowCount
      )
        throw new AppError(
          409,
          "Generation or export jobs are still active.",
          "Wait for jobs to finish or cancel generation before purging.",
        );
    };
    await idle();
    if (action === "preview") {
      const d = z
        .object({
          kind: kindSchema,
          ids: z.array(z.uuid()).min(1).max(1000).optional(),
          all: z.boolean().optional(),
        })
        .parse(raw);
      if (Boolean(d.ids) === Boolean(d.all))
        throw new AppError(
          422,
          "Choose selected records or empty this category.",
          "Select records, or use Empty recycle bin category.",
        );
      const ids = d.ids
        ? sorted(d.ids)
        : (
            await c.query(
              d.kind === "people"
                ? "SELECT id FROM people WHERE organization_id=$1 AND deleted_at IS NOT NULL ORDER BY deleted_at,id LIMIT 1001"
                : "SELECT id FROM assets WHERE organization_id=$1 AND deleted_at IS NOT NULL AND kind='PHOTO' AND NOT collection_private ORDER BY deleted_at,id LIMIT 1001",
              [org],
            )
          ).rows.map((r) => r.id);
      const moreAvailable = ids.length > 1000;
      const m = await manifest(c, org, d.kind, ids.slice(0, 1000));
      const summary = {
        people: m.people.length,
        photos: m.photos.length,
        cards: m.cards.length,
        renders: m.renders.length,
        cardEvents: m.events.length,
        generationJobs: m.jobs.length,
        generationItems: m.generationItems.length,
        exportJobs: m.exports.length,
        submissions: m.submissions.length,
        importRows: m.imports.length,
        removedAssets: m.assets.length,
        sharedAssetsRetained: m.sharedAssets.length,
      };
      const id = randomUUID();
      const row = (
        await c.query(
          "INSERT INTO purge_requests(id,organization_id,actor_id,kind,before_date,manifest,summary) VALUES($1,$2,$3,'recycle',now(),$4,$5) RETURNING expires_at",
          [id, org, actor.id, JSON.stringify(m), JSON.stringify(summary)],
        )
      ).rows[0];
      return reply({ id, summary, expiresAt: row.expires_at, moreAvailable });
    }
    const d = z
      .object({ id: z.uuid(), confirmation: z.literal("PURGE") })
      .parse(raw);
    const request = (
      await c.query(
        "SELECT * FROM purge_requests WHERE organization_id=$1 AND actor_id=$2 AND id=$3 AND kind='recycle' FOR UPDATE",
        [org, actor.id, d.id],
      )
    ).rows[0];
    if (!request)
      throw new AppError(
        404,
        "Purge preview not found.",
        "Create a preview with your own administrator account.",
      );
    if (request.status === "COMPLETED")
      return reply({ completed: true, summary: request.summary });
    if (new Date(request.expires_at).getTime() <= Date.now())
      throw new AppError(
        409,
        "Purge preview expired.",
        "Create a fresh preview.",
      );
    const m = request.manifest as Awaited<ReturnType<typeof manifest>>;
    const current = await manifest(c, org, m.kind, m.ids);
    if (!isDeepStrictEqual(current, m))
      throw new AppError(
        409,
        "Related data changed after the preview.",
        "Create a fresh preview before purging anything.",
      );
    await c.query("UPDATE purge_requests SET status='RUNNING' WHERE id=$1", [
      d.id,
    ]);
    await c.query("SELECT set_config('app.purge_request',$1,true)", [d.id]);
    const queue = async (key: string | null) => {
      if (key) {
        storagePath(key);
        await c.query(
          "INSERT INTO purge_files(id,organization_id,request_id,storage_key) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,storage_key) DO NOTHING",
          [randomUUID(), org, d.id, key],
        );
      }
    };
    for (const r of (
      await c.query(
        "DELETE FROM export_jobs WHERE organization_id=$1 AND id=ANY($2::uuid[]) RETURNING storage_key",
        [org, m.exports],
      )
    ).rows)
      await queue(r.storage_key);
    await c.query(
      "DELETE FROM generation_items WHERE organization_id=$1 AND job_id=ANY($2::uuid[])",
      [org, m.jobs],
    );
    await c.query(
      "DELETE FROM generation_jobs WHERE organization_id=$1 AND id=ANY($2::uuid[])",
      [org, m.jobs],
    );
    await c.query(
      "DELETE FROM card_renders WHERE organization_id=$1 AND id=ANY($2::uuid[])",
      [org, m.renders],
    );
    await c.query(
      "DELETE FROM card_events WHERE organization_id=$1 AND card_id=ANY($2::uuid[])",
      [org, m.cards],
    );
    await c.query(
      "DELETE FROM verification_lookup WHERE organization_id=$1 AND token_hash IN (SELECT verify_hash FROM cards WHERE organization_id=$1 AND id=ANY($2::uuid[]))",
      [org, m.cards],
    );
    // All members of any selected replacement chain are removed together.
    await c.query(
      "UPDATE cards SET supersedes_id=NULL WHERE organization_id=$1 AND id=ANY($2::uuid[])",
      [org, m.cards],
    );
    await c.query(
      "DELETE FROM cards WHERE organization_id=$1 AND id=ANY($2::uuid[])",
      [org, m.cards],
    );
    await c.query(
      "DELETE FROM collection_submissions WHERE organization_id=$1 AND id=ANY($2::uuid[])",
      [org, m.submissions],
    );
    for (const r of m.imports)
      await c.query(
        "DELETE FROM import_rows WHERE organization_id=$1 AND batch_id=$2 AND row_number=$3",
        [org, r.batch_id, r.row_number],
      );
    await c.query(
      "DELETE FROM person_assets WHERE organization_id=$1 AND person_id=ANY($2::uuid[])",
      [org, m.people],
    );
    await c.query(
      "DELETE FROM person_units WHERE organization_id=$1 AND person_id=ANY($2::uuid[])",
      [org, m.people],
    );
    await c.query(
      "DELETE FROM people WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NOT NULL",
      [org, m.people],
    );
    for (const a of (
      await c.query(
        "DELETE FROM assets WHERE organization_id=$1 AND id=ANY($2::uuid[]) RETURNING storage_key,thumbnail_key",
        [org, m.assets],
      )
    ).rows) {
      await queue(a.storage_key);
      await queue(a.thumbnail_key);
    }
    await c.query(
      "UPDATE purge_requests SET status='COMPLETED',completed_at=now() WHERE id=$1",
      [d.id],
    );
    await audit(c, actor, org, "retention.purge", d.id);
    return reply({
      completed: true,
      summary: request.summary,
      cleanupPending: true,
    });
  });
}
