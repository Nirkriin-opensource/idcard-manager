import type pg from "pg";
import { z } from "zod";
import { audit, type Actor } from "./auth.ts";
import { AppError } from "./errors.ts";
export async function bulkRecords(
  c: pg.PoolClient,
  org: string,
  actor: Actor,
  raw: unknown,
) {
  const data = z
    .object({
      kind: z.enum(["people", "photos"]),
      action: z.enum(["delete", "restore"]),
      ids: z.array(z.uuid()).min(1).max(10000),
    })
    .parse(raw);
  const ids = [...new Set(data.ids)];
  const rows = await c.query(
    data.kind === "people"
      ? "SELECT id FROM people WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE"
      : "SELECT id FROM assets WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND kind='PHOTO' AND NOT collection_private ORDER BY id FOR UPDATE",
    [org, ids],
  );
  if (rows.rowCount !== ids.length)
    throw new AppError(
      404,
      "One or more selected records are unavailable.",
      "Refresh the page and select records from this organization. Only ordinary uploaded photos can be deleted here.",
    );
  const table = data.kind === "people" ? "people" : "assets";
  await c.query(
    `UPDATE ${table} SET deleted_at=CASE WHEN $3 THEN COALESCE(deleted_at,now()) ELSE NULL END${data.kind === "people" ? ",updated_at=now()" : ""} WHERE organization_id=$1 AND id=ANY($2::uuid[])`,
    [org, ids, data.action === "delete"],
  );
  if (data.kind === "photos" && data.action === "delete")
    await c.query(
      "DELETE FROM person_assets WHERE organization_id=$1 AND asset_id=ANY($2::uuid[])",
      [org, ids],
    );
  await audit(c, actor, org, `${data.kind}.bulk-${data.action}`);
  return { count: ids.length };
}
