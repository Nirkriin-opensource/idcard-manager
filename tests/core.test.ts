import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { readBarcodes, prepareZXingModule } from "zxing-wasm/reader";
const resolveTest = createRequire(path.resolve("package.json"));
prepareZXingModule({
  overrides: {
    wasmBinary: new Uint8Array(
      readFileSync(resolveTest.resolve("zxing-wasm/reader/zxing_reader.wasm")),
    ).buffer,
  },
});
import jsQR from "jsqr";
import {
  bind,
  escapeXml,
  mmToPixels,
  elementSchema,
  templateSchema,
} from "../src/core/template.ts";
import { renderSide, codeSvg } from "../src/core/render.ts";
import { parseSheet, csvCell, zipEntries } from "../src/core/imports.ts";
import { storagePath } from "../src/core/storage.ts";
import { limitedBody } from "../src/core/api.ts";
import { personSchema } from "../src/core/people.ts";
import { cardNumber, numberingSchema } from "../src/core/numbering.ts";
process.env.DATABASE_URL = "postgresql://unused:unused@localhost/unused";
const element = (type: "qr" | "barcode" | "text", text: string) =>
  elementSchema.parse({
    id: randomUUID(),
    type,
    x: 3,
    y: 3,
    width: type === "qr" ? 25 : 70,
    height: type === "qr" ? 25 : 20,
    text,
  });
const document = (front: unknown[]) =>
  templateSchema.parse({
    schemaVersion: 1,
    width: 85.6,
    height: 53.98,
    front,
    back: [],
  });
const noAssets = async () => {
  throw new Error("Unexpected asset lookup");
};
async function decode(buffer: Buffer) {
  const results = await readBarcodes(new Uint8Array(buffer), {
    tryHarder: true,
    maxNumberOfSymbols: 1,
  });
  assert.ok(
    results.length,
    "Independent decoder could not read the rendered code.",
  );
  return results[0].text;
}
test("bindings resolve explicit values and reject inherited or missing fields", () => {
  assert.equal(
    bind("{{name}} · {{grade}}", { name: "A&B", grade: 4 }),
    "A&B · 4",
  );
  assert.throws(() => bind("{{constructor}}", {}), /no value/);
  assert.throws(() => bind("{{missing}}", {}), /no value/);
});
test("XML escaping cannot inject rendering nodes", () =>
  assert.equal(
    escapeXml('<a x="x">&\''),
    "&lt;a x=&quot;x&quot;&gt;&amp;&apos;",
  ));
