import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import type pg from "pg";
import { z } from "zod";
import { audit, tenant, type Actor } from "./auth.ts";
import { db, transaction } from "./db.ts";
import { AppError } from "./errors.ts";
import { storagePath } from "./storage.ts";
import { retentionLock } from "./retention-lock.ts";
const selection = z.object({
  kind: z.enum(["audit", "renders", "jobs"]),
  before: z.iso.datetime(),
});
type Manifest = { ids: string[]; exports: string[]; generation: string[] };
async function idle(c: pg.PoolClient, org: string) {
  const q = await c.query(
    "SELECT EXISTS(SELECT 1 FROM generation_jobs WHERE organization_id=$1 AND status IN ('QUEUED','RUNNING')) OR EXISTS(SELECT 1 FROM export_jobs WHERE organization_id=$1 AND status IN ('QUEUED','RUNNING')) busy",
    [org],
  );
  if (q.rows[0].busy)
    throw new AppError(
      409,
      "Generation or export jobs are still active.",
      "Wait for those jobs to finish before purging renders or job logs.",
    );
}
async function relatedExports(c: pg.PoolClient, org: string, ids: string[]) {
  return (
    await c.query(
      "SELECT id FROM export_jobs WHERE organization_id=$1 AND render_ids ?| $2::text[] ORDER BY id LIMIT 1001",
      [org, ids],
    )
  ).rows.map((r) => r.id) as string[];
}
function bound(ids: string[]) {
  if (ids.length > 1000)
    throw new AppError(
      422,
      "More than 1,000 related exports match these renders.",
      "Purge completed job logs first, then preview the render purge again.",
    );
  return ids;
}
export async function retentionRoute(
  req: Request,
  a: Actor,
  org: string,
  body: () => Promise<unknown>,
) {
  if (a.tokenOrg)
    throw new AppError(
      403,
      "Purge requires a signed-in administrator.",
      "Sign in as an Organization Admin or Super Admin.",
    );
  return tenant(a, org, "admin", async (c) => {
    const reply = (data: unknown) =>
      Response.json(data, { headers: { "Cache-Control": "no-store" } });
    if (req.method === "GET")
      return reply({
        receipts: (
          await c.query(
            "SELECT id,kind,before_date,summary,actor_id,completed_at FROM purge_requests WHERE organization_id=$1 AND status='COMPLETED' ORDER BY completed_at DESC LIMIT 20",
            [org],
          )
        ).rows,
        pendingFiles: Number(
          (
            await c.query(
              "SELECT count(*) FROM purge_files WHERE organization_id=$1",
              [org],
            )
          ).rows[0].count,
        ),
      });
    if (req.method !== "POST")
      throw new AppError(
        405,
        "Method not supported.",
        "Use a purge preview and confirmation.",
      );
    const raw = await body(),
      action = z
        .object({ action: z.enum(["preview", "confirm"]) })
        .parse(raw).action;
    await retentionLock(c, org, true);
    if (action === "preview") {
      const d = selection.parse(raw);
      if (new Date(d.before).getTime() > Date.now())
        throw new AppError(
          422,
          "Cutoff must be in the past.",
          "Choose an earlier date.",
        );
      if (d.kind !== "audit") await idle(c, org);
      const m: Manifest = { ids: [], exports: [], generation: [] };
      let moreAvailable = false;
      const batch = (ids: string[]) => {
        moreAvailable ||= ids.length > 1000;
        return ids.slice(0, 1000);
      };
      if (d.kind === "audit")
        m.ids = batch(
          (
            await c.query(
              "SELECT id FROM audit_events WHERE organization_id=$1 AND created_at<$2 AND action<>'retention.purge' ORDER BY created_at,id LIMIT 1001",
              [org, d.before],
            )
          ).rows.map((r) => r.id),
        );
      if (d.kind === "renders") {
        m.ids = batch(
          (
            await c.query(
              "SELECT id FROM card_renders WHERE organization_id=$1 AND created_at<$2 ORDER BY created_at,id LIMIT 1001",
              [org, d.before],
            )
          ).rows.map((r) => r.id),
        );
        m.exports = bound(await relatedExports(c, org, m.ids));
      }
      if (d.kind === "jobs") {
        m.generation = batch(
          (
            await c.query(
              "SELECT id FROM generation_jobs WHERE organization_id=$1 AND created_at<$2 AND status IN ('COMPLETED','CANCELLED') ORDER BY created_at,id LIMIT 1001",
              [org, d.before],
            )
          ).rows.map((r) => r.id),
        );
        m.exports = batch(
          (
            await c.query(
              "SELECT id FROM export_jobs WHERE organization_id=$1 AND created_at<$2 AND status='COMPLETED' ORDER BY created_at,id LIMIT 1001",
              [org, d.before],
            )
          ).rows.map((r) => r.id),
        );
      }
      const assets =
        d.kind === "renders"
          ? (
              await c.query(
                "SELECT count(DISTINCT a.id) count FROM assets a JOIN card_renders r ON a.id IN (r.front_asset_id,r.back_asset_id) WHERE r.organization_id=$1 AND r.id=ANY($2::uuid[])",
                [org, m.ids],
              )
            ).rows[0].count
          : 0;
      const files = (
        await c.query(
          "SELECT count(*) FROM export_jobs WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND storage_key IS NOT NULL",
          [org, m.exports],
        )
      ).rows[0].count;
      const summary = {
        auditEntries: d.kind === "audit" ? m.ids.length : 0,
        renders: d.kind === "renders" ? m.ids.length : 0,
        renderAssets: Number(assets),
        exportJobs: m.exports.length,
        exportFiles: Number(files),
        generationJobs: m.generation.length,
      };
      const id = randomUUID();
      const row = (
        await c.query(
          "INSERT INTO purge_requests(id,organization_id,actor_id,kind,before_date,manifest,summary) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING expires_at",
          [
            id,
            org,
            a.id,
            d.kind,
            d.before,
            JSON.stringify(m),
            JSON.stringify(summary),
          ],
        )
      ).rows[0];
      return reply({
        id,
        kind: d.kind,
        before: d.before,
        summary,
        expiresAt: row.expires_at,
        moreAvailable,
      });
    }
    const d = z
      .object({ id: z.uuid(), confirmation: z.literal("PURGE") })
      .parse(raw);
    const request = (
      await c.query(
        "SELECT * FROM purge_requests WHERE organization_id=$1 AND id=$2 AND actor_id=$3 FOR UPDATE",
        [org, d.id, a.id],
      )
    ).rows[0];
    if (!request)
      throw new AppError(
        404,
        "Purge preview not found.",
        "Create a preview in this organization with your own admin account.",
      );
    if (!["audit", "renders", "jobs"].includes(request.kind))
      throw new AppError(
        409,
        "Use the recycle bin confirmation for this preview.",
        "Return to Recycle bin and preview again.",
      );
    if (request.status === "COMPLETED")
      return reply({ completed: true, summary: request.summary });
    if (new Date(request.expires_at).getTime() < Date.now())
      throw new AppError(
        409,
        "Purge preview expired.",
        "Create a fresh preview.",
      );
    const m = request.manifest as Manifest;
    if (request.kind !== "audit") await idle(c, org);
    if (request.kind === "renders") {
      const current = await relatedExports(c, org, m.ids);
      if (current.sort().join() != [...m.exports].sort().join())
        throw new AppError(
          409,
          "Related exports changed since the preview.",
          "Create a fresh preview before deleting anything.",
        );
    }
    const table =
      request.kind === "audit"
        ? "audit_events"
        : request.kind === "renders"
          ? "card_renders"
          : "generation_jobs";
    const ids = request.kind === "jobs" ? m.generation : m.ids;
    if (
      Number(
        (
          await c.query(
            "SELECT count(*) FROM export_jobs WHERE organization_id=$1 AND id=ANY($2::uuid[])",
            [org, m.exports],
          )
        ).rows[0].count,
      ) !== m.exports.length
    )
      throw new AppError(
        409,
        "The selected export jobs changed since preview.",
        "Create a fresh preview.",
      );
    if (
      Number(
        (
          await c.query(
            `SELECT count(*) FROM ${table} WHERE organization_id=$1 AND id=ANY($2::uuid[])`,
            [org, ids],
          )
        ).rows[0].count,
      ) !== ids.length
    )
      throw new AppError(
        409,
        "The selected records changed since preview.",
        "Create a fresh preview.",
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
    for (const row of (
      await c.query(
        "DELETE FROM export_jobs WHERE organization_id=$1 AND id=ANY($2::uuid[]) RETURNING storage_key",
        [org, m.exports],
      )
    ).rows)
      await queue(row.storage_key);
    if (request.kind === "audit")
      await c.query(
        "DELETE FROM audit_events WHERE organization_id=$1 AND id=ANY($2::uuid[])",
        [org, m.ids],
      );
    if (request.kind === "jobs") {
      await c.query(
        "DELETE FROM generation_items WHERE organization_id=$1 AND job_id=ANY($2::uuid[])",
        [org, m.generation],
      );
      await c.query(
        "DELETE FROM generation_jobs WHERE organization_id=$1 AND id=ANY($2::uuid[])",
        [org, m.generation],
      );
    }
    if (request.kind === "renders") {
      const assetIds = (
        await c.query(
          "DELETE FROM card_renders WHERE organization_id=$1 AND id=ANY($2::uuid[]) RETURNING front_asset_id,back_asset_id",
          [org, m.ids],
        )
      ).rows
        .flatMap((r) => [r.front_asset_id, r.back_asset_id])
        .filter(Boolean);
      // Delete only unreferenced renderer output; uploaded photos, signatures and logos are retained.
      const assets = await c.query(
        "DELETE FROM assets a WHERE a.organization_id=$1 AND a.id=ANY($2::uuid[]) AND a.kind='RENDER' AND NOT EXISTS(SELECT 1 FROM card_renders r WHERE r.front_asset_id=a.id OR r.back_asset_id=a.id) AND NOT EXISTS(SELECT 1 FROM person_assets p WHERE p.asset_id=a.id) AND NOT EXISTS(SELECT 1 FROM locations l WHERE l.map_asset_id=a.id) AND NOT EXISTS(SELECT 1 FROM app_branding b WHERE b.logo_asset_id=a.id) AND NOT EXISTS(SELECT 1 FROM template_versions v WHERE v.organization_id=a.organization_id AND v.document::text LIKE '%'||a.id::text||'%') AND NOT EXISTS(SELECT 1 FROM organizations o WHERE o.id=a.organization_id AND o.card_profiles::text LIKE '%'||a.id::text||'%') AND NOT EXISTS(SELECT 1 FROM card_renders r WHERE r.organization_id=a.organization_id AND r.snapshot::text LIKE '%'||a.id::text||'%') RETURNING storage_key,thumbnail_key",
        [org, assetIds],
      );
      for (const asset of assets.rows) {
        await queue(asset.storage_key);
        await queue(asset.thumbnail_key);
      }
    }
    await c.query(
      "UPDATE purge_requests SET status='COMPLETED',completed_at=now() WHERE id=$1",
      [d.id],
    );
    await audit(c, a, org, "retention.purge", d.id);
    return reply({
      completed: true,
      summary: request.summary,
      cleanupPending: true,
    });
  });
}
export async function cleanupPurgeFiles() {
  for (const org of (await db().query("SELECT id FROM organizations")).rows) {
    await transaction(async (c) => {
      const rows = await c.query(
        "SELECT id,storage_key FROM purge_files WHERE organization_id=$1 ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED",
        [org.id],
      );
      for (const row of rows.rows) {
        try {
          await unlink(storagePath(row.storage_key));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") continue;
        }
        await c.query("DELETE FROM purge_files WHERE id=$1", [row.id]);
      }
    }, org.id);
  }
}
