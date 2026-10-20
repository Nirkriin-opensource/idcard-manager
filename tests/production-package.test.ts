import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  publicReleasePath,
  hasRecognizableSecret,
} from "../scripts/release-policy.ts";
test("public release excludes private data, local reports, dumps, credentials and path escapes", () => {
  for (const file of [
    ".env",
    ".env.production",
    "storage/photos/person.jpg",
    "storage/backups/a.tar.gz",
    "delivery/phase-22.md",
    "docs/screenshots/people.png",
    "src/.env.local",
    "tests/private.key",
    "../package.json",
    "src/../.env",
    "node_modules/example/index.js",
    "test-results/a.png",
    "dump.sql",
  ])
    assert.equal(publicReleasePath(file), false, file);
  for (const file of [
    ".env.example",
    "LICENSE",
    "install.sh",
    "src/db/migrations/010_recycle_purge.sql",
    "tests/fixtures/portrait-LICENSE.txt",
    ".github/workflows/ci.yml",
    "scripts/package-production.ts",
  ])
    assert.equal(publicReleasePath(file), true, file);
  assert.equal(hasRecognizableSecret("ghp_" + "a".repeat(36)), true);
  assert.equal(
    hasRecognizableSecret(
      "DATABASE_URL=postgresql://idcard:CHANGE_ME@127.0.0.1:5432/idcard",
    ),
    false,
  );
});
test("production release lists every applied migration and uses the selected MIT license", async () => {
  const release = JSON.parse(await readFile("release.json", "utf8"));
  assert.deepEqual(
    release.migrations,
    (await readdir("src/db/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort(),
  );
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(pkg.version, release.version);
  assert.equal(pkg.license, "MIT");
  assert.match(await readFile("LICENSE", "utf8"), /MIT License/);
});
