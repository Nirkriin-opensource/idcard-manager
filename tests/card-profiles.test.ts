import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import {
  cardTypes,
  cardFieldCatalog,
  defaultCardPolicy,
  customCardFields,
  type CardType,
} from "../src/core/card-field-catalog.ts";
import {
  parsePolicy,
  profileTemplate,
  validateRequired,
} from "../src/core/card-profiles.ts";
import { renderSide } from "../src/core/render.ts";

test("card field catalog covers all four types and validates manual mandatory choices", () => {
  for (const kind of Object.keys(cardTypes) as CardType[]) {
    const policy = defaultCardPolicy(kind);
    assert.deepEqual(parsePolicy(kind, policy), policy);
    assert.throws(() => parsePolicy(kind, { ...policy, required: ["name"] }));
    assert.throws(() =>
      parsePolicy(kind, {
        ...policy,
        required: [...policy.required, "unknown"],
      }),
    );
    assert.throws(() =>
      parsePolicy(kind, {
        ...policy,
        shown: ["name", "external_id"],
        required: [...policy.required, "photo"],
      }),
    );
    assert.equal(
      new Set(cardFieldCatalog[kind].map((f) => f.key)).size,
      cardFieldCatalog[kind].length,
    );
  }
  assert.ok(customCardFields().find((f) => f.key === "guardian_phone"));
  assert.ok(cardFieldCatalog.visitor.find((f) => f.key === "return_note"));
  assert.equal(
    cardFieldCatalog.visitor.some((f) => f.key === "rfid"),
    false,
  );
  assert.doesNotThrow(() =>
    validateRequired("staff", ["name", "photo"], { name: "A" }, false),
  );
  assert.throws(
    () => validateRequired("staff", ["name", "photo"], { name: "A" }, true),
    /Mandatory/,
  );
  assert.throws(
    () =>
      validateRequired(
        "student",
        ["guardian_phone"],
        { guardian_phone: "  " },
        false,
      ),
    /Mandatory/,
  );
});

test("all full-field presets render both sides with realistic values and preserve requirements", async () => {
  await mkdir("storage/card-profile-previews", { recursive: true });
  const image = await sharp({
    create: { width: 200, height: 250, channels: 3, background: "#b4cbd3" },
  })
    .png()
    .toBuffer();
  const asset = randomUUID();
  for (const kind of Object.keys(cardTypes) as CardType[]) {
    const policy = defaultCardPolicy(kind);
    policy.required = [...policy.shown];
    const doc = profileTemplate(kind, policy);
    const values: Record<string, unknown> = Object.fromEntries(
      cardFieldCatalog[kind].map((f) => [
        f.key,
        f.type === "date" ? "2026-10-18" : "Example",
      ]),
    );
    Object.assign(values, {
      name: "Nirmal Kumar",
      external_id: "ID00123",
      email: "nirmal@example.org",
      phone: "+91 9876543210",
      emergency_contact: "+91 9876543211",
      guardian_phone: "+91 9876543211",
      residential_address: "123 Main Street, Example City, 600001",
      organization_name: "Example College of Technology",
      photo_asset_id: asset,
      organization_logo: asset,
      cardholder_signature: asset,
      authorized_signature: asset,
      "card.verify_url":
        "http://localhost/verify/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
      valid_until: "2026-10-18T17:00:00+05:30",
      visitor_label: "VISITOR",
      return_note: "Return at exit",
    });
    assert.doesNotThrow(() =>
      validateRequired(kind, policy.required, values, true),
    );
    for (const side of ["front", "back"] as const) {
      const png = await renderSide(doc, side, values, async () => image);
      assert.equal((await sharp(png).metadata()).width, 1011);
      await writeFile(`storage/card-profile-previews/${kind}-${side}.png`, png);
    }
    assert.deepEqual(doc.requiredFields, policy.required);
    for (const e of [...doc.front, ...doc.back])
      assert.ok(
        e.y + e.height <= doc.height,
        `${kind}: element is within card`,
      );
  }
});

test("optional visitor images can be absent without weakening required images", async () => {
  const doc = profileTemplate("visitor", {
    shown: ["name", "external_id", "photo"],
    required: ["name", "external_id"],
    assets: {},
  });
  await renderSide(
    doc,
    "front",
    { name: "Guest", external_id: "V001" },
    async () => {
      throw new Error("No image should be read");
    },
  );
  doc.front.find((e) => e.type === "photo")!.optional = false;
  await assert.rejects(
    renderSide(doc, "front", { name: "Guest", external_id: "V001" }, async () =>
      Buffer.alloc(0),
    ),
    /has no asset/,
  );
});
