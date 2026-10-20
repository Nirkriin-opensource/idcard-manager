import { create as createFont } from "fontkit";
import { createHash, randomUUID } from "node:crypto";
import {
  readdir,
  readFile,
  writeFile,
  mkdir,
  rename,
  stat,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fontFamilySchema, printLanguages, legacyFonts } from "./printing.ts";
import { AppError } from "./errors.ts";
type Face = {
  familyName: string;
  subfamilyName: string;
  characterSet: number[];
  postscriptName: string;
};
export type FontRecord = {
  id: string;
  family: string;
  style: string;
  file: string;
  ranges: number[][];
  source: "PC" | "System" | "Uploaded";
};
const preference = (font: FontRecord) =>
  (/^(regular|normal|book)$/i.test(font.style) ? 100 : 0) +
  (font.source === "Uploaded" ? 3 : font.source === "PC" ? 2 : 1);
type Catalog = { version: 1; fonts: FontRecord[]; updated: string };
let cached: { root: string; catalog: Catalog; modified: number } | undefined;
let pending: Promise<Catalog> | undefined;
const root = () =>
  path.resolve(process.env.STORAGE_ROOT || "./storage", "templates", "fonts");
const indexPath = () => path.join(root(), "catalog.json");
const extensions = /\.(ttf|otf|ttc)$/i;
const systemRoots = () =>
  process.platform === "win32"
    ? [
        path.join(process.env.WINDIR || "C:/Windows", "Fonts"),
        path.join(
          process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData/Local"),
          "Microsoft/Windows/Fonts",
        ),
      ]
    : ["/usr/share/fonts", "/usr/local/share/fonts"];
