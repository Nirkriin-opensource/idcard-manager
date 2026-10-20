import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  chmod,
  stat,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import * as tar from "tar";
import {
  publicRootFiles,
  publicDirectories,
  publicReleasePath,
  hasRecognizableSecret,
} from "./release-policy.ts";

async function main() {
  const root = process.cwd();
  const output = path.resolve(root, ".production-dist");
  const packageInfo = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  const release = JSON.parse(
    await readFile(path.join(root, "release.json"), "utf8"),
  );
  if (packageInfo.version !== release.version || packageInfo.license !== "MIT")
    throw new Error("Release version/license metadata does not agree.");
  const migrations = (await readdir(path.join(root, "src/db/migrations")))
    .filter((p) => p.endsWith(".sql"))
    .sort();
  if (JSON.stringify(migrations) !== JSON.stringify(release.migrations))
    throw new Error("Release metadata must list every migration in order.");
  const files: string[] = [];
  async function collect(relative: string) {
    const info = await lstat(path.join(root, relative));
    if (info.isSymbolicLink())
      throw new Error(`Source symlink requires review: ${relative}`);
    if (info.isDirectory()) {
      if (
        relative === "docs/screenshots" ||
        [
          "node_modules",
          "storage",
          "delivery",
          "backups",
          ".production-dist",
          ".git",
          ".next",
          "dist",
          "test-results",
          "__pycache__",
        ].includes(path.basename(relative))
      )
        return;
      for (const entry of (await readdir(path.join(root, relative))).sort())
        await collect(relative + "/" + entry);
    } else if (publicReleasePath(relative)) {
      const bytes = await readFile(path.join(root, relative));
      if (
        !/\.(png|jpg|jpeg|webp|woff2?|ttf|otf|ttc)$/i.test(relative) &&
        hasRecognizableSecret(bytes.toString("utf8"))
      )
        throw new Error(
          `Potential credential in ${relative}; publication cancelled.`,
        );
      files.push(relative);
    }
  }
  for (const entry of [...publicRootFiles, ...publicDirectories])
    await collect(entry);
  files.sort();
  const sha = (bytes: Buffer) =>
    createHash("sha256").update(bytes).digest("hex");
  await mkdir(output, { recursive: true });
  const staging = await mkdtemp(path.join(output, "staging-"));
  if (path.dirname(staging) !== output)
    throw new Error("Unexpected package staging location.");
  const name = `idcard-manager-${release.version}`;
  const folder = path.join(staging, name);
  await mkdir(folder);
  try {
    const manifestFiles = [];
    for (const file of files) {
      const destination = path.join(folder, file);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(path.join(root, file), destination);
      if (file.endsWith(".sh") || file === "deploy/scripts/idcardctl")
        await writeFile(
          destination,
          (await readFile(destination, "utf8")).replaceAll("\r\n", "\n"),
        );
      await chmod(
        destination,
        file.endsWith(".sh") || file === "deploy/scripts/idcardctl"
          ? 0o755
          : 0o644,
      );
      const bytes = await readFile(destination);
      manifestFiles.push({
        path: file,
        bytes: bytes.length,
        sha256: sha(bytes),
      });
    }
    const npm = process.env.npm_execpath;
    if (!npm)
      throw new Error(
        "Run through npm run package:production so npm can generate the SBOM.",
      );
    const sbom = spawnSync(
      process.execPath,
      [
        npm,
        "sbom",
        "--package-lock-only",
        "--omit=dev",
        "--sbom-format=cyclonedx",
        "--sbom-type=application",
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
    );
    if (sbom.status !== 0)
      throw new Error("SBOM generation failed: " + sbom.stderr.slice(0, 1000));
    JSON.parse(sbom.stdout);
    await writeFile(path.join(folder, "SBOM.cdx.json"), sbom.stdout);
    await writeFile(
      path.join(folder, "SOURCE-MANIFEST.json"),
      JSON.stringify(
        {
          product: "IDcard Manager",
          version: release.version,
          license: "MIT",
          migrations,
          sourceFiles: manifestFiles,
          packaging:
            "Source and native Ubuntu installer; downloads dependencies during installation. No personal data, credentials, database dumps or runtime files included.",
        },
        null,
        2,
      ) + "\n",
    );
    const entries = [...files, "SBOM.cdx.json", "SOURCE-MANIFEST.json"].sort();
    const sums = [];
    for (const file of entries)
      sums.push(`${sha(await readFile(path.join(folder, file)))}  ${file}`);
    await writeFile(path.join(folder, "SHA256SUMS"), sums.join("\n") + "\n");
    const archive = path.join(output, name + ".tar.gz");
    await tar.c(
      {
        cwd: staging,
        file: archive,
        gzip: true,
        portable: true,
        noMtime: true,
        filter(file, info) {
          const type = (info.mode || 0) & 0o170000;
          const executable =
            type === 0o040000 ||
            file.endsWith(".sh") ||
            file.endsWith("/deploy/scripts/idcardctl");
          info.mode = type | (executable ? 0o755 : 0o644);
          return true;
        },
      },
      [name],
    );
    const contents: string[] = [];
    await tar.t({
      file: archive,
      onReadEntry(entry) {
        if (entry.type !== "Directory") contents.push(entry.path);
        if (
          (entry.path === `${name}/install.sh` ||
            entry.path === `${name}/deploy/scripts/idcardctl`) &&
          !((entry.mode || 0) & 0o111)
        )
          throw new Error(
            "Installer/operator executable permissions were lost.",
          );
      },
    });
    const expected = [...entries, "SHA256SUMS"]
      .map((f) => `${name}/${f}`)
      .sort();
    if (JSON.stringify(contents.sort()) !== JSON.stringify(expected))
      throw new Error(
        "Archive contents do not match the reviewed release manifest.",
      );
    for (const file of ["SBOM.cdx.json", "SOURCE-MANIFEST.json"])
      await cp(path.join(folder, file), path.join(output, file));
    const artifactNames = [
      name + ".tar.gz",
      "SBOM.cdx.json",
      "SOURCE-MANIFEST.json",
    ];
    await writeFile(
      path.join(output, "SHA256SUMS.txt"),
      (
        await Promise.all(
          artifactNames.map(
            async (file) =>
              `${sha(await readFile(path.join(output, file)))}  ${file}`,
          ),
        )
      ).join("\n") + "\n",
    );
    console.log(
      `Created ${archive} (${(await stat(archive)).size} bytes; ${files.length} reviewed source files).`,
    );
    console.log(
      "Includes installer, all migrations, lockfile, documentation, MIT license, SBOM and checksums. Installation requires internet access.",
    );
  } finally {
    // Only the verified, newly-created staging directory inside the package output is removed.
    if (path.dirname(staging) !== output)
      throw new Error("Refusing unexpected staging cleanup.");
    await rm(staging, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
