import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchImportColumns,
  importFields,
  importCardType,
} from "../src/core/import-fields.ts";
test("one import field list covers all card types and matches headers without duplicate targets", () => {
  const fields = importFields([
    { key: "department", label: "Department" },
    { key: "house", label: "House" },
  ]);
  assert.ok(fields.some((f) => f.key === "custom.card_type"));
  for (const key of ["course", "visitor_company", "access_level", "house"])
    assert.ok(fields.some((f) => f.key === `custom.${key}`));
  assert.equal(new Set(fields.map((f) => f.key)).size, fields.length);
  assert.deepEqual(
    matchImportColumns(
      [
        "external_id",
        "Full name",
        "Card type",
        "department",
        "custom.department",
        "Unrecognized",
      ],
      [],
    ),
    {
      external_id: "external_id",
      "custom.department": "custom.department",
      "Full name": "name",
      "Card type": "custom.card_type",
    },
  );
  for (const [label, key] of [
    ["Student", "student"],
    ["Faculty / Staff", "staff"],
    ["Temporary / Visitor", "visitor"],
    ["Working Professional", "professional"],
  ])
    assert.equal(importCardType(label), key);
  assert.equal(importCardType("unrecognized"), "unrecognized");
});