test("CR80 dimensions convert to exact 300 DPI pixels", () => {
  assert.equal(mmToPixels(85.6, 300), 1011);
  assert.equal(mmToPixels(53.98, 300), 638);
});
test("template rejects duplicate element identifiers", () => {
  const a = element("text", "Name");
  assert.throws(() => document([a, a]), /unique/);
});
test("template rejects unsafe colors and unbounded dimensions", () => {
  assert.throws(() =>
    elementSchema.parse({
      ...element("text", "Name"),
      fill: "url(http://attacker)",
    }),
  );
  assert.throws(() => templateSchema.parse({ ...document([]), width: 10000 }));
});
test("render resolves text without markup injection", async () => {
  const out = await renderSide(
    document([element("text", "{{name}}")]),
    "front",
    { name: "<svg>& Person" },
    noAssets,
  );
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 1011);
  assert.equal(meta.height, 638);
  assert.equal(meta.density, 300);
});
test("render rejects overflowing text and missing bindings", async () => {
  await assert.rejects(
    renderSide(
      document([{ ...element("text", "A".repeat(200)), height: 4 }]),
      "front",
      {},
      noAssets,
    ),
    /overflows/,
  );
  await assert.rejects(
    renderSide(
      document([element("text", "{{absent}}")]),
      "front",
      {},
      noAssets,
    ),
    /no value/,
  );
});
test("QR survives full card PNG rendering and independently decodes", async () => {
  const url = "https://cards.example.org/verify/secure-id-123";
  const out = await renderSide(
    document([element("qr", url)]),
    "front",
    {},
    noAssets,
  );
  const { data, info } = await sharp(out)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(
    jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data,
    url,
  );
});
test("Code128 survives full card rendering and independently decodes", async () => {
  const out = await renderSide(
    document([element("barcode", "EMP-00123")]),
    "front",
    {},
    noAssets,
  );
  assert.equal(await decode(out), "EMP-00123");
});
test("invalid EAN data, non-square QR and low contrast are rejected", () => {
  assert.throws(
    () => codeSvg({ ...element("barcode", "ABC"), barcode: "ean13" }, "ABC"),
    /not valid/,
  );
  assert.throws(
    () => codeSvg({ ...element("qr", "x"), height: 10 }, "x"),
    /square/,
  );
  assert.throws(
    () => codeSvg({ ...element("qr", "x"), fill: "#ffffff" }, "x"),
    /contrast/,
  );
});
test("CSV preserves quotes, Unicode, BOM and column positions", async () => {
  const p = await parseSheet(
    Buffer.from('\uFEFFexternal_id,name\r\n001,"A, B"\r\n002,अनिता\r\n'),
    "test.csv",
  );
  assert.deepEqual(p.columns, ["external_id", "name"]);
  assert.equal(p.rows[0].name, "A, B");
  assert.equal(p.rows[1].name, "अनिता");
});
test("CSV duplicate headers and ragged rows are rejected", async () => {
  await assert.rejects(
    parseSheet(Buffer.from("id,id\n1,2"), "a.csv"),
    /Headers/,
  );
  await assert.rejects(parseSheet(Buffer.from("id,name\n1,A,extra"), "a.csv"));
});
test("XLSX values import and formulas are rejected", async () => {
  const w = new ExcelJS.Workbook(),
    s = w.addWorksheet("People");
  s.addRow(["external_id", "name"]);
  s.addRow(["001", "Person One"]);
  const p = await parseSheet(
    Buffer.from(await w.xlsx.writeBuffer()),
    "people.xlsx",
  );
  assert.equal(p.rows[0].external_id, "001");
  s.getCell("B2").value = { formula: "1+1", result: 2 };
  await assert.rejects(
    parseSheet(Buffer.from(await w.xlsx.writeBuffer()), "formula.xlsx"),
    /formulas/,
  );
});
test("invalid ZIP archives fail without extracting files", async () => {
  await assert.rejects(
    zipEntries(Buffer.from("bad"), async () => {}),
    /could not be opened/,
  );
});
test("error CSV neutralizes spreadsheet formula injection", () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell("Normal"), '"Normal"');
});
test("storage keys reject traversal and arbitrary extensions", () => {
  assert.throws(() => storagePath("../secrets.env"));
  assert.throws(() => storagePath("photos/../x.png"));
  assert.throws(() => storagePath("photos/a.svg"));
  assert.match(storagePath("photos/a.png"), /a\.png$/);
});
test("request body limit applies to actual stream bytes", async () => {
  const request = new Request("http://localhost", {
    method: "POST",
    body: "12345",
  });
  await assert.rejects(limitedBody(request, 4), /exceeds/);
});
test("person validation rejects missing names, malformed email and unsafe field values", () => {
  assert.throws(() => personSchema.parse({ external_id: "1", name: "" }));
  assert.throws(() =>
    personSchema.parse({ external_id: "1", name: "A", email: "bad" }),
  );
  assert.throws(() =>
    personSchema.parse({
      external_id: "1",
      name: "A",
      custom_fields: { x: { nested: true } },
    }),
  );
});
test("number formats support prefix, year, department, sequence, UUID and random values", () => {
  assert.equal(
    cardNumber(
      "{{prefix}}/{{year}}/{{dept}}/{{seq}}",
      "ACME",
      "42",
      5,
      "ENG",
      2026,
    ),
    "ACME/2026/ENG/00042",
  );
  assert.match(cardNumber("{{uuid}}", "A", "1", 1, ""), /^[a-f0-9-]{36}$/);
  assert.match(cardNumber("{{random}}", "A", "1", 1, ""), /^[A-F0-9]{24}$/);
  assert.throws(
    () => cardNumber("{{dept}}-{{seq}}", "A", "1", 1, ""),
    /requires a department/,
  );
  assert.throws(
    () =>
      numberingSchema.parse({
        prefix: "A",
        pattern: "{{year}}",
        padding: 6,
        start: 1,
      }),
    /unique/,
  );
});
test("renderer rejects codes too small to scan reliably", async () => {
  await assert.rejects(
    renderSide(
      document([
        {
          ...element("qr", "https://example.org/verify/long-token"),
          width: 3,
          height: 3,
        },
      ]),
      "front",
      {},
      noAssets,
    ),
    /too small/,
  );
});
for (const [format, value] of [
  ["code39", "EMP123"],
  ["ean13", "5901234123457"],
  ["ean8", "96385074"],
  ["upca", "012345678905"],
  ["upce", "04252614"],
] as const) {
  test(`${format} renders a decodable linear barcode`, async () => {
    const out = await renderSide(
      document([{ ...element("barcode", value), barcode: format }]),
      "front",
      {},
      noAssets,
    );
    const decoded = await decode(out);
    if (format === "upca")
      assert.ok(decoded === "0" + value || decoded === value);
    else if (format === "upce")
      assert.ok(
        ["04252614", "042100005264", "0042100005264"].includes(decoded),
        "UPC-E must decode to the same compressed, expanded UPC-A or normalized GTIN-13 identifier.",
      );
    else assert.equal(decoded, value);
  });
}

test("photos auto-fill square frames without distortion and contain preserves the full image", async () => {
  const source = await sharp({
    create: { width: 200, height: 100, channels: 3, background: "#ff0000" },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 100,
            height: 100,
            channels: 3,
            background: "#00ff00",
          },
        })
          .png()
          .toBuffer(),
        left: 50,
        top: 0,
      },
    ])
    .png()
    .toBuffer();
  const frame = {
    id: randomUUID(),
    type: "photo",
    x: 0,
    y: 0,
    width: 25.4,
    height: 25.4,
  };
  const render = async (fit: string) => {
    const out = await renderSide(
      templateSchema.parse({
        schemaVersion: 1,
        width: 25.4,
        height: 25.4,
        dpi: 200,
        background: "#ffffff",
        front: [{ ...frame, fit }],
        back: [],
      }),
      "front",
      { photo_asset_id: randomUUID() },
      async () => source,
    );
    return sharp(out).removeAlpha().raw().toBuffer();
  };
  const pixel = (buffer: Buffer, x: number, y: number) => [
    ...buffer.subarray(
      (y * 2 * 200 + x * 2) * 3,
      (y * 2 * 200 + x * 2) * 3 + 3,
    ),
  ];
  const filled = await render("cover");
  assert.deepEqual(pixel(filled, 10, 50), [0, 255, 0]);
  assert.deepEqual(pixel(filled, 90, 50), [0, 255, 0]);
  const contained = await render("contain");
  assert.deepEqual(pixel(contained, 50, 5), [255, 255, 255]);
  assert.deepEqual(pixel(contained, 5, 50), [255, 0, 0]);
  assert.deepEqual(pixel(contained, 50, 50), [0, 255, 0]);
});
