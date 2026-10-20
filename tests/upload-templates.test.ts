import { test } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { uploadTemplate, photoFilename } from "../src/core/upload-templates.ts";
import { parseSheet, zipEntries } from "../src/core/imports.ts";

test("upload templates include organization custom fields and safe photo matching guide", async () => {
  const client = {
    query: async (sql: string, args: string[]) => {
      assert.deepEqual(args, ["organization"]);
      return {
        rows: sql.includes("FROM organizations")
          ? [{ name: "Test", card_profiles: {} }]
          : sql.includes("field_definitions")
            ? [{ key: "department" }]
            : [{ external_id: "00123", name: "=unsafe" }],
      };
    },
  } as unknown as pg.PoolClient;
  const people = await uploadTemplate(client, "organization", "people");
  const content = await people.text();
  assert.match(content, /custom.department/);
  assert.match(content, /custom.card_type/);
  assert.match(content, /custom.course/);
  assert.match(content, /custom.visitor_company/);
  const headers = content
    .trim()
    .replace(/^\uFEFF/, "")
    .split(",");
  assert.equal(new Set(headers).size, headers.length);
  assert.equal(content.split("\r\n").length, 2);
  const photos = await uploadTemplate(client, "organization", "photos");
  assert.match(await photos.text(), /00123.jpg/);
  const kit = await uploadTemplate(client, "organization", "kit");
  assert.equal(kit.headers.get("Cache-Control"), "private, no-store");
  const files: string[] = [];
  await zipEntries(Buffer.from(await kit.arrayBuffer()), async (name) => {
    files.push(name);
  });
  assert.deepEqual(
    files.sort(),
    [
      "READ-ME.txt",
      "card-field-requirements.csv",
      "people-upload-template.csv",
      "photo-filename-guide.csv",
    ].sort(),
  );
});

test("photo filename guide flags IDs that cannot be filenames", () => {
  assert.equal(photoFilename("STAFF001"), "STAFF001.jpg");
  for (const id of ["a/b", "a\\b", "CON", "COM1", "a:", "a."])
    assert.equal(photoFilename(id), "");
});
