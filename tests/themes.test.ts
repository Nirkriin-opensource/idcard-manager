import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contrast,
  builtInThemes,
  themeContrast,
  applyCardTheme,
  themeVariables,
} from "../src/core/themes.ts";
import { profileTemplate } from "../src/core/card-profiles.ts";
import { defaultCardPolicy } from "../src/core/card-field-catalog.ts";

test("all dashboard and print palettes meet 4.5:1 text contrast", () => {
  assert.equal(contrast("#000000", "#ffffff"), 21);
  assert.equal(contrast("#ffffff", "#ffffff"), 1);
  for (const [key, theme] of Object.entries(builtInThemes)) {
    for (const [label, value] of Object.entries(themeContrast(theme)))
      assert.ok(value >= 4.5, `${key} ${label}: ${value}`);
    assert.ok(
      contrast(themeVariables(theme)["--button-ink"], theme.accent) >= 4.5,
    );
  }
});

test("new card palettes follow theme without mutating the source or QR contrast", () => {
  const source = profileTemplate("staff", defaultCardPolicy("staff"));
  const original = structuredClone(source);
  for (const theme of Object.values(builtInThemes)) {
    const doc = applyCardTheme(source, theme);
    assert.equal(doc.front[0].fill, theme.cardAccent);
    assert.equal(doc.background, theme.cardBackground);
    const qr = doc.back.find((e) => e.type === "qr")!;
    assert.equal(qr.fill, "#000000");
    assert.equal(qr.background, "#ffffff");
  }
  assert.deepEqual(source, original);
});

test("theme field visibility retains mandatory fields", () => {
  const source = profileTemplate("staff", defaultCardPolicy("staff"));
  source.front.find((e) => e.text.includes("{{name}}"))!.fieldKey = "name";
  source.front.find((e) => e.text.includes("{{department}}"))!.fieldKey =
    "department";
  const theme = { ...builtInThemes.forest, fields: { staff: ["external_id"] } };
  const doc = applyCardTheme(source, theme);
  assert.ok(doc.front.some((e) => e.fieldKey === "name"));
  assert.ok(!doc.front.some((e) => e.fieldKey === "department"));
});
