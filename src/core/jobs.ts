import { randomUUID } from "node:crypto";
import { retentionLock } from "./retention-lock.ts";
import { PgBoss } from "pg-boss";
import type pg from "pg";
import { db, transaction } from "./db.ts";
import { tenant, type Actor } from "./auth.ts";
import { generateCard, requireRow } from "./cards.ts";
import { createExport } from "./exports.ts";
import { AppError } from "./errors.ts";
import { resolveStyle } from "./appearance.ts";
export async function enqueueGeneration(
  c: pg.PoolClient,
  org: string,
  a: Actor,
  template: string,
  ids: string[],
  key: string,
  themeKey?: string,
) {
  await retentionLock(c, org);
  const old = await c.query(
    "SELECT id FROM generation_jobs WHERE organization_id=$1 AND request_key=$2",
    [org, key],
  );
  if (old.rowCount) return old.rows[0];
  const version = await requireRow(
    c,
    "SELECT v.id FROM templates t JOIN template_versions v ON v.template_id=t.id WHERE t.organization_id=$1 AND t.id=$2 AND NOT t.archived ORDER BY v.version DESC LIMIT 1",
    [org, template],
  );
  const id = randomUUID();
  const style = await resolveStyle(c, org, themeKey);
  await c.query(
    "INSERT INTO generation_jobs(id,organization_id,actor_id,template_version_id,request_key,style_snapshot) VALUES($1,$2,$3,$4,$5,$6)",
    [id, org, a.id, version.id, key, JSON.stringify(style)],
  );
  for (const personId of [...new Set(ids)]) {
    const snapshot = await requireRow(
      c,
      "SELECT p.*,(SELECT asset_id FROM person_assets a WHERE a.person_id=p.id AND slot='photo') photo_asset_id FROM people p WHERE p.organization_id=$1 AND p.id=$2 AND p.deleted_at IS NULL FOR SHARE OF p",
      [org, personId],
    );
    await c.query(
      "INSERT INTO generation_items(id,organization_id,job_id,person_id,card_id,snapshot) VALUES($1,$2,$3,$4,$5,$6)",
      [randomUUID(), org, id, personId, randomUUID(), JSON.stringify(snapshot)],
    );
  }
  return { id };
}
async function jobActor(id: string): Promise<Actor> {
  const u = await db().query(
    "SELECT id,email,super_admin,must_change_password FROM users WHERE id=$1 AND NOT disabled AND NOT must_change_password",
    [id],
  );
  if (!u.rowCount)
    throw new AppError(
      403,
      "The job owner account is unavailable.",
      "Re-enable the account or create a new job with an authorized account.",
    );
  return { ...u.rows[0], csrf: "" };
}
async function lockJob(id: string, fn: () => Promise<void>) {
  const c = await db().connect();
  try {
    const lock = await c.query(
      "SELECT pg_try_advisory_lock(hashtextextended($1,0)) ok",
      [id],
    );
    if (lock.rows[0].ok) {
      try {
        await fn();
      } finally {
        await c.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
          id,
        ]);
      }
    }
  } finally {
    c.release();
  }
}
export async function runGeneration(org: string, id: string) {
  await lockJob(id, async () => {
    const job = await transaction(
      async (c) =>
        (
          await c.query(
            "SELECT j.*,v.template_id FROM generation_jobs j JOIN template_versions v ON v.id=j.template_version_id WHERE j.organization_id=$1 AND j.id=$2",
            [org, id],
          )
        ).rows[0],
      org,
    );
    if (!job || ["COMPLETED", "CANCELLED"].includes(job.status)) return;
    try {
      const a = await jobActor(job.actor_id);
      if (!job.style_snapshot)
        job.style_snapshot = await tenant(a, org, "generate", async (c) => {
          const style = await resolveStyle(c, org);
          await c.query(
            "UPDATE generation_jobs SET style_snapshot=$1 WHERE id=$2",
            [JSON.stringify(style), id],
          );
          return style;
        });
      await tenant(a, org, "generate", (c) =>
        c.query("UPDATE generation_jobs SET status='RUNNING' WHERE id=$1", [
          id,
        ]),
      );
      for (;;) {
        const item = await transaction(async (c) => {
          const state = await requireRow(
            c,
            "SELECT status FROM generation_jobs WHERE id=$1",
            [id],
          );
          if (state.status === "CANCELLED") return null;
          return (
            await c.query(
              "SELECT * FROM generation_items WHERE job_id=$1 AND status='PENDING' ORDER BY id LIMIT 1",
              [id],
            )
          ).rows[0];
        }, org);
        if (!item) break;
        try {
          await tenant(a, org, "generate", async (c) => {
            await retentionLock(c, org);
            const state = (
              await c.query("SELECT status FROM generation_jobs WHERE id=$1", [
                id,
              ])
            ).rows[0];
            if (!state || state.status === "CANCELLED") return;
            await generateCard(
              c,
              org,
              a.id,
              { person_id: item.person_id, template_id: job.template_id },
              {
                cardId: item.card_id,
                versionId: job.template_version_id,
                personSnapshot: item.snapshot,
                styleSnapshot: job.style_snapshot || undefined,
              },
            );
            await c.query(
              "UPDATE generation_items SET status='DONE',error=null WHERE id=$1",
              [item.id],
            );
          });
        } catch (e) {
          const message =
            e instanceof AppError
              ? `${e.message} ${e.fix}`
              : "Generation failed. Check storage, template and database health; retry the failed items.";
          await transaction(
            (c) =>
              c.query(
                "UPDATE generation_items SET status='FAILED',error=$1 WHERE id=$2",
                [message, item.id],
              ),
            org,
          );
        }
      }
      await transaction(async (c) => {
        const counts = (
          await c.query(
            "SELECT count(*) FILTER(WHERE status='FAILED') failed FROM generation_items WHERE job_id=$1",
            [id],
          )
        ).rows[0];
        await c.query(
          "UPDATE generation_jobs SET status=$1,finished_at=now() WHERE id=$2 AND status<>'CANCELLED'",
          [Number(counts.failed) ? "FAILED" : "COMPLETED", id],
        );
      }, org);
    } catch {
      await transaction(
        (c) =>
          c.query(
            "UPDATE generation_jobs SET status='FAILED',finished_at=now() WHERE id=$1 AND status<>'CANCELLED'",
            [id],
          ),
        org,
      );
    }
  });
}
export async function runExport(org: string, id: string) {
  await lockJob("export-" + id, async () => {
    const job = await transaction(
      async (c) =>
        (
          await c.query(
            "SELECT * FROM export_jobs WHERE organization_id=$1 AND id=$2",
            [org, id],
          )
        ).rows[0],
      org,
    );
    if (!job || job.status === "COMPLETED") return;
    try {
      const a = await jobActor(job.actor_id);
      await tenant(a, org, "generate", (c) =>
        c.query(
          "UPDATE export_jobs SET status='RUNNING',error=null,completed=0 WHERE id=$1",
          [id],
        ),
      );
      const key = await tenant(a, org, "generate", (c) =>
        createExport(c, org, job.render_ids, job.options, (n) =>
          transaction(async (progress) => {
            await progress.query(
              "UPDATE export_jobs SET completed=$1 WHERE id=$2",
              [n, id],
            );
          }, org),
        ),
      );
      await transaction(
        (c) =>
          c.query(
            "UPDATE export_jobs SET status='COMPLETED',storage_key=$1,completed=total WHERE id=$2",
            [key, id],
          ),
        org,
      );
    } catch (e) {
      await transaction(
        (c) =>
          c.query(
            "UPDATE export_jobs SET status='FAILED',error=$1 WHERE id=$2",
            [
              e instanceof AppError
                ? `${e.message} ${e.fix}`
                : "Export failed. Check worker logs, available disk and selected print settings.",
              id,
            ],
          ),
        org,
      );
    }
  });
}
export async function dispatchJobs(boss: PgBoss) {
  for (const row of (await db().query("SELECT id FROM organizations")).rows) {
    await transaction(async (c) => {
      for (const [table, queue] of [
        ["generation_jobs", "card-generation"],
        ["export_jobs", "card-export"],
      ]) {
        const rows = await c.query(
          `SELECT id FROM ${table} WHERE status IN ('QUEUED','RUNNING') ORDER BY created_at LIMIT 20`,
        );
        for (const job of rows.rows)
          await boss.send(
            queue,
            { org: row.id, id: job.id },
            { singletonKey: job.id, singletonSeconds: 15 },
          );
      }
    }, row.id);
  }
}
