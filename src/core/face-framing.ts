import sharp from "sharp";
import jsfeat from "jsfeat";
import { createHash } from "node:crypto";
import cascade from "./face-cascade.json";
export type FaceBox = { x: number; y: number; width: number; height: number };
const cache = new Map<string, FaceBox | null>();
export function faceCrop(
  width: number,
  height: number,
  face: FaceBox,
  aspect: number,
) {
  let h = Math.max(face.height * 2.6, (face.width * 2) / aspect),
    w = h * aspect;
  const scale = Math.min(1, width / w, height / h);
  w = Math.max(1, Math.floor(w * scale));
  h = Math.max(1, Math.floor(h * scale));
  return {
    left: Math.max(
      0,
      Math.min(width - w, Math.round(face.x + face.width / 2 - w / 2)),
    ),
    top: Math.max(
      0,
      Math.min(height - h, Math.round(face.y + face.height / 2 - h * 0.4)),
    ),
    width: w,
    height: h,
  };
}
export async function detectPortraitFace(
  bytes: Buffer,
): Promise<FaceBox | null> {
  const key = createHash("sha256").update(bytes).digest("hex");
  if (cache.has(key)) return cache.get(key)!;
  const { data, info } = await sharp(bytes)
    .rotate()
    .resize({
      width: 320,
      height: 320,
      fit: "inside",
      withoutEnlargement: true,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const gray = new jsfeat.matrix_t(
    info.width,
    info.height,
    jsfeat.U8_t | jsfeat.C1_t,
  );
  jsfeat.imgproc.grayscale(data, info.width, info.height, gray);
  jsfeat.imgproc.equalize_histogram(gray, gray);
  const size = (info.width + 1) * (info.height + 1),
    sum = new Int32Array(size),
    sq = new Float64Array(size),
    tilted = new Int32Array(size);
  jsfeat.imgproc.compute_integral_image(gray, sum, sq, tilted);
  const rects = jsfeat.haar
    .group_rectangles(
      jsfeat.haar.detect_multi_scale(
        sum,
        sq,
        tilted,
        null,
        info.width,
        info.height,
        cascade,
        1.2,
        1,
      ),
      2,
    )
    .sort((a: FaceBox, b: FaceBox) => b.width * b.height - a.width * a.height);
  const best = rects[0];
  // Ambiguous group photographs keep the normal crop; never guess between similarly sized faces.
  const face =
    best &&
    (!rects[1] ||
      best.width * best.height >= rects[1].width * rects[1].height * 1.8)
      ? {
          x: best.x / info.width,
          y: best.y / info.height,
          width: best.width / info.width,
          height: best.height / info.height,
        }
      : null;
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(key, face);
  return face;
}
export async function framePortrait(
  bytes: Buffer,
  width: number,
  height: number,
  automatic = true,
) {
  const oriented = await sharp(bytes)
    .rotate()
    .png()
    .toBuffer({ resolveWithObject: true });
  let pipeline = sharp(oriented.data);
  if (automatic) {
    const face = await detectPortraitFace(oriented.data);
    if (face)
      pipeline = pipeline.extract(
        faceCrop(
          oriented.info.width,
          oriented.info.height,
          {
            x: face.x * oriented.info.width,
            y: face.y * oriented.info.height,
            width: face.width * oriented.info.width,
            height: face.height * oriented.info.height,
          },
          width / height,
        ),
      );
  }
  return pipeline.resize(width, height, { fit: "cover" }).png().toBuffer();
}
