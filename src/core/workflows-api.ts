import { randomUUID, randomBytes } from "node:crypto";
import { getTimeSettings } from "./time-settings.ts";
import { retentionLock } from "./retention-lock.ts";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type pg from "pg";
import { z } from "zod";
import { tenant, audit, digest, type Actor } from "./auth.ts";
import { requireRow, generateCard } from "./cards.ts";
import { exportSchema, createExport } from "./exports.ts";
import { enqueueGeneration } from "./jobs.ts";
import { storagePath } from "./storage.ts";
import { AppError } from "./errors.ts";
import { defaultTemplate } from "./appearance.ts";
import { effectiveStatus } from "./verification.ts";
const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const filterSchema = z.object({
  q: z.string().max(200).optional(),
  status: z.string().max(30).optional(),
  unit_id: z.uuid().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  batch_id: z.uuid().optional(),
  card_type: z.enum(["staff", "student", "visitor", "professional"]).optional(),
});
const selection = z.object({
  person_ids: z.array(z.uuid()).min(1).max(10000).optional(),
  template_id: z.uuid().optional(),
  theme_key: z.string().max(40).optional(),
  filters: filterSchema.default({}),
  request_key: z.string().min(8).max(100),
});
export async function selectedPeople(
  c: pg.PoolClient,
  org: string,
  filters: z.infer<typeof filterSchema>,
) {
  const values: unknown[] = [org];
  const where = ["p.organization_id=$1", "p.deleted_at IS NULL"];
  if (filters.card_type) {
    values.push(filters.card_type);
    where.push(`p.custom_fields->>'card_type'=$${values.length}`);
  }
  if (filters.q) {
    values.push(filters.q);
    where.push(
      `(p.name ILIKE '%'||$${values.length}||'%' OR p.external_id ILIKE '%'||$${values.length}||'%')`,
    );
  }
  if (filters.unit_id) {
    values.push(filters.unit_id);
    where.push(
      `EXISTS(SELECT 1 FROM person_units pu WHERE pu.person_id=p.id AND pu.unit_id=$${values.length})`,
    );
  }
  if (filters.status) {
    values.push(filters.status);
    where.push(`p.status=$${values.length}`);
  }
  return (
    await c.query(
      `SELECT p.id FROM people p WHERE ${where.join(" AND ")} ORDER BY p.id LIMIT 10001`,
      values,
    )
  ).rows.map((r) => r.id);
}
async function selectedRenders(
  c: pg.PoolClient,
  org: string,
  filters: z.infer<typeof filterSchema>,
) {
  const values: unknown[] = [org],
    where = ["ca.organization_id=$1"];
  if (filters.card_type) {
    values.push(filters.card_type);
    where.push(`p.custom_fields->>'card_type'=$${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    where.push(`ca.status=$${values.length}`);
  }
  if (filters.q) {
    values.push(filters.q);
    where.push(
      `(p.name ILIKE '%'||$${values.length}||'%' OR p.external_id ILIKE '%'||$${values.length}||'%' OR ca.number ILIKE '%'||$${values.length}||'%')`,
    );
  }
  if (filters.unit_id) {
    values.push(filters.unit_id);
    where.push(
      `EXISTS(SELECT 1 FROM person_units pu WHERE pu.person_id=p.id AND pu.unit_id=$${values.length})`,
    );
  }
  for (const [key, operator] of [
    ["from", ">="],
    ["to", "<="],
  ] as const)
    if (filters[key]) {
      values.push(filters[key]);
      where.push(`ca.created_at${operator}$${values.length}::timestamptz`);
    }
  if (filters.batch_id) {
    values.push(filters.batch_id);
    where.push(
      `EXISTS(SELECT 1 FROM generation_items gi WHERE gi.card_id=ca.id AND gi.job_id=$${values.length})`,
    );
  }
  return (
    await c.query(
      `SELECT DISTINCT ON (ca.id) r.id,ca.id card_id FROM cards ca JOIN people p ON p.id=ca.person_id JOIN card_renders r ON r.card_id=ca.id WHERE ${where.join(" AND ")} ORDER BY ca.id,r.created_at DESC LIMIT 10001`,
      values,
    )
  ).rows.map((r) => r.id);
}
export async function advancedRoute(
  req: Request,
  p: string[],
  a: Actor,
  read: () => Promise<any>,
): Promise<Response | undefined> {
  if (p[0] !== "orgs" || p.length < 3) return;
  const org = z.uuid().parse(p[1]),
    resource = p[2],
    id = p[3] ? z.uuid().parse(p[3]) : undefined,
    url = new URL(req.url),
    method = req.method;
  const supported = [
    "generation",
    "exports",
    "settings",
    "locations",
    "print-profiles",
    "dashboard",
    "reports",
    "audit",
    "tokens",
  ];
  const cardAction =
    resource === "cards" &&
    id &&
    [
      "history",
      "state",
      "extend",
      "replace",
      "reissue",
      "renew",
      "image",
      "pdf",
    ].includes(p[4]);
  const renderImage = resource === "renders" && id && p[4] === "image";
  if (!supported.includes(resource) && !cardAction && !renderImage) return;
  const permission = ["settings", "tokens", "audit"].includes(resource)
    ? "admin"
    : method === "GET"
      ? "read"
      : resource === "locations"
        ? "admin"
        : resource === "print-profiles"
          ? "admin"
          : "generate";
  return tenant(a, org, permission, async (c) => {
    if (method !== "GET") await retentionLock(c, org);
    if (resource === "settings") {
      await c.query(
        "INSERT INTO organization_settings(organization_id) VALUES($1) ON CONFLICT DO NOTHING",
        [org],
      );
      if (method === "GET")
        return reply(
          await requireRow(
            c,
            "SELECT * FROM organization_settings WHERE organization_id=$1",
            [org],
          ),
        );
      if (method === "PUT") {
        const d = z
          .object({
            verification_fields: z.array(z.string().max(64)).max(100),
            location_enabled: z.boolean(),
          })
          .parse(await read());
        const allowed = (
          await c.query(
            "SELECT key FROM field_definitions WHERE organization_id=$1 AND NOT private",
            [org],
          )
        ).rows.map((r) => r.key);
        if (
          d.verification_fields.some(
            (k) =>
              !["name", "external_id", "designation", ...allowed].includes(k),
          )
        )
          throw new AppError(
            422,
            "Verification includes a private or unknown field.",
            "Only select non-private custom fields or name, organization ID and designation.",
          );
        await c.query(
          "UPDATE organization_settings SET verification_fields=$1,location_enabled=$2 WHERE organization_id=$3",
          [d.verification_fields, d.location_enabled, org],
        );
        await audit(c, a, org, "settings.update");
        return reply({ ok: true });
      }
    }
    if (resource === "generation") {
      if (method === "POST" && !id) {
        const d = selection.parse(await read()),
          ids = d.person_ids || (await selectedPeople(c, org, d.filters));
        if (!ids.length || ids.length > 10000)
          throw new AppError(
            422,
            "Choose 1–10,000 people.",
            "Narrow the filters or select records explicitly.",
          );
        const template =
          d.template_id ||
          (await defaultTemplate(
            c,
            org,
            d.filters.card_type ||
              (
                await requireRow(
                  c,
                  "SELECT custom_fields FROM people WHERE organization_id=$1 AND id=$2",
                  [org, ids[0]],
                )
              ).custom_fields.card_type,
          ));
        const job = await enqueueGeneration(
          c,
          org,
          a,
          template,
          ids,
          d.request_key,
          d.theme_key,
        );
        await audit(c, a, org, "generation.enqueue", job.id);
        return reply(job, 202);
      }
      if (method === "GET") {
        const jobs = (
          await c.query(
            `SELECT j.*,(SELECT count(*) FROM generation_items i WHERE i.job_id=j.id)::int AS total,(SELECT count(*) FROM generation_items i WHERE i.job_id=j.id AND i.status='DONE')::int AS completed,(SELECT count(*) FROM generation_items i WHERE i.job_id=j.id AND i.status='FAILED')::int AS failed FROM generation_jobs j WHERE organization_id=$1 ${id ? "AND id=$2" : ""} ORDER BY created_at DESC LIMIT 50`,
            id ? [org, id] : [org],
          )
        ).rows;
        if (id) {
          if (!jobs.length)
            throw new AppError(404, "Job not found.", "Refresh the job list.");
          return reply({
            ...jobs[0],
            items: (
              await c.query(
                "SELECT id,person_id,card_id,status,error FROM generation_items WHERE job_id=$1 ORDER BY id LIMIT 1000",
                [id],
              )
            ).rows,
          });
        }
        return reply(jobs);
      }
      if (method === "POST" && id) {
        if (p[4] === "cancel")
          await c.query(
            "UPDATE generation_jobs SET status='CANCELLED' WHERE id=$1 AND status IN ('QUEUED','RUNNING')",
            [id],
          );
        else if (p[4] === "retry") {
          await c.query(
            "UPDATE generation_items SET status='PENDING',error=null WHERE job_id=$1 AND status='FAILED'",
            [id],
          );
          await c.query(
            "UPDATE generation_jobs SET status='QUEUED',finished_at=null WHERE id=$1 AND status='FAILED'",
            [id],
          );
        } else
          throw new AppError(
            404,
            "Job action not found.",
            "Use retry or cancel.",
          );
        await audit(c, a, org, "generation." + p[4], id);
        return reply({ ok: true });
      }
    }
    if (resource === "exports") {
      if (method === "POST" && !id) {
        const d = z
            .object({
              render_ids: z.array(z.uuid()).min(1).max(10000).optional(),
              filters: filterSchema.default({}),
              options: exportSchema,
              request_key: z.string().min(8).max(100),
            })
            .parse(await read()),
          ids = d.render_ids || (await selectedRenders(c, org, d.filters));
        if (!ids.length || ids.length > 10000)
          throw new AppError(
            422,
            "Choose 1–10,000 generated cards.",
            "Generate cards first or narrow your filters.",
          );
        for (const rid of ids)
          await requireRow(
            c,
            "SELECT id FROM card_renders WHERE organization_id=$1 AND id=$2",
            [org, rid],
          );
        const old = await c.query(
          "SELECT id FROM export_jobs WHERE organization_id=$1 AND request_key=$2",
          [org, d.request_key],
        );
        if (old.rowCount) return reply(old.rows[0], 202);
        const eid = randomUUID();
        await c.query(
          "INSERT INTO export_jobs(id,organization_id,actor_id,request_key,options,render_ids,total) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            eid,
            org,
            a.id,
            d.request_key,
            JSON.stringify(d.options),
            JSON.stringify(ids),
            ids.length,
          ],
        );
        await audit(c, a, org, "export.enqueue", eid);
        return reply({ id: eid }, 202);
      }
      if (method === "GET" && id && p[4] === "download") {
        const job = await requireRow(
          c,
          "SELECT * FROM export_jobs WHERE organization_id=$1 AND id=$2 AND status='COMPLETED'",
          [org, id],
        );
        await audit(c, a, org, "export.download", id);
        return fileResponse(job.storage_key);
      }
      if (method === "GET")
        return reply(
          (
            await c.query(
              `SELECT id,status,completed,total,error,options,created_at FROM export_jobs WHERE organization_id=$1 ${id ? "AND id=$2" : ""} ORDER BY created_at DESC LIMIT 50`,
              id ? [org, id] : [org],
            )
          ).rows,
        );
      if (method === "POST" && id && p[4] === "retry") {
        await c.query(
          "UPDATE export_jobs SET status='QUEUED',error=null,completed=0 WHERE id=$1 AND status='FAILED'",
          [id],
        );
        return reply({ ok: true });
      }
    }
    if (cardAction || renderImage) {
      const card = cardAction
        ? await requireRow(
            c,
            "SELECT * FROM cards WHERE organization_id=$1 AND id=$2 FOR UPDATE",
            [org, id],
          )
        : null;
      if (method === "GET" && p[4] === "history")
        return reply({
          card,
          events: (
            await c.query(
              "SELECT type,details,created_at FROM card_events WHERE organization_id=$1 AND card_id=$2 ORDER BY created_at",
              [org, id],
            )
          ).rows,
          renders: (
            await c.query(
              "SELECT id,template_version_id,created_at FROM card_renders WHERE organization_id=$1 AND card_id=$2 ORDER BY created_at",
              [org, id],
            )
          ).rows,
        });
      if (method === "GET" && ["image", "pdf"].includes(p[4])) {
        const render = renderImage
          ? id
          : (
              await requireRow(
                c,
                "SELECT id FROM card_renders WHERE card_id=$1 ORDER BY created_at DESC LIMIT 1",
                [id],
              )
            ).id;
        const raw = Object.fromEntries(url.searchParams);
        const options = exportSchema.parse({
          ...raw,
          format: p[4] === "pdf" ? "pdf" : raw.format || "png",
          dpi: Number(raw.dpi || 300),
          quality: Number(raw.quality || 95),
        });
        return fileResponse(await createExport(c, org, [render!], options));
      }
      if (method === "POST" && card) {
        const body = await read();
        let event = p[4],
          details: Record<string, unknown> = {};
        if (p[4] === "state") {
          const state = z
            .enum([
              "ACTIVE",
              "PRINTED",
              "LOST",
              "SUSPENDED",
              "CANCELLED",
              "EXPIRED",
            ])
            .parse(body.status);
          const terminal = ["CANCELLED", "REPLACED"].includes(card.status);
          if (terminal)
            throw new AppError(
              409,
              "This card is permanently cancelled or replaced.",
              "Issue a new card.",
            );
          if (
            card.status === "DRAFT" &&
            !["ACTIVE", "CANCELLED"].includes(state)
          )
            throw new AppError(
              409,
              "Activate a draft before changing its operational status.",
              "Activate or cancel the draft.",
            );
          if (
            ["ACTIVE", "PRINTED"].includes(state) &&
            card.expires_at &&
            Date.parse(card.expires_at) < Date.now()
          )
            throw new AppError(
              409,
              "The card has expired.",
              "Extend or renew it before activation.",
            );
          await c.query("UPDATE cards SET status=$1 WHERE id=$2", [state, id]);
          details = { from: card.status, to: state };
        } else if (p[4] === "extend") {
          const expires = z.iso.datetime().parse(body.expires_at);
          if (
            Date.parse(expires) <=
              Math.max(
                Date.now(),
                card.expires_at ? new Date(card.expires_at).getTime() : 0,
              ) ||
            ["CANCELLED", "REPLACED"].includes(card.status)
          )
            throw new AppError(
              422,
              "Expiry must be in the future for an eligible card.",
              "Choose a future expiry, or issue a replacement.",
            );
          await c.query("UPDATE cards SET expires_at=$1 WHERE id=$2", [
            expires,
            id,
          ]);
          details = { previous: card.expires_at, expires_at: expires };
        } else {
          if (card.status === "CANCELLED")
            throw new AppError(
              409,
              "Cancelled cards cannot be reissued.",
              "Generate a new card for the person.",
            );
          const d = z
            .object({
              template_id: z.uuid().optional(),
              expires_at: z.iso.datetime().optional(),
              request_key: z.string().min(8).max(100),
            })
            .parse(body);
          const replay = await c.query(
            "SELECT ca.id,ca.number,(SELECT id FROM card_renders WHERE card_id=ca.id ORDER BY created_at DESC LIMIT 1) render_id FROM cards ca WHERE ca.organization_id=$1 AND ca.request_key=$2",
            [org, id + ":" + d.request_key],
          );
          if (replay.rowCount) return reply(replay.rows[0]);
          if (card.status === "REPLACED")
            throw new AppError(
              409,
              "This card already has a replacement.",
              "Open the replacement card to reissue it.",
            );
          const replacementExpiry =
            d.expires_at || card.expires_at?.toISOString();
          if (replacementExpiry && Date.parse(replacementExpiry) <= Date.now())
            throw new AppError(
              422,
              "Replacement expiry must be in the future.",
              "Choose a future date.",
            );
          const previous = (
            await c.query(
              "SELECT v.template_id FROM card_renders r JOIN template_versions v ON v.id=r.template_version_id WHERE r.card_id=$1 ORDER BY r.created_at DESC LIMIT 1",
              [id],
            )
          ).rows[0];
          if (!d.template_id && !previous)
            throw new AppError(
              422,
              "This card's saved renders were purged.",
              "Choose a replacement template to reissue the card.",
            );
          const created = await generateCard(
            c,
            org,
            a.id,
            {
              person_id: card.person_id,
              template_id: d.template_id || previous?.template_id,
              expires_at: replacementExpiry,
            },
            { requestKey: id + ":" + d.request_key },
          );
          if (created.id === id)
            throw new AppError(
              409,
              "Replacement key refers to the old card.",
              "Use a fresh request key.",
            );
          await c.query(
            "UPDATE cards SET status='ACTIVE',supersedes_id=$1 WHERE id=$2",
            [id, created.id],
          );
          await c.query("UPDATE cards SET status='REPLACED' WHERE id=$1", [id]);
          details = { replacement_id: created.id };
          await c.query(
            "INSERT INTO card_events(id,organization_id,card_id,type,actor_id,details) VALUES($1,$2,$3,'ACTIVATED',$4,$5)",
            [
              randomUUID(),
              org,
              created.id,
              a.id,
              JSON.stringify({ supersedes: id }),
            ],
          );
          await audit(c, a, org, "card." + event, id);
          await c.query(
            "INSERT INTO card_events(id,organization_id,card_id,type,actor_id,details) VALUES($1,$2,$3,$4,$5,$6)",
            [
              randomUUID(),
              org,
              id,
              event.toUpperCase(),
              a.id,
              JSON.stringify(details),
            ],
          );
          return reply(created, 201);
        }
        await c.query(
          "INSERT INTO card_events(id,organization_id,card_id,type,actor_id,details) VALUES($1,$2,$3,$4,$5,$6)",
          [
            randomUUID(),
            org,
            id,
            event.toUpperCase(),
            a.id,
            JSON.stringify(details),
          ],
        );
        await audit(c, a, org, "card." + event, id);
        return reply({ ok: true });
      }
    }
    if (resource === "locations") {
      const settings = (
        await c.query(
          "SELECT location_enabled FROM organization_settings WHERE organization_id=$1",
          [org],
        )
      ).rows[0];
      if (!settings?.location_enabled)
        throw new AppError(
          403,
          "Location is disabled.",
          "An organization administrator can enable it in privacy settings.",
        );
      if (method === "GET")
        return reply(
          (
            await c.query(
              "SELECT * FROM locations WHERE organization_id=$1 ORDER BY address LIMIT 100",
              [org],
            )
          ).rows,
        );
      if (method === "POST") {
        const d = z
          .object({
            address: z.string().max(1000),
            latitude: z.number().min(-85).max(85),
            longitude: z.number().min(-180).max(180),
            unit_id: z.uuid().nullable().default(null),
            map_asset_id: z.uuid().nullable().default(null),
          })
          .parse(await read());
        const lid = randomUUID();
        await c.query(
          "INSERT INTO locations(id,organization_id,address,latitude,longitude,unit_id,map_asset_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            lid,
            org,
            d.address,
            d.latitude,
            d.longitude,
            d.unit_id,
            d.map_asset_id,
          ],
        );
        await audit(c, a, org, "location.create", lid);
        return reply({ id: lid }, 201);
      }
    }
    if (resource === "print-profiles") {
      if (method === "GET")
        return reply(
          (
            await c.query(
              "SELECT * FROM print_profiles WHERE organization_id=$1 ORDER BY name",
              [org],
            )
          ).rows,
        );
      if (method === "POST") {
        const d = z
            .object({ name: z.string().min(1).max(100), options: exportSchema })
            .parse(await read()),
          pid = randomUUID();
        await c.query(
          "INSERT INTO print_profiles(id,organization_id,name,options) VALUES($1,$2,$3,$4)",
          [pid, org, d.name, JSON.stringify(d.options)],
        );
        await audit(c, a, org, "print-profile.create", pid);
        return reply({ id: pid }, 201);
      }
    }
    if (resource === "audit" && method === "GET") {
      const offset = z.coerce
        .number()
        .int()
        .min(0)
        .max(1000000)
        .parse(url.searchParams.get("offset") || 0);
      return reply(
        (
          await c.query(
            "SELECT action,target_id,actor_id,created_at FROM audit_events WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100 OFFSET $2",
            [org, offset],
          )
        ).rows,
      );
    }
    if (resource === "tokens") {
      if (method === "GET")
        return reply(
          (
            await c.query(
              "SELECT id,name,scopes,expires_at FROM api_tokens WHERE organization_id=$1",
              [org],
            )
          ).rows,
        );
      if (method === "POST") {
        const d = z
          .object({
            name: z.string().min(1).max(100),
            scopes: z
              .array(z.enum(["read", "people", "generate", "design", "asset"]))
              .min(1),
            expires_at: z.iso.datetime(),
          })
          .parse(await read());
        if (Date.parse(d.expires_at) <= Date.now())
          throw new AppError(
            422,
            "Token expiry is in the past.",
            "Choose a future expiry.",
          );
        const token = "idc_" + randomBytes(32).toString("base64url"),
          tid = randomUUID();
        await c.query(
          "INSERT INTO api_tokens(id,organization_id,user_id,name,token_hash,scopes,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [tid, org, a.id, d.name, digest(token), d.scopes, d.expires_at],
        );
        await audit(c, a, org, "token.create", tid);
        return reply({ id: tid, token }, 201);
      }
      if (method === "DELETE" && id) {
        await c.query(
          "DELETE FROM api_tokens WHERE organization_id=$1 AND id=$2",
          [org, id],
        );
        await audit(c, a, org, "token.revoke", id);
        return reply({ ok: true });
      }
    }
    if (resource === "reports" && method === "GET") {
      const rows = (
        await c.query(
          "SELECT status,count(*)::int AS count FROM cards GROUP BY status ORDER BY status",
        )
      ).rows;
      await audit(c, a, org, "report.download");
      return new Response(
        "Status,Count\r\n" +
          rows.map((r) => `${r.status},${r.count}`).join("\r\n") +
          "\r\n",
        {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition":
              'attachment; filename="card-status-report.csv"',
            "Cache-Control": "private, no-store",
          },
        },
      );
    }
    if (resource === "dashboard" && method === "GET") {
      const totals = (
        await c.query(
          "SELECT count(*)::int AS total,count(*) FILTER(WHERE status IN ('ACTIVE','PRINTED') AND (expires_at IS NULL OR expires_at>now()))::int AS active,count(*) FILTER(WHERE status='EXPIRED' OR (status IN ('ACTIVE','PRINTED') AND expires_at<=now()))::int AS expired,count(*) FILTER(WHERE status='DRAFT')::int AS pending,count(*) FILTER(WHERE status='PRINTED')::int AS printed FROM cards WHERE organization_id=$1",
          [org],
        )
      ).rows[0];
      return reply({
        totals,
        people: Number(
          (
            await c.query(
              "SELECT count(*) FROM people WHERE deleted_at IS NULL",
            )
          ).rows[0].count,
        ),
        templates: Number(
          (await c.query("SELECT count(*) FROM templates WHERE NOT archived"))
            .rows[0].count,
        ),
        generated: (
          await c.query(
            "SELECT to_char(created_at AT TIME ZONE $1,'YYYY-MM-DD') AS day,count(*)::int AS count FROM cards WHERE created_at>now()-interval '30 days' GROUP BY 1 ORDER BY 1",
            [(await getTimeSettings(c, org)).timeZone],
          )
        ).rows,
        departments: (
          await c.query(
            "SELECT u.name,count(DISTINCT pu.person_id)::int AS count FROM org_units u LEFT JOIN person_units pu ON pu.unit_id=u.id WHERE u.kind='DEPARTMENT' GROUP BY u.id ORDER BY u.name",
          )
        ).rows,
        imports: (
          await c.query(
            "SELECT b.id,b.original_name,b.status,b.created_at,(SELECT count(*) FROM import_rows r WHERE r.batch_id=b.id AND errors<>'[]'::jsonb)::int AS errors FROM import_batches b ORDER BY created_at DESC LIMIT 10",
          )
        ).rows,
        jobs: (
          await c.query(
            "SELECT id,status,created_at FROM generation_jobs ORDER BY created_at DESC LIMIT 10",
          )
        ).rows,
      });
    }
    throw new AppError(
      404,
      "Action not found.",
      "Check the API documentation and supported method.",
    );
  });
}
function fileResponse(key: string) {
  const ext = key.split(".").pop()!,
    types: Record<string, string> = {
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      zip: "application/zip",
    };
  return new Response(
    Readable.toWeb(createReadStream(storagePath(key))) as ReadableStream,
    {
      headers: {
        "Content-Type": types[ext] || "application/octet-stream",
        "Content-Disposition": `attachment; filename="idcards.${ext}"`,
        "Cache-Control": "private, no-store",
      },
    },
  );
}
