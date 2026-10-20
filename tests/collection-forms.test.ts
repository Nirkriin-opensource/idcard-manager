import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectionFields,
  collectionSchema,
  collectionFieldSchema,
  validateCollectionValues,
  professionPresets,
} from "../src/core/collection-schema.ts";
const basic = collectionFields.filter((f) =>
  ["name", "external_id", "email", "photo"].includes(f.key),
);
test("profession presets share one General workflow and keep organization fields private", () => {
  for (const [profession, keys] of Object.entries(professionPresets)) {
    const fields = collectionFields.filter((f) => keys.includes(f.key));
    assert.ok(
      collectionSchema.safeParse({ title: "Collect", profession, fields })
        .success,
    );
    assert.equal(
      fields.some((f) => f.key === "card_type"),
      false,
    );
  }
  for (const key of [
    "organization_logo",
    "authorized_signature",
    "qr",
    "organization_name",
    "card_type",
    "constructor",
    "photo_asset_id",
  ]) {
    assert.equal(
      collectionFieldSchema.safeParse({ key, label: "Unsafe", type: "text" })
        .success,
      false,
      key,
    );
  }
  assert.equal(
    collectionSchema.safeParse({
      title: "Collect",
      profession: "Doctor",
      fields: basic.filter((f) => f.key !== "external_id"),
    }).success,
    false,
  );
  assert.equal(
    collectionSchema.safeParse({
      title: "Collect",
      profession: "Doctor",
      fields: [...basic, basic[0]],
    }).success,
    false,
  );
});
test("collection enforces required questions, types, dates, choices and payload boundaries", () => {
  const fields = [
    ...basic,
    {
      key: "practice_name",
      label: "Practice",
      type: "text" as const,
      required: true,
      options: [],
    },
    {
      key: "specialty",
      label: "Specialty",
      type: "select" as const,
      required: true,
      options: ["Dental", "General"],
    },
    {
      key: "birth_date",
      label: "Birth date",
      type: "date" as const,
      required: false,
      options: [],
    },
    {
      key: "experience",
      label: "Experience",
      type: "number" as const,
      required: false,
      options: [],
    },
  ];
  const data = {
    name: "  Alex Rao  ",
    external_id: "D001",
    email: "alex@example.test",
    practice_name: "City clinic",
    specialty: "Dental",
    experience: 0,
  };
  assert.equal(validateCollectionValues(fields, data).name, "Alex Rao");
  for (const invalid of [
    { ...data, name: "" },
    { ...data, email: "bad" },
    { ...data, specialty: "Other" },
    { ...data, birth_date: "2026-02-30" },
    { ...data, experience: "5" },
    { ...data, organization_logo: "asset" },
  ])
    assert.throws(() => validateCollectionValues(fields, invalid));
  assert.throws(() =>
    validateCollectionValues(fields, data, { authorized_signature: "fake" }),
  );
  assert.throws(() =>
    validateCollectionValues(
      fields.map((f) => (f.key === "photo" ? { ...f, required: true } : f)),
      data,
    ),
  );
});
test("custom dropdowns and mandatory checkboxes validate without trusting applicant types", () => {
  assert.equal(
    collectionFieldSchema.safeParse({
      key: "specialty",
      label: "Specialty",
      type: "select",
      options: ["Dental", "Dental"],
    }).success,
    false,
  );
  assert.equal(
    collectionFieldSchema.safeParse({
      key: "name",
      label: "Name",
      type: "number",
    }).success,
    false,
  );
  const fields = [
    {
      key: "declaration",
      label: "Declaration",
      type: "boolean" as const,
      required: true,
      options: [],
    },
  ];
  assert.throws(() => validateCollectionValues(fields, { declaration: false }));
  assert.throws(() => validateCollectionValues(fields, { declaration: "yes" }));
  assert.equal(
    validateCollectionValues(fields, { declaration: true }).declaration,
    true,
  );
});
