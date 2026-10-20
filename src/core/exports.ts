import { z } from "zod";
import sharp from "sharp";
import PDFDocument from "pdfkit";
import { ZipArchive } from "archiver";
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, readFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import type pg from "pg";
import { randomUUID } from "node:crypto";
import { templateSchema, mmToPixels } from "./template.ts";
import { renderSide } from "./render.ts";
import { assetBytes, storagePath } from "./storage.ts";
import { requireRow } from "./cards.ts";
import { AppError } from "./errors.ts";
export const exportSchema = z.object({
  format: z.enum(["png", "jpg", "pdf", "zip"]).default("pdf"),
  imageFormat: z.enum(["png", "jpg"]).default("png"),
  dpi: z.number().int().min(150).max(600).default(300),
  quality: z.number().int().min(50).max(100).default(95),
  background: z
    .string()
    .regex(/^#[a-fA-F0-9]{6}$/)
    .optional(),
  transparent: z.boolean().default(false),
  side: z.enum(["front", "back", "both"]).default("front"),
  layout: z.enum(["card", "sheet"]).default("card"),
  paper: z.enum(["A4", "A3", "Letter", "custom"]).default("A4"),
  paperWidth: z.number().min(30).max(1000).default(210),
  paperHeight: z.number().min(30).max(1000).default(297),
  columns: z.number().int().min(1).max(10).default(2),
  rows: z.number().int().min(1).max(20).default(4),
  margin: z.number().min(0).max(100).default(10),
  gap: z.number().min(0).max(50).default(6),
  bleed: z.number().min(0).max(5).default(0),
  cropMarks: z.boolean().default(false),
  duplex: z.enum(["long", "short"]).default("long"),
  backRotate: z.boolean().default(false),
});
export type ExportOptions = z.infer<typeof exportSchema>;
export const pt = (mm: number) => (mm * 72) / 25.4;
export function layoutPlan(width: number, height: number, raw: unknown) {
  const o = exportSchema.parse(raw);
  const paper =
    o.paper === "A4"
      ? [210, 297]
      : o.paper === "A3"
        ? [297, 420]
        : o.paper === "Letter"
          ? [215.9, 279.4]
          : [o.paperWidth, o.paperHeight];
  const cols = o.layout === "card" ? 1 : o.columns,
    rows = o.layout === "card" ? 1 : o.rows,
    slotW = width + 2 * o.bleed,
    slotH = height + 2 * o.bleed;
  const pw = o.layout === "card" ? slotW : paper[0],
    ph = o.layout === "card" ? slotH : paper[1],
    margin = o.layout === "card" ? 0 : o.margin;
  if (
    cols * slotW + (cols - 1) * o.gap + 2 * margin > pw + 0.01 ||
    rows * slotH + (rows - 1) * o.gap + 2 * margin > ph + 0.01
  )
    throw new AppError(
      422,
      "Cards do not fit this print sheet.",
      "Reduce rows/columns, margins, spacing or bleed, or choose larger paper.",
    );
  if (o.cropMarks && o.layout === "sheet" && (margin < 4 || o.gap < 6))
    throw new AppError(
      422,
      "Crop marks need clearance.",
      "Use margins of at least 4 mm and spacing of at least 6 mm.",
    );
  return {
    pw,
    ph,
    cols,
    rows,
    capacity: cols * rows,
    slotW,
    slotH,
    position(index: number, back = false) {
      let x = index % cols,
        y = Math.floor(index / cols);
      if (back && o.side === "both") {
        if (o.duplex === "long") x = cols - 1 - x;
        else y = rows - 1 - y;
      }
      return {
        x: margin + x * (slotW + o.gap),
        y: margin + y * (slotH + o.gap),
      };
    },
  };
}
export async function renderExport(
  c: pg.PoolClient,
  org: string,
  renderId: string,
  side: "front" | "back",
  raw: unknown,
) {
  const o = exportSchema.parse(raw),
    r = await requireRow(
      c,
      "SELECT r.*,v.document FROM card_renders r JOIN template_versions v ON v.id=r.template_version_id WHERE r.organization_id=$1 AND r.id=$2",
      [org, renderId],
    );
  if (side === "back" && !r.back_asset_id) return null;
  const frozen = structuredClone(r.snapshot._document || r.document);
  for (const side of ["front", "back"] as const)
    for (const element of frozen[side])
      if (element.type === "photo" && element.faceFit === undefined)
        element.faceFit = false;
  const original = templateSchema.parse(frozen),
    document = {
      ...original,
      dpi: o.dpi,
      background: o.background || original.background,
    };
  const bytes = await renderSide(
    document,
    side,
    r.snapshot,
    (id) => assetBytes(c, org, id),
    o.transparent && o.format !== "jpg",
  );
  if (
    (o.format === "jpg" || o.imageFormat === "jpg") &&
    o.quality < 85 &&
    document[side].some((e) => e.type === "qr" || e.type === "barcode")
  )
    throw new AppError(
      422,
      "JPEG quality is too low for a card containing codes.",
      "Use quality 85 or higher, or export lossless PNG.",
    );
  let image = sharp(bytes);
  if (o.bleed) {
    const b = mmToPixels(o.bleed, o.dpi);
    image = image.extend({
      top: b,
      bottom: b,
      left: b,
      right: b,
      extendWith: "copy",
    });
  }
  if (o.format === "jpg" || (o.format === "zip" && o.imageFormat === "jpg"))
    return image
      .flatten({ background: o.background || original.background })
      .jpeg({ quality: o.quality, chromaSubsampling: "4:4:4" })
      .withMetadata({ density: o.dpi })
      .toBuffer();
  return image.png().withMetadata({ density: o.dpi }).toBuffer();
}
export async function createExport(
  c: pg.PoolClient,
  org: string,
  ids: string[],
  raw: unknown,
  onProgress: (count: number) => Promise<void> = async () => {},
) {
  await import("./retention-lock.ts").then((m) => m.retentionLock(c, org));
  const o = exportSchema.parse(raw);
  if (!ids.length)
    throw new AppError(
      400,
      "No card renders were selected.",
      "Generate and select at least one card.",
    );
  const first = await requireRow(
      c,
      "SELECT COALESCE(r.snapshot->'_document',v.document) AS document FROM card_renders r JOIN template_versions v ON v.id=r.template_version_id WHERE r.organization_id=$1 AND r.id=$2",
      [org, ids[0]],
    ),
    doc = templateSchema.parse(first.document);
  const ext =
      o.format === "png" || o.format === "jpg"
        ? o.format
        : o.format === "zip"
          ? "zip"
          : "pdf",
    key = `exports/${org}/${randomUUID()}.${ext}`,
    target = storagePath(key),
    temp = target + ".partial";
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  if (o.format === "png" || o.format === "jpg") {
    if (ids.length !== 1 || o.side === "both")
      throw new AppError(
        400,
        "A single image needs one card and one side.",
        "Use ZIP or PDF for multiple cards/sides.",
      );
    const b = await renderExport(c, org, ids[0], o.side, o);
    if (!b)
      throw new AppError(
        404,
        "Selected card has no back side.",
        "Export the front or use a two-sided template.",
      );
    await import("./storage.ts").then((m) => m.atomicWrite(key, b));
    await onProgress(1);
    return key;
  }
  if (o.format === "zip") {
    const archive = new ZipArchive({ zlib: { level: 6 } }),
      output = createWriteStream(temp, { mode: 0o600 });
    const done = pipeline(archive, output);
    done.catch(() => {});
    try {
      let n = 0;
      for (const id of ids) {
        for (const side of (o.side === "both"
          ? ["front", "back"]
          : [o.side]) as ("front" | "back")[]) {
          const image = await renderExport(c, org, id, side, o);
          if (image) {
            // Wait for each entry to drain before retaining another rendered image.
            const written = new Promise<void>((resolve, reject) => {
              archive.once("entry", () => {
                archive.off("error", reject);
                resolve();
              });
              archive.once("error", reject);
            });
            archive.append(image, { name: `${id}-${side}.${o.imageFormat}` });
            await written;
          }
        }
        await onProgress(++n);
      }
      await archive.finalize();
      await done;
      await rename(temp, target);
    } catch (e) {
      archive.abort();
      output.destroy();
      throw e;
    }
    return key;
  }
  const plan = layoutPlan(doc.width, doc.height, o),
    pdf = new PDFDocument({
      autoFirstPage: false,
      compress: true,
      info: { Title: "ID Card print export", Creator: "ID Card Management" },
    }),
    done = pipeline(pdf, createWriteStream(temp, { mode: 0o600 }));
  done.catch(() => {});
  try {
    let completed = 0;
    for (let start = 0; start < ids.length; start += plan.capacity) {
      const group = ids.slice(start, start + plan.capacity);
      for (const side of (o.side === "both" ? ["front", "back"] : [o.side]) as (
        "front" | "back"
      )[]) {
        pdf.addPage({ size: [pt(plan.pw), pt(plan.ph)], margin: 0 });
        for (let i = 0; i < group.length; i++) {
          const r = await requireRow(
            c,
            "SELECT COALESCE(r.snapshot->'_document',v.document) AS document FROM card_renders r JOIN template_versions v ON v.id=r.template_version_id WHERE r.organization_id=$1 AND r.id=$2",
            [org, group[i]],
          );
          if (
            r.document.width !== doc.width ||
            r.document.height !== doc.height
          )
            throw new AppError(
              422,
              "Selected cards have different physical sizes.",
              "Export each card size in a separate batch.",
            );
          const image = await renderExport(c, org, group[i], side, o),
            pos = plan.position(i, side === "back");
          if (image) {
            pdf.save();
            if (side === "back" && o.backRotate)
              pdf.rotate(180, {
                origin: [
                  pt(pos.x + plan.slotW / 2),
                  pt(pos.y + plan.slotH / 2),
                ],
              });
            pdf.image(image, pt(pos.x), pt(pos.y), {
              width: pt(plan.slotW),
              height: pt(plan.slotH),
            });
            pdf.restore();
          }
          if (o.cropMarks && o.layout === "sheet") {
            const x = pos.x + o.bleed,
              y = pos.y + o.bleed;
            pdf.lineWidth(0.3).strokeColor("#222222");
            for (const [cx, cy] of [
              [x, y],
              [x + doc.width, y],
              [x, y + doc.height],
              [x + doc.width, y + doc.height],
            ]) {
              const dx = cx === x ? -1 : 1,
                dy = cy === y ? -1 : 1;
              pdf
                .moveTo(pt(cx + dx * (o.bleed + 0.8)), pt(cy))
                .lineTo(pt(cx + dx * (o.bleed + 2.5)), pt(cy))
                .stroke();
              pdf
                .moveTo(pt(cx), pt(cy + dy * (o.bleed + 0.8)))
                .lineTo(pt(cx), pt(cy + dy * (o.bleed + 2.5)))
                .stroke();
            }
          }
        }
      }
      completed += group.length;
      await onProgress(completed);
    }
    pdf.end();
    await done;
    await rename(temp, target);
    return key;
  } catch (e) {
    pdf.destroy();
    throw e;
  }
}
export async function downloadExport(key: string) {
  const filename = storagePath(key);
  await stat(filename);
  return filename;
}
