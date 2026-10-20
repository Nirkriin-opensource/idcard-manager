import { framePortrait } from "./face-framing.ts";
import sharp from "sharp";
import bwipjs from "@bwip-js/node";
import {
  bind,
  escapeXml,
  mmToPixels,
  templateSchema,
  type Template,
  type Element,
} from "./template.ts";
import { AppError } from "./errors.ts";
import { textFontRuns } from "./font-library.ts";
import { legacyFonts } from "./printing.ts";
export const RENDERER_VERSION = "0.24.0";
const loadedFonts = new Set<string>();
export type Resolver = (id: string) => Promise<Buffer>;
export function codeSvg(e: Element, value: string) {
  if (!value)
    throw new AppError(
      422,
      "QR/barcode data is empty.",
      "Enter text or a dynamic binding.",
    );
  if (e.type === "qr" && Math.abs(e.width - e.height) > 0.01)
    throw new AppError(
      422,
      "QR codes must be square.",
      "Set equal width and height.",
    );
  const luminance = (hex: string) => {
    const rgb = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  if ((luminance(e.background) + 0.05) / (luminance(e.fill) + 0.05) < 4.5)
    throw new AppError(
      422,
      "Code colors have insufficient contrast.",
      "Use dark bars/modules on a light background with at least 4.5:1 contrast.",
    );
  const options = {
    bcid: e.type === "qr" ? "qrcode" : e.barcode,
    text: value,
    scale: 3,
    includetext: e.type !== "qr",
    padding: e.type === "qr" ? 8 : 20,
    eclevel: e.errorCorrection,
    barcolor: e.fill.slice(1),
    backgroundcolor: e.background.slice(1),
  };
  try {
    return bwipjs.toSVG(options);
  } catch {
    throw new AppError(
      422,
      "Barcode data is not valid for the selected format.",
      "Check the character set, length and checksum; use Code 128 for general identifiers.",
    );
  }
}
function wrap(text: string, width: number, size: number) {
  const max = Math.max(1, Math.floor(width / (size * 0.62))),
    lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if ((line + " " + word).trim().length > max && line) {
        lines.push(line);
        line = "";
      }
      if (word.length > max) {
        if (line) {
          lines.push(line);
          line = "";
        }
        for (let i = 0; i < word.length; i += max)
          lines.push(word.slice(i, i + max));
      } else line += (line ? " " : "") + word;
    }
    if (line || !paragraph) lines.push(line);
  }
  return lines;
}
export async function renderSide(
  document: Template,
  side: "front" | "back",
  fields: Record<string, unknown>,
  resolve: Resolver,
  transparent = false,
) {
  const d = templateSchema.parse(document),
    width = mmToPixels(d.width, d.dpi),
    height = mmToPixels(d.height, d.dpi);
  if (width * height > 40_000_000)
    throw new AppError(
      422,
      "Render exceeds 40 megapixels.",
      "Reduce physical size or DPI.",
    );
  const parts = transparent
    ? []
    : [`<rect width="100%" height="100%" fill="${d.background}"/>`];
  for (const e of d[side]) {
    const transform = `translate(${e.x} ${e.y}) rotate(${e.rotation})`;
    let shape = "";
    if (e.type === "text" || e.type === "date") {
      const value = bind(e.text, fields);
      if (
        value &&
        (d.textEngine === "pango" ||
          !legacyFonts.includes(e.fontFamily) ||
          /[^\x00-\x7f]/.test(value))
      ) {
        const runs = await textFontRuns(value, e.fontFamily, d.fontFiles);
        for (const run of runs)
          if (!loadedFonts.has(run.font.id)) {
            await sharp({
              text: {
                text: escapeXml(
                  [...run.text.trim()].slice(0, 8).join("") || "A",
                ),
                font: `${run.font.family} 10`,
                fontfile: run.font.file,
                rgba: true,
              },
            })
              .png()
              .toBuffer();
            loadedFonts.add(run.font.id);
          }
        const markup = runs
          .map(
            (run) =>
              `<span font_family="${escapeXml(run.font.family)}">${escapeXml(run.text)}</span>`,
          )
          .join("");
        const png = await sharp({
          text: {
            text: `<span foreground="${e.fill}" lang="${escapeXml(e.language || d.language || "en")}">${markup}</span>`,
            font: `${e.fontFamily} ${e.bold ? "Bold " : ""}${e.italic ? "Italic " : ""}${(e.fontSize * 72) / 25.4}`,
            fontfile: runs[0].font.file,
            dpi: d.dpi,
            width: Math.max(1, mmToPixels(e.width, d.dpi)),
            rgba: true,
            align: e.align,
            wrap: "word-char",
          },
        })
          .png()
          .toBuffer();
        const metadata = await sharp(png).metadata(),
          textWidth = (metadata.width! * 25.4) / d.dpi,
          textHeight = (metadata.height! * 25.4) / d.dpi;
        if (metadata.height! > mmToPixels(e.height, d.dpi))
          throw new AppError(
            422,
            `Multilingual text ${e.id} overflows its box.`,
            "Increase its height or reduce font size. Text is never silently clipped or shrunk.",
          );
        const offset =
          e.align === "right"
            ? Math.max(0, e.width - textWidth)
            : e.align === "center"
              ? Math.max(0, (e.width - textWidth) / 2)
              : 0;
        shape = `<image x="${offset}" width="${textWidth}" height="${textHeight}" href="data:image/png;base64,${png.toString("base64")}"/>`;
      } else {
        const lines = wrap(value, e.width, e.fontSize);
        if (lines.length * e.fontSize * 1.25 > e.height)
          throw new AppError(
            422,
            `Text ${e.id} overflows its box.`,
            "Enlarge the box or reduce font size.",
          );
        const x =
          e.align === "center"
            ? e.width / 2
            : e.align === "right"
              ? e.width
              : 0;
        shape = `<text fill="${e.fill}" font-family="${escapeXml(e.fontFamily)}" font-size="${e.fontSize}" font-weight="${e.bold ? "bold" : "normal"}" font-style="${e.italic ? "italic" : "normal"}" text-anchor="${e.align === "center" ? "middle" : e.align === "right" ? "end" : "start"}">${lines.map((l, i) => `<tspan x="${x}" y="${e.fontSize + i * e.fontSize * 1.25}">${escapeXml(l)}</tspan>`).join("")}</text>`;
      }
    } else if (e.type === "rect")
      shape = `<rect width="${e.width}" height="${e.height}" fill="${e.fill}" stroke="${e.stroke}" stroke-width="${e.strokeWidth}"/>`;
    else if (e.type === "ellipse")
      shape = `<ellipse cx="${e.width / 2}" cy="${e.height / 2}" rx="${e.width / 2}" ry="${e.height / 2}" fill="${e.fill}" stroke="${e.stroke}" stroke-width="${e.strokeWidth}"/>`;
    else if (e.type === "line")
      shape = `<line x1="0" y1="0" x2="${e.width}" y2="${e.height}" stroke="${e.stroke}" stroke-width="${e.strokeWidth || 0.3}"/>`;
    else if (e.type === "qr" || e.type === "barcode") {
      const value = bind(e.text, fields),
        svg = codeSvg(e, value);
      if (e.type === "qr") {
        const raw = bwipjs.raw({
          bcid: "qrcode",
          text: value,
          eclevel: e.errorCorrection,
        } as bwipjs.RawOptions);
        const modules = "pixx" in raw[0] ? raw[0].pixx : 0;
        if (!modules || mmToPixels(e.width, d.dpi) / (modules + 8) < 3)
          throw new AppError(
            422,
            "QR modules are too small at the selected resolution.",
            "Enlarge the QR code or increase the template DPI; at least 3 pixels per module including a four-module quiet zone are required.",
          );
      } else {
        const raw = bwipjs.raw({ bcid: e.barcode, text: value });
        if ("sbs" in raw[0]) {
          const widths = raw[0].sbs.filter((w) => w > 0),
            narrow = Math.min(...widths),
            total = widths.reduce((a, b) => a + b, 0);
          if ((mmToPixels(e.width, d.dpi) * narrow) / (total + 20 * narrow) < 2)
            throw new AppError(
              422,
              "Barcode bars are too narrow at the selected resolution.",
              "Enlarge the barcode, shorten its data or increase DPI.",
            );
        }
      }
      shape = `<image width="${e.width}" height="${e.height}" preserveAspectRatio="${e.type === "barcode" ? "none" : "xMidYMid meet"}" href="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"/>`;
    } else {
      if (e.type === "map" && !fields["location.enabled"])
        throw new AppError(
          422,
          "Location is disabled for this organization.",
          "Enable location explicitly or remove the map element.",
        );
      const id = e.assetField
        ? String(fields[e.assetField] || e.assetId || "")
        : e.type === "photo"
          ? String(fields["photo_asset_id"] || e.assetId || "")
          : e.type === "map"
            ? String(e.assetId || fields["location.map_asset_id"] || "")
            : e.assetId;
      if (!id && e.optional) continue;
      if (!id)
        throw new AppError(
          422,
          `Image ${e.id} has no asset.`,
          "Upload a photo or select an image.",
        );
      const bytes = await resolve(id);
      const pw = Math.max(1, mmToPixels(e.width, d.dpi)),
        ph = Math.max(1, mmToPixels(e.height, d.dpi));
      const image =
        e.type === "photo" && e.fit === "cover"
          ? await framePortrait(bytes, pw, ph, e.faceFit)
          : await sharp(bytes)
              .rotate()
              .resize(pw, ph, {
                fit: e.fit,
                background: { r: 255, g: 255, b: 255, alpha: 0 },
              })
              .png()
              .toBuffer();
      shape = `<image width="${e.width}" height="${e.height}" href="data:image/png;base64,${image.toString("base64")}"/>`;
    }
    parts.push(`<g transform="${transform}">${shape}</g>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${d.width} ${d.height}">${parts.join("")}</svg>`;
  return sharp(Buffer.from(svg), { limitInputPixels: 40_000_000 })
    .png()
    .withMetadata({ density: d.dpi })
    .toBuffer();
}
