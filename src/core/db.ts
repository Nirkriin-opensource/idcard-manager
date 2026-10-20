import pg from "pg";
import { config } from "./config.ts";
let pool: pg.Pool | undefined;
export function db() {
  return (pool ??= new pg.Pool({
    connectionString: config().databaseUrl,
    max: 8,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
  }));
}
export async function transaction<T>(
  fn: (c: pg.PoolClient) => Promise<T>,
  org?: string,
) {
  const c = await db().connect();
  try {
    await c.query("BEGIN");
    if (org) await c.query("SELECT set_config('app.org_id',$1,true)", [org]);
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
