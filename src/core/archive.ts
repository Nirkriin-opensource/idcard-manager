import * as tar from "tar";
import { createReadStream } from "node:fs";
import {
  readdir,
  readFile,
  writeFile,
  stat,
  mkdir,
  chmod,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
export function parseEnvironment(text: string) {
  const data: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (
      !m ||
      ![
        "DATABASE_URL",
        "APP_ORIGIN",
        "STORAGE_ROOT",
        "NODE_ENV",
        "NEXT_TELEMETRY_DISABLED",
        "IDCARD_UPDATE_SOURCE",
      ].includes(m[1])
    )
      throw new Error(
        "Environment contains an unsupported or unsafe variable.",
      );
    let value = m[2].trim();
    if (value.startsWith('"')) value = JSON.parse(value);
    else if (value.startsWith("'")) {
      if (!value.endsWith("'"))
        throw new Error("Environment quote is incomplete.");
      value = value.slice(1, -1);
    }
    if (/[\0\r\n]/.test(value))
      throw new Error("Environment value contains a control character.");
    data[m[1]] = value;
  }
  if (!data.DATABASE_URL || !data.APP_ORIGIN || !data.STORAGE_ROOT)
    throw new Error("Environment is missing required configuration.");
  return data;
}
export async function shaFile(file: string) {
  const hash = createHash("sha256");
  for await (const part of createReadStream(file)) hash.update(part);
  return hash.digest("hex");
}
export async function backupFiles(
  root: string,
  prefix = "",
): Promise<string[]> {
  const files: string[] = [];
  for (const e of await readdir(path.join(root, prefix), {
    withFileTypes: true,
  })) {
    if (e.isSymbolicLink())
      throw new Error(
        "Backup refuses symbolic links. Move external files into managed storage first.",
      );
    const relative = (prefix ? prefix + "/" : "") + e.name;
    if (e.isDirectory()) files.push(...(await backupFiles(root, relative)));
    else if (e.isFile()) files.push(relative);
  }
  return files.sort();
}
export async function createBackupArchive(
  stage: string,
  output: string,
  version: string,
) {
  const files = await backupFiles(stage),
    checksums: Record<string, string> = {};
  for (const file of files)
    checksums[file] = await shaFile(path.join(stage, file));
  await writeFile(
    path.join(stage, "manifest.json"),
    JSON.stringify(
      { format: 1, version, created_at: new Date().toISOString(), checksums },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await tar.c({ file: output, gzip: true, cwd: stage, portable: true }, [
    "manifest.json",
    ...files,
  ]);
  await chmod(output, 0o600);
  await writeFile(
    output + ".sha256",
    (await shaFile(output)) + "  " + path.basename(output) + "\n",
    { mode: 0o600 },
  );
}
export function safeArchiveEntry(name: string, type: string) {
  return (
    !name.startsWith("/") &&
    !name.includes("\\") &&
    !name.split("/").includes("..") &&
    !/^[a-z]:/i.test(name) &&
    ["File", "Directory"].includes(type) &&
    /^(manifest\.json|db\.dump|config\.env|storage(?:\/.*)?)$/.test(name)
  );
}
export async function validateBackupArchive(
  file: string,
  stage: string,
  maxBytes = 100 * 1024 ** 3,
) {
  const seen = new Set<string>();
  let size = 0,
    count = 0;
  let unsafe = false;
  await tar.t({
    file,
    strict: true,
    onReadEntry: (e) => {
      if (
        !safeArchiveEntry(e.path, e.type) ||
        seen.has(e.path) ||
        ++count > 150000 ||
        (size += e.size) > maxBytes
      )
        unsafe = true;
      seen.add(e.path);
    },
  });
  if (unsafe) throw new Error("Unsafe, duplicate or oversized archive entry.");
  await mkdir(stage, { recursive: true, mode: 0o700 });
  await tar.x({
    file,
    cwd: stage,
    strict: true,
    preservePaths: false,
    noChmod: true,
    filter: (p, e) => safeArchiveEntry(p, "type" in e ? e.type : "File"),
  });
  const manifest = JSON.parse(
    await readFile(path.join(stage, "manifest.json"), "utf8"),
  );
  if (
    manifest.format !== 1 ||
    typeof manifest.version !== "string" ||
    !manifest.checksums ||
    Object.keys(manifest.checksums).length > 150000
  )
    throw new Error("Unsupported backup manifest.");
  const files = (await backupFiles(stage)).filter((f) => f !== "manifest.json");
  if (files.length !== Object.keys(manifest.checksums).length)
    throw new Error("Backup file list does not match manifest.");
  for (const f of files) {
    if (
      !safeArchiveEntry(f, "File") ||
      typeof manifest.checksums[f] !== "string" ||
      (await shaFile(path.join(stage, f))) !== manifest.checksums[f]
    )
      throw new Error("Backup checksum mismatch: " + f);
  }
  if (!files.includes("db.dump") || !files.includes("config.env"))
    throw new Error("Backup is missing database or environment.");
  await mkdir(path.join(stage, "storage"), { recursive: true, mode: 0o700 });
  return {
    manifest,
    environment: parseEnvironment(
      await readFile(path.join(stage, "config.env"), "utf8"),
    ),
  };
}
