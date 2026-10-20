import { dispatchJobs, runGeneration, runExport } from "../core/jobs.ts";
import { cleanupPurgeFiles } from "../core/retention.ts";
import { PgBoss } from "pg-boss";
import { config } from "../core/config.ts";
import { db, closeDb } from "../core/db.ts";
const boss = new PgBoss(config().databaseUrl);
boss.on("error", () =>
  console.error(
    "Queue connection failed. Check PostgreSQL and worker journal.",
  ),
);
async function main() {
  await boss.start();
  await boss.createQueue("maintenance");
  await boss.createQueue("card-generation", {
    retryLimit: 5,
    retryDelay: 10,
    expireInSeconds: 3600,
  });
  await boss.createQueue("card-export", {
    retryLimit: 5,
    retryDelay: 10,
    expireInSeconds: 3600,
  });
  await boss.work<{ org: string; id: string }>(
    "card-generation",
    async (jobs) => {
      for (const job of jobs) await runGeneration(job.data.org, job.data.id);
    },
  );
  await boss.work<{ org: string; id: string }>("card-export", async (jobs) => {
    for (const job of jobs) await runExport(job.data.org, job.data.id);
  });
  let dispatching = false;
  const dispatch = setInterval(async () => {
    if (dispatching) return;
    dispatching = true;
    try {
      await dispatchJobs(boss);
      await cleanupPurgeFiles();
    } catch {
      console.error(
        "Job dispatch failed. Check PostgreSQL and queue connectivity.",
      );
    } finally {
      dispatching = false;
    }
  }, 2000);
  await boss.work("maintenance", async () => {
    await db().query("DELETE FROM sessions WHERE expires_at<now()");
    await db().query(
      "DELETE FROM login_limits WHERE window_start<now()-interval '1 day'",
    );
  });
  await boss.schedule("maintenance", "*/15 * * * *");
  const beat = () =>
    db().query(
      "INSERT INTO worker_heartbeats(name,seen_at) VALUES('main',now()) ON CONFLICT(name) DO UPDATE SET seen_at=excluded.seen_at",
    );
  await beat();
  const interval = setInterval(() => {
    beat().catch(() =>
      console.error("Worker heartbeat failed. Check PostgreSQL."),
    );
  }, 30000);
  async function stop() {
    clearInterval(interval);
    clearInterval(dispatch);
    await boss.stop({ graceful: true });
    await closeDb();
    process.exit(0);
  }
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  console.log("Worker is ready.");
}
main().catch(() => {
  console.error(
    "Worker failed to start. Run migrations, check DATABASE_URL and inspect PostgreSQL.",
  );
  process.exit(1);
});
