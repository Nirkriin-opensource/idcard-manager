import type pg from "pg";
import { AppError } from "./errors.ts";
export async function retentionLock(
  c: pg.PoolClient,
  org: string,
  exclusive = false,
) {
  const result = await c.query(
    `SELECT ${exclusive ? "pg_try_advisory_xact_lock" : "pg_advisory_xact_lock_shared"}(hashtextextended($1,0)) AS locked`,
    ["retention:" + org],
  );
  if (exclusive && !result.rows[0].locked)
    throw new AppError(
      409,
      "Rendering or export work is in progress.",
      "Wait for it to finish, then preview the purge again.",
    );
}
