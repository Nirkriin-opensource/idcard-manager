import { mkdir, writeFile, rename, readFile, stat } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import type pg from "pg";
import { config } from "./config.ts";
import { AppError } from "./errors.ts";
export function storagePath(key: string) {
  if (
    !/^(photos|templates|generated|imports|exports|temp)\/[a-zA-Z0-9/_-]+\.(png|jpg|csv|xlsx|json|pdf|zip)$/.test(
      key,
    )
  )
    throw new AppError(
      400,
      "Invalid storage reference.",
      "Choose an uploaded asset.",
    );
  const root = config().storage,
    target = path.resolve(root, key);
  if (!target.startsWith(root + path.sep))
    throw new AppError(400, "Invalid storage path.", "Choose a valid asset.");
  return target;
}
export async function atomicWrite(key: string, data: Buffer) {
  const target = storagePath(key);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const tmp = target + "." + randomUUID() + ".partial";
  await writeFile(tmp, data, { mode: 0o600, flag: "wx" });
  await rename(tmp, target);
}
export async function storeImage(
  c: pg.PoolClient,
  org: string,
  input: Buffer,
  kind: string = "PHOTO",
  crop?: { left: number; top: number; width: number; height: number },
  collectionPrivate = false,
) {
  if (input.length > 12 * 1024 * 1024)
    throw new AppError(
      413,
      "Image exceeds 12 MB.",
      "Compress the image before uploading.",
    );
  const image = sharp(input, {
    limitInputPixels: 40_000_000,
    failOn: "warning",
  });
  let meta: Metadata;
  try {
    meta = await image.metadata();
  } catch {
    throw new AppError(
      422,
      "The image could not be decoded safely.",
      "Upload a valid JPEG, PNG or WebP below 40 megapixels.",
    );
  }
  if (
    !["jpeg", "png", "webp"].includes(meta.format || "") ||
    (meta.pages || 1) > 1
  )
    throw new AppError(
      400,
      "Unsupported image format.",
      "Upload a single-frame JPEG, PNG or WebP image.",
    );
  const id = randomUUID(),
    folder =
      kind === "RENDER"
        ? "generated"
        : kind === "PHOTO"
          ? "photos"
          : "templates";
  const key = `${folder}/${org}/${id}.png`,
    thumb = `${folder}/${org}/${id}_thumb.jpg`;
  let pipeline = image.rotate();
  if (crop) {
    const rotated = (meta.orientation || 0) >= 5,
      w = rotated ? meta.height! : meta.width!,
      h = rotated ? meta.width! : meta.height!;
    if (crop.left + crop.width > w || crop.top + crop.height > h)
      throw new AppError(
        422,
        "Crop is outside the image.",
        "Use pixel coordinates within the displayed image dimensions.",
      );
    pipeline = pipeline.extract(crop);
  }
  pipeline = pipeline.resize({
    width: kind === "RENDER" ? 12000 : 2400,
    height: kind === "RENDER" ? 12000 : 2400,
    fit: "inside",
    withoutEnlargement: true,
  });
  if (kind === "RENDER")
    pipeline = pipeline.withMetadata({ density: meta.density || 300 });
  const output = await pipeline.png().toBuffer();
  const info = await sharp(output).metadata();
  await atomicWrite(key, output);
  await atomicWrite(
    thumb,
    await sharp(output)
      .resize(240, 240, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 80 })
      .toBuffer(),
  );
  await c.query(
    "INSERT INTO assets(id,organization_id,kind,storage_key,thumbnail_key,sha256,width,height,collection_private) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      id,
      org,
      kind,
      key,
      thumb,
      createHash("sha256").update(output).digest("hex"),
      info.width,
      info.height,
      collectionPrivate,
    ],
  );
  return { id, width: info.width, height: info.height };
}
export async function assetBytes(
  c: pg.PoolClient,
  org: string,
  id: string,
  thumbnail = false,
  currentOnly = false,
) {
  const q = await c.query(
    "SELECT storage_key,thumbnail_key FROM assets WHERE organization_id=$1 AND id=$2 AND (NOT $3::boolean OR deleted_at IS NULL)",
    [org, id, currentOnly],
  );
  if (!q.rowCount)
    throw new AppError(
      404,
      "Asset not found.",
      "Upload the image again or select another asset.",
    );
  return readFile(
    storagePath(thumbnail ? q.rows[0].thumbnail_key : q.rows[0].storage_key),
  );
}
export async function storageHealthy() {
  await mkdir(path.join(config().storage, "temp"), { recursive: true });
  return stat(config().storage);
}
