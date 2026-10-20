import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { transaction } from "./db.ts";
export async function migrate() {
  const folder = path.join(
    process.env.IDCARD_RELEASE_ROOT || process.cwd(),
    "src/db/migrations",
  );
  await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(528114901)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of (await readdir(folder))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      const sql = await readFile(path.join(folder, name), "utf8"),
        checksum = createHash("sha256").update(sql).digest("hex");
      const old = await c.query(
        "SELECT checksum FROM schema_migrations WHERE name=$1",
        [name],
      );
      if (old.rowCount) {
        if (old.rows[0].checksum !== checksum)
          throw new Error(
            `Migration ${name} changed after application. Restore the original file and add a new migration.`,
          );
        continue;
      }
      await c.query(sql);
      await c.query(
        "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
        [name, checksum],
      );
      console.log(`Applied ${name}`);
    }
  });
}
