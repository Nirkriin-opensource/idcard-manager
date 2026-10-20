import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fontFamilySchema, languageSchema } from "../src/core/printing.ts";
import {
  fontCatalog,
  fontCovers,
  importFont,
  textFontRuns,
} from "../src/core/font-library.ts";
import { templateSchema, elementSchema } from "../src/core/template.ts";
import { renderSide } from "../src/core/render.ts";
test("printing validates language and font names without permitting markup", () => {
  assert.equal(languageSchema.parse("ta"), "ta");
  assert.equal(languageSchema.parse("en-GB"), "en-GB");
  assert.throws(() => fontFamilySchema.parse('Arial"/><script>'));
  assert.throws(() => languageSchema.parse("../etc"));
});
test("multilingual card text shapes with installed fonts and rejects missing glyphs", async () => {
  process.env.STORAGE_ROOT = path.resolve("storage/printing-previews");
  const catalog = await fontCatalog();
  assert.ok(catalog.fonts.length > 0);
  await assert.rejects(
    textFontRuns("English", catalog.fonts[0].family, {}),
    /not installed/,
  );
  const samples = [
    ["en", "English — Identity Card"],
    ["ta", "தமிழ் அடையாள அட்டை"],
    ["hi", "हिन्दी पहचान पत्र"],
    ["ar", "بطاقة الهوية"],
  ];
  const elements = [];
  for (const [i, [language, text]] of samples.entries()) {
    const font = catalog.fonts.find((f) => fontCovers(f, text));
    assert.ok(font, `Installed font for ${language}`);
    const runs = await textFontRuns(text, font.family);
    assert.equal(runs.map((r) => r.text).join(""), text);
    elements.push(
      elementSchema.parse({
        id: randomUUID(),
        type: "text",
        x: 5,
        y: 5 + i * 13,
        width: 95,
        height: 12,
        fontSize: 4,
        fontFamily: font.family,
        text,
        language,
      }),
    );
  }
  const document = templateSchema.parse({
    schemaVersion: 1,
    width: 105,
    height: 65,
    dpi: 150,
    background: "#ffffff",
    textEngine: "pango",
    front: elements,
    back: [],
  });
  const image = await renderSide(document, "front", {}, async () => {
    throw Error("No image required");
  });
  await mkdir(process.env.STORAGE_ROOT, { recursive: true });
  await writeFile(
    path.join(process.env.STORAGE_ROOT, "multilingual.png"),
    image,
  );
  await assert.rejects(
    textFontRuns("\u{10ffff}", catalog.fonts[0].family),
    /No installed font/,
  );
  await assert.rejects(
    importFont(Buffer.from("not a font"), "fake.ttf"),
    /Not a supported/,
  );
  const uploaded = await importFont(
    await readFile(catalog.fonts[0].file),
    "example" + path.extname(catalog.fonts[0].file),
  );
  assert.ok(uploaded.length > 0);
});
