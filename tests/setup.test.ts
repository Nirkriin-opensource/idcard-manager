import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import jsQR from "jsqr";
import { readFile } from "node:fs/promises";
import { starterTemplate } from "../src/core/starter.ts";
import { renderSide } from "../src/core/render.ts";
import { APP_VERSION } from "../src/core/version.ts";
test("starter card renders both sides and its verification QR independently decodes", async () => {
  const logo = crypto.randomUUID(),
    photo = crypto.randomUUID(),
    document = starterTemplate("My Organization", logo);
  const image = await sharp({
    create: { width: 120, height: 160, channels: 3, background: "#a3c5cd" },
  })
    .png()
    .toBuffer();
  const fields = {
    name: "Anita Rao",
    external_id: "STAFF001",
    photo_asset_id: photo,
    "card.number": "STAFF-2026-000001",
    "card.verify_url": "https://cards.example.test/verify/" + "a".repeat(43),
  };
  const front = await renderSide(document, "front", fields, async () => image);
  assert.equal((await sharp(front).metadata()).width, 1011);
  const back = await renderSide(document, "back", fields, async () => image);
  const { data, info } = await sharp(back)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(
    jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data,
    fields["card.verify_url"],
  );
});
test("starter without a logo has valid unique element IDs and release metadata agrees", async () => {
  const doc = starterTemplate("Organization");
  assert.ok(!doc.front.some((e) => e.type === "logo"));
  assert.equal(
    new Set([...doc.front, ...doc.back].map((e) => e.id)).size,
    doc.front.length + doc.back.length,
  );
  assert.equal(
    JSON.parse(await readFile("package.json", "utf8")).version,
    APP_VERSION,
  );
  assert.equal(
    JSON.parse(await readFile("release.json", "utf8")).version,
    APP_VERSION,
  );
});
