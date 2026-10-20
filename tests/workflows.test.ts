import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  readFile,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { layoutPlan, pt, exportSchema } from "../src/core/exports.ts";
import { effectiveStatus } from "../src/core/verification.ts";
import {
  safeArchiveEntry,
  parseEnvironment,
  createBackupArchive,
  validateBackupArchive,
} from "../src/core/archive.ts";
test("print sheets preserve physical dimensions and mirror duplex positions", () => {
  const long = layoutPlan(85.6, 53.98, {
    layout: "sheet",
    side: "both",
    duplex: "long",
  });
  assert.equal(long.pw, 210);
  assert.equal(long.ph, 297);
  assert.equal(long.capacity, 8);
  assert.deepEqual(long.position(0), { x: 10, y: 10 });
  assert.deepEqual(long.position(0, true), long.position(1));
  const short = layoutPlan(85.6, 53.98, {
    layout: "sheet",
    side: "both",
    duplex: "short",
  });
  assert.deepEqual(short.position(0, true), short.position(6));
  assert.ok(Math.abs(pt(25.4) - 72) < 1e-9);
  assert.throws(
    () => layoutPlan(85.6, 53.98, { layout: "sheet", columns: 3 }),
    /fit/,
  );
  assert.throws(
    () => layoutPlan(85.6, 53.98, { layout: "sheet", cropMarks: true, gap: 1 }),
    /clearance/,
  );
  assert.equal(layoutPlan(85.6, 53.98, { bleed: 2 }).pw, 89.6);
  assert.throws(() => exportSchema.parse({ dpi: 72 }));
});
test("verification respects lost and replaced states even after expiry", () => {
  const past = "2000-01-01T00:00:00Z";
  assert.equal(effectiveStatus("ACTIVE", past), "EXPIRED");
  assert.equal(effectiveStatus("PRINTED", null), "ACTIVE");
  for (const s of ["LOST", "SUSPENDED", "REPLACED", "CANCELLED", "DRAFT"])
    assert.equal(effectiveStatus(s, past), s);
});
test("archive and environment parsers reject traversal, links and executable variables", () => {
  for (const n of [
    "/db.dump",
    "../db.dump",
    "storage/../../escape",
    "C:/db.dump",
    "storage\\escape",
    "other",
  ])
    assert.equal(safeArchiveEntry(n, "File"), false, n);
  assert.equal(safeArchiveEntry("storage/photos/a.png", "SymbolicLink"), false);
  assert.equal(safeArchiveEntry("storage/photos/a.png", "File"), true);
  assert.throws(() => parseEnvironment("NODE_OPTIONS=--require evil"));
  const data = parseEnvironment(
    'DATABASE_URL="postgresql://local/db"\nAPP_ORIGIN=https://example.test\nSTORAGE_ROOT=/var/lib/idcard/storage',
  );
  assert.equal(data.APP_ORIGIN, "https://example.test");
});
test("backup round trip validates every file and rejects corrupt and unsafe archives", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "idcard-archive-"));
  try {
    const stage = path.join(root, "source");
    await mkdir(path.join(stage, "storage", "photos"), { recursive: true });
    await writeFile(path.join(stage, "db.dump"), "test-dump");
    await writeFile(
      path.join(stage, "config.env"),
      "DATABASE_URL=postgresql://local/db\nAPP_ORIGIN=https://example.test\nSTORAGE_ROOT=/var/lib/idcard/storage",
    );
    await writeFile(
      path.join(stage, "storage", "photos", "a.png"),
      "frozen image",
    );
    const archive = path.join(root, "valid.tar.gz");
    await createBackupArchive(stage, archive, "0.20.0");
    assert.equal(
      (await validateBackupArchive(archive, path.join(root, "valid"))).manifest
        .version,
      "0.20.0",
    );
    assert.equal(
      await readFile(
        path.join(root, "valid", "storage", "photos", "a.png"),
        "utf8",
      ),
      "frozen image",
    );
    await writeFile(path.join(stage, "db.dump"), "tampered");
    const corrupt = path.join(root, "corrupt.tar.gz");
    await tar.c({ cwd: stage, file: corrupt, gzip: true }, [
      "manifest.json",
      "db.dump",
      "config.env",
      "storage",
    ]);
    await assert.rejects(
      validateBackupArchive(corrupt, path.join(root, "corrupt")),
      /checksum/,
    );
    await writeFile(path.join(stage, "unexpected"), "unsafe");
    const unsafe = path.join(root, "unsafe.tar.gz");
    await tar.c({ cwd: stage, file: unsafe, gzip: true }, ["unexpected"]);
    await assert.rejects(
      validateBackupArchive(unsafe, path.join(root, "unsafe")),
      /Unsafe/,
    );
    await assert.rejects(
      validateBackupArchive(archive, path.join(root, "large"), 1),
      /oversized/,
    );
    const empty = path.join(root, "empty");
    await mkdir(empty);
    await writeFile(path.join(empty, "db.dump"), "empty-database-dump");
    await writeFile(
      path.join(empty, "config.env"),
      await readFile(path.join(stage, "config.env")),
    );
    const emptyArchive = path.join(root, "empty.tar.gz");
    await createBackupArchive(empty, emptyArchive, "0.20.0");
    await validateBackupArchive(emptyArchive, path.join(root, "empty-restore"));
    assert.ok(
      (await stat(path.join(root, "empty-restore", "storage"))).isDirectory(),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
