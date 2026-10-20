import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { browserId } from "../src/components/browser-id.ts";
test("browser IDs use the native UUID method when available", () => {
  const id = "78ca9bac-a895-4afe-b099-cdbcdcb76c51";
  assert.equal(
    browserId({
      randomUUID: () => id,
      getRandomValues: () => {
        throw new Error("Not needed");
      },
    }),
    id,
  );
});
test("HTTP LAN fallback creates unique random UUIDv4 values without randomUUID", () => {
  const source = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) };
  const ids = Array.from({ length: 100 }, () => browserId(source));
  assert.equal(new Set(ids).size, 100);
  for (const id of ids)
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
});
