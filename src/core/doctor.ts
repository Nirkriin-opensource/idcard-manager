import {
  access,
  mkdir,
  writeFile,
  unlink,
  statfs,
  readdir,
  readFile,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { db } from "./db.ts";
import { config } from "./config.ts";
import { renderSide } from "./render.ts";
import { elementSchema, templateSchema } from "./template.ts";
export async function doctor() {
  let failures = 0;
  async function check(name: string, fix: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch {
      failures++;
      console.error(`FAIL ${name}: ${fix}`);
    }
  }
  await check(
    "PostgreSQL 16 and safe role",
    "Check DATABASE_URL; use PostgreSQL 16 and a non-superuser role with NOBYPASSRLS.",
    async () => {
      const r = (
        await db().query(
          "SELECT current_setting('server_version_num')::int version,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
        )
      ).rows[0];
      if (
        r.version < 160000 ||
        r.version >= 170000 ||
        r.rolsuper ||
        r.rolbypassrls
      )
        throw new Error();
    },
  );
  await check(
    "Migration",
    "Run migrations from the current release.",
    async () => {
      const r = await db().query(
        "SELECT name,checksum FROM schema_migrations ORDER BY name",
      );
      const folder = path.join(process.cwd(), "src/db/migrations");
      const names = (await readdir(folder))
        .filter((n) => n.endsWith(".sql"))
        .sort();
      if (r.rows.length !== names.length) throw new Error();
      for (const name of names) {
        const checksum = createHash("sha256")
          .update(await readFile(path.join(folder, name)))
          .digest("hex");
        if (
          !r.rows.some((row) => row.name === name && row.checksum === checksum)
        )
          throw new Error();
      }
    },
  );
  await check(
    "Tenant isolation",
    "Reapply reviewed RLS policies; never use a superuser application role.",
    async () => {
      const r = await db().query(
        "SELECT count(*) n FROM pg_class WHERE relname=ANY($1) AND relrowsecurity AND relforcerowsecurity",
        [
          [
            "people",
            "assets",
            "templates",
            "template_versions",
            "cards",
            "card_renders",
            "import_rows",
          ],
        ],
      );
      if (Number(r.rows[0].n) !== 7) throw new Error();
    },
  );
  await check(
    "Storage write and capacity",
    "Set storage ownership to idcard and free disk space (at least 1 GB).",
    async () => {
      const root = path.join(config().storage, "temp");
      await mkdir(root, { recursive: true });
      const file = path.join(root, randomUUID() + ".probe");
      await writeFile(file, "ok", { flag: "wx", mode: 0o600 });
      await access(file);
      await unlink(file);
      const info = await statfs(root);
      if (info.bavail * info.bsize < 1024 ** 3) throw new Error();
    },
  );
  await check(
    "Worker heartbeat",
    "Start idcard-worker; inspect journalctl -u idcard-worker.",
    async () => {
      const q = await db().query(
        "SELECT 1 FROM worker_heartbeats WHERE name='main' AND seen_at>now()-interval '90 seconds'",
      );
      if (!q.rowCount) throw new Error();
    },
  );
  await check(
    "Queue",
    "Start idcard-worker to initialize the pg-boss schema.",
    async () => {
      const q = await db().query(
        "SELECT to_regclass('pgboss.job') IS NOT NULL ok",
      );
      if (!q.rows[0].ok) throw new Error();
    },
  );
  await check(
    "QR, barcode and PNG renderer",
    "Check sharp native dependencies and installed fonts; run npm ci and rebuild.",
    async () => {
      const doc = templateSchema.parse({
        schemaVersion: 1,
        width: 85.6,
        height: 53.98,
        front: [
          elementSchema.parse({
            id: randomUUID(),
            type: "qr",
            x: 4,
            y: 4,
            width: 20,
            height: 20,
            text: "https://example.org/verify/render-test",
          }),
          elementSchema.parse({
            id: randomUUID(),
            type: "barcode",
            x: 4,
            y: 30,
            width: 55,
            height: 16,
            text: "TEST-0001",
          }),
        ],
        back: [],
      });
      const png = await renderSide(doc, "front", {}, async () => {
        throw new Error();
      });
      const meta = await sharp(png).metadata();
      if (meta.width !== 1011 || meta.height !== 638) throw new Error();
    },
  );
  await check(
    "PDF renderer",
    "Reinstall locked dependencies and rebuild; check storage capacity.",
    async () => {
      const pdf = new PDFDocument({ size: [242.65, 153.01], margin: 0 });
      const chunks: Buffer[] = [];
      const done = new Promise<void>((resolve, reject) => {
        pdf.on("data", (b) => chunks.push(b));
        pdf.on("end", resolve);
        pdf.on("error", reject);
      });
      pdf.fontSize(12).text("ID Card print diagnostic", 10, 10);
      pdf.end();
      await done;
      if (!Buffer.concat(chunks).subarray(0, 5).equals(Buffer.from("%PDF-")))
        throw new Error();
    },
  );
  await check(
    "Public URL and TLS",
    "Check APP_ORIGIN, DNS, firewall and Caddy certificate journals.",
    async () => {
      const response = await fetch(config().origin + "/api/health/ready", {
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      });
      if (!response.ok) throw new Error();
    },
  );
  if (failures)
    throw new Error(
      `${failures} diagnostic check(s) failed. Follow the fixes above.`,
    );
}