export function fontCovers(font: Pick<FontRecord, "ranges">, text: string) {
  return [...text]
    .filter((c) => !/[\s\p{Default_Ignorable_Code_Point}]/u.test(c))
    .every((c) => {
      const point = c.codePointAt(0)!;
      return font.ranges.some(([start, end]) => point >= start && point <= end);
    });
}
function records(buffer: Buffer, file: string, source: FontRecord["source"]) {
  if (
    buffer.length > 40 * 1024 * 1024 ||
    buffer.length < 12 ||
    !["00010000", "4f54544f", "74746366", "74727565"].includes(
      buffer.subarray(0, 4).toString("hex"),
    )
  )
    throw new AppError(
      400,
      "Not a supported font file.",
      "Choose a valid TTF, OTF or TTC font up to 40 MB.",
    );
  const parsed = createFont(buffer) as Face | { fonts: Face[] },
    faces = "fonts" in parsed ? parsed.fonts : [parsed];
  const hash = createHash("sha256").update(buffer).digest("hex");
  return faces.map((face, index) => {
    const ranges: number[][] = [];
    for (const code of [...new Set(face.characterSet)].sort((a, b) => a - b)) {
      const last = ranges.at(-1);
      if (last && code === last[1] + 1) last[1] = code;
      else ranges.push([code, code]);
    }
    return {
      id: `${hash}_${index}`,
      family: fontFamilySchema.parse(face.familyName),
      style: String(face.subfamilyName || "Regular").slice(0, 100),
      file,
      ranges,
      source,
    };
  });
}
async function filesIn(directory: string, depth = 0): Promise<string[]> {
  if (depth > 7) return [];
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesIn(full, depth + 1)));
    else if (entry.isFile() && extensions.test(entry.name)) files.push(full);
    if (files.length >= 1500) break;
  }
  return files;
}
async function persist(catalog: Catalog) {
  await mkdir(root(), { recursive: true, mode: 0o700 });
  const temp = indexPath() + "." + randomUUID();
  await writeFile(temp, JSON.stringify(catalog), { mode: 0o600 });
  await rename(temp, indexPath());
  cached = {
    root: root(),
    catalog,
    modified: (await stat(indexPath())).mtimeMs,
  };
  return catalog;
}
export async function fontCatalog(refresh = false): Promise<Catalog> {
  if (
    !refresh &&
    cached?.root === root() &&
    cached.modified ===
      (await stat(indexPath()).catch(() => ({ mtimeMs: -1 }))).mtimeMs
  )
    return cached.catalog;
  if (pending) return pending;
  pending = (async () => {
    if (!refresh) {
      try {
        const saved = JSON.parse(await readFile(indexPath(), "utf8"));
        if (saved.version === 1 && Array.isArray(saved.fonts)) {
          cached = {
            root: root(),
            catalog: saved,
            modified: (await stat(indexPath())).mtimeMs,
          };
          return saved as Catalog;
        }
      } catch {}
    }
    const fonts: FontRecord[] =
      cached?.root === root()
        ? cached.catalog.fonts.filter((f) => f.source !== "System")
        : [];
    for (const directory of systemRoots())
      for (const file of await filesIn(directory)) {
        try {
          if ((await stat(file)).size <= 40 * 1024 * 1024)
            fonts.push(...records(await readFile(file), file, "System"));
        } catch {}
        if (fonts.length % 12 === 0)
          await new Promise((resolve) => setImmediate(resolve));
      }
    return persist({
      version: 1,
      fonts: [...new Map(fonts.map((f) => [f.id, f])).values()],
      updated: new Date().toISOString(),
    });
  })();
  try {
    return await pending;
  } finally {
    pending = undefined;
  }
}
async function stageFont(
  buffer: Buffer,
  filename: string,
  source: FontRecord["source"],
) {
  const ext = path.extname(filename).toLowerCase();
  if (!extensions.test(filename))
    throw new AppError(
      400,
      "Unsupported font extension.",
      "Upload TTF, OTF or TTC.",
    );
  const hash = createHash("sha256").update(buffer).digest("hex"),
    file = path.join(root(), "files", hash + ext);
  const additions = records(buffer, file, source);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    await writeFile(file, buffer, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return additions;
}
export async function importFont(
  buffer: Buffer,
  filename: string,
  source: FontRecord["source"] = "Uploaded",
) {
  const catalog = await fontCatalog(),
    additions = await stageFont(buffer, filename, source);
  await persist({
    version: 1,
    fonts: [
      ...new Map(
        [...catalog.fonts, ...additions].map((f) => [f.id, f]),
      ).values(),
    ],
    updated: new Date().toISOString(),
  });
  return additions.map(({ file: _file, ranges: _ranges, ...font }) => font);
}
export async function syncPcFonts() {
  let directories: string[];
  if (process.platform === "win32") directories = systemRoots();
  else {
    directories = ["/mnt/c/Windows/Fonts"];
    for (const user of await readdir("/mnt/c/Users", {
      withFileTypes: true,
    }).catch(() => []))
      if (
        user.isDirectory() &&
        !["Public", "Default", "Default User", "All Users"].includes(user.name)
      )
        directories.push(
          path.join(
            "/mnt/c/Users",
            user.name,
            "AppData/Local/Microsoft/Windows/Fonts",
          ),
        );
  }
  const files = (
    await Promise.all(directories.map((directory) => filesIn(directory)))
  )
    .flat()
    .slice(0, 1500);
  if (!files.length)
    throw new AppError(
      409,
      "PC fonts are not available on this server.",
      "For a remote server, upload the TTF/OTF/TTC files from your PC instead.",
    );
  const catalog = await fontCatalog(),
    collected = new Map(catalog.fonts.map((f) => [f.id, f]));
  let imported = 0,
    skipped = 0;
  for (const file of files) {
    try {
      if ((await stat(file)).size > 40 * 1024 * 1024) {
        skipped++;
        continue;
      }
      for (const font of await stageFont(await readFile(file), file, "PC"))
        collected.set(font.id, font);
      imported++;
    } catch {
      skipped++;
    }
    if ((imported + skipped) % 8 === 0)
      await new Promise((resolve) => setImmediate(resolve));
  }
  await persist({
    version: 1,
    fonts: [...collected.values()],
    updated: new Date().toISOString(),
  });
  return { imported, skipped, updated: new Date().toISOString() };
}
export async function publicFontCatalog() {
  const catalog = await fontCatalog(),
    families = new Map<string, FontRecord>();
  for (const font of catalog.fonts) {
    const old = families.get(font.family);
    if (!old || preference(font) >= preference(old))
      families.set(font.family, font);
  }
  return {
    updated: catalog.updated,
    fonts: [...families.values()]
      .sort((a, b) => a.family.localeCompare(b.family))
      .map((f) => ({
        id: f.id,
        family: f.family,
        style: f.style,
        source: f.source,
        languages: printLanguages
          .filter((l) => fontCovers(f, l.sample))
          .map((l) => l.code),
      })),
  };
}
export async function fontById(id: string) {
  if (!/^[a-f0-9]{64}_\d{1,3}$/.test(id))
    throw new AppError(
      404,
      "Font not found.",
      "Sync or upload the font first.",
    );
  const font = (await fontCatalog()).fonts.find((f) => f.id === id);
  const absolute = font && path.resolve(font.file);
  if (
    !font ||
    !absolute ||
    ![...systemRoots(), path.join(root(), "files")].some((directory) =>
      absolute.startsWith(path.resolve(directory) + path.sep),
    )
  )
    throw new AppError(
      404,
      "Font is unavailable.",
      "Sync or upload the font again.",
    );
  return font;
}
export async function textFontRuns(
  text: string,
  requested: string,
  frozen?: Record<string, string>,
) {
  const catalog = await fontCatalog(),
    fonts = [...catalog.fonts].sort((a, b) => preference(b) - preference(a));
  const available = frozen
    ? fonts.filter((f) => Object.values(frozen).includes(f.id))
    : fonts;
  let preferred = frozen?.[requested]
    ? await fontById(frozen[requested])
    : available.find((f) => f.family === requested);
  if (!preferred && legacyFonts.includes(requested))
    preferred =
      available.find(
        (f) =>
          f.family ===
          (requested.includes("Mono")
            ? "Courier New"
            : requested.includes("Serif")
              ? "Times New Roman"
              : "Arial"),
      ) ||
      available.find((f) => f.family === "Noto Sans") ||
      available[0];
  if (!preferred)
    throw new AppError(
      422,
      `Font ${requested} is not installed.`,
      "Sync PC fonts or choose an installed font from the print settings.",
    );
  const allowed = available;
  const runs: { font: FontRecord; text: string }[] = [];
  for (const character of text) {
    const last = runs.at(-1);
    const font =
      last &&
      /[\p{M}\p{Default_Ignorable_Code_Point}]/u.test(character) &&
      fontCovers(last.font, character)
        ? last.font
        : fontCovers(preferred, character)
          ? preferred
          : allowed.find((f) => fontCovers(f, character));
    if (!font)
      throw new AppError(
        422,
        `No installed font covers ${character} (U+${character.codePointAt(0)!.toString(16).toUpperCase()}).`,
        "Sync or upload a font for this language before printing.",
      );
    if (last?.font.id === font.id) last.text += character;
    else runs.push({ font, text: character });
  }
  return runs;
}
export async function snapshotFontFamilies() {
  const catalog = await publicFontCatalog();
  return Object.fromEntries(
    catalog.fonts.map((font) => [font.family, font.id]),
  );
}
