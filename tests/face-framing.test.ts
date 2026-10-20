import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import {
  detectPortraitFace,
  framePortrait,
  faceCrop,
} from "../src/core/face-framing.ts";
test("face detection frames an off-centre portrait locally with headroom", async () => {
  const portrait = await readFile("tests/fixtures/portrait.jpg");
  const face = await detectPortraitFace(portrait);
  assert.ok(face, "A clear frontal portrait must be detected");
  const placed = await sharp({
    create: { width: 1600, height: 700, channels: 3, background: "#ffffff" },
  })
    .composite([{ input: portrait, left: 10, top: 30 }])
    .png()
    .toBuffer();
  const framed = await framePortrait(placed, 400, 400),
    located = await detectPortraitFace(framed);
  assert.ok(located, "Automatic crop must retain the off-centre face");
  assert.ok(
    located.x + located.width / 2 > 0.25 &&
      located.x + located.width / 2 < 0.75,
  );
  assert.ok(
    located.y > 0.03 && located.y + located.height < 0.9,
    "Keep room above the face and below the chin",
  );
  const normal = await framePortrait(placed, 400, 400, false);
  assert.equal(
    await detectPortraitFace(normal),
    null,
    "A centre crop alone misses this off-centre face",
  );
});
test("face framing falls back safely and clamps every crop to the image", async () => {
  const blank = await sharp({
    create: { width: 100, height: 200, channels: 3, background: "#4a7080" },
  })
    .png()
    .toBuffer();
  assert.equal(await detectPortraitFace(blank), null);
  const framed = await framePortrait(blank, 80, 80);
  assert.equal((await sharp(framed).metadata()).width, 80);
  for (const face of [
    { x: 0, y: 0, width: 20, height: 20 },
    { x: 80, y: 180, width: 20, height: 20 },
  ]) {
    const box = faceCrop(100, 200, face, 1);
    assert.ok(
      box.left >= 0 &&
        box.top >= 0 &&
        box.left + box.width <= 100 &&
        box.top + box.height <= 200,
    );
  }
});
