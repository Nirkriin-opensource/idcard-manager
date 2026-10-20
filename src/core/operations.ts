import { runDatabaseFile } from "./database-files.ts";
import { spawnSync } from "node:child_process";
import {
  readFile,
  writeFile,
  mkdir,
  cp,
  rename,
  readdir,
  stat,
  realpath,
  rm,
  unlink,
  chmod,
  open,
  statfs,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import {
  parseEnvironment,
  createBackupArchive,
  validateBackupArchive,
  shaFile,
} from "./archive.ts";
const base = "/var/lib/idcard",
  envFile = "/etc/idcard/idcard.env",
  releases = "/opt/idcard/releases",
  current = "/opt/idcard/current";
function run(
  binary: string,
  args: string[],
  extra: Record<string, string | undefined> = {},
  capture = false,
) {
  const result = spawnSync(binary, args, {
    env: { ...process.env, ...extra },
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${binary} failed (${result.status}). ${capture ? result.stderr : "Inspect the preceding output and service journals."}`,
    );
  return result.stdout?.trim() || "";
}
async function environment() {
  const data = parseEnvironment(await readFile(envFile, "utf8"));
  pgEnvironment(data.DATABASE_URL);
  const storage = await realpath(data.STORAGE_ROOT);
  if (
    storage !== path.resolve(data.STORAGE_ROOT) ||
    (storage !== base + "/storage" && !storage.startsWith(base + "/restored/"))
  )
    throw new Error(
      "Server operations require real managed storage under /var/lib/idcard/storage or /var/lib/idcard/restored. Check STORAGE_ROOT before retrying.",
    );
  for (const [k, v] of Object.entries(data)) process.env[k] = v;
  return data;
}
function pgEnvironment(url: string, database?: string) {
  const u = new URL(url);
  if (u.port && u.port !== "5432")
    throw new Error(
      "Server operations require the managed PostgreSQL 16/main cluster on port 5432.",
    );
  if (!["localhost", "127.0.0.1", "::1"].includes(u.hostname))
    throw new Error(
      "Operations require the configured local PostgreSQL server.",
    );
  return {
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: database || decodeURIComponent(u.pathname.slice(1)),
  };
}
async function confirm(text: string, expected: string) {
  if (!process.stdin.isTTY)
    throw new Error(
      "Interactive confirmation required. Run this command in a terminal.",
    );
  const r = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if ((await r.question(text)) !== expected)
      throw new Error("Confirmation did not match; operation cancelled.");
  } finally {
    r.close();
  }
}
function active(unit: string) {
  return spawnSync("systemctl", ["is-active", "--quiet", unit]).status === 0;
}
async function paused<T>(fn: () => Promise<T>) {
  const running = ["idcard-web", "idcard-worker"].filter(active);
  for (const u of running) run("systemctl", ["stop", u]);
  try {
    return await fn();
  } finally {
    for (const u of running) run("systemctl", ["start", u]);
  }
}
async function stage() {
  const dir = path.join(base, "operations", randomUUID());
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}
async function storageCopy(source: string, target: string) {
  await cp(source, target, {
    recursive: true,
    dereference: false,
    filter: async (src) => {
      const relative = path.relative(source, src).split(path.sep);
      if (
        relative.some(
          (p) => p === "backups" || p === "temp" || p.endsWith(".partial"),
        )
      )
        return false;
      const info = await (await import("node:fs/promises")).lstat(src);
      if (info.isSymbolicLink())
        throw new Error("Storage contains a symlink; backup refused.");
      return info.isDirectory() || info.isFile();
    },
  });
}
export async function backupOperation() {
  const env = await environment(),
    dir = await stage(),
    destination = path.join(env.STORAGE_ROOT, "backups");
  run("chown", ["root:idcard", env.STORAGE_ROOT]);
  await chmod(env.STORAGE_ROOT, 0o750);
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const stamp =
      new Date().toISOString().slice(0, 10) +
      "-" +
      new Date().toISOString().slice(11, 19).replaceAll(":", ""),
    file = path.join(destination, `backup-${stamp}.tar.gz`);
  try {
    await stat(file);
    throw new Error(
      "A backup with this timestamp exists. Retry in one second.",
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  await paused(async () => {
    const url = new URL(env.DATABASE_URL);
    await runDatabaseFile(
      "runuser",
      [
        "-u",
        "postgres",
        "--",
        "/usr/lib/postgresql/16/bin/pg_dump",
        "--format=custom",
        "--dbname=" + decodeURIComponent(url.pathname.slice(1)),
      ],
      path.join(dir, "db.dump"),
      "dump",
      {
        PGHOST: "/var/run/postgresql",
        PGPORT: url.port || "5432",
        PGUSER: "postgres",
        PGPASSWORD: undefined,
      },
    );
    await cp(envFile, path.join(dir, "config.env"));
    await storageCopy(env.STORAGE_ROOT, path.join(dir, "storage"));
  });
  const version = JSON.parse(
    await readFile(path.join(current, "package.json"), "utf8"),
  ).version;
  await createBackupArchive(dir, file, version);
  console.log("Backup created: " + file);
  await rm(dir, { recursive: true, force: true });
  return file;
}
async function health() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch("http://127.0.0.1:3000/api/health/ready", {
        signal: AbortSignal.timeout(3000),
      });
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    "Application readiness failed. Inspect idcard-web/idcard-worker journals.",
  );
}
async function switchRelease(target: string) {
  const resolved = await realpath(target);
  if (!resolved.startsWith(releases + "/"))
    throw new Error("Release is outside the managed release directory.");
  const next = current + "." + randomUUID();
  await (await import("node:fs/promises")).symlink(resolved, next);
  await rename(next, current);
}
function installRuntime(target: string) {
  for (const name of [
    "idcard-web.service",
    "idcard-worker.service",
    "idcard-backup.service",
    "idcard-backup.timer",
  ])
    run("install", [
      "-m",
      "644",
      path.join(target, "deploy/systemd", name),
      "/etc/systemd/system/" + name,
    ]);
  run("install", [
    "-m",
    "755",
    path.join(target, "deploy/scripts/idcardctl"),
    "/usr/local/bin/idcardctl",
  ]);
  run("systemctl", ["daemon-reload"]);
}
async function compatible(target: string) {
  const metadata = JSON.parse(
    await readFile(path.join(target, "release.json"), "utf8"),
  );
  const env = await environment(),
    names = run(
      "/usr/lib/postgresql/16/bin/psql",
      [
        "-XAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        "SELECT name,checksum FROM schema_migrations ORDER BY name",
      ],
      pgEnvironment(env.DATABASE_URL),
      true,
    ).split("\n");
  for (const entry of names) {
    const [name, checksum] = entry.trim().split("|");
    if (
      !metadata.migrations.includes(name) ||
      checksum !== (await shaFile(path.join(target, "src/db/migrations", name)))
    )
      throw new Error(
        "This release is not compatible with the current database. The database is not rolled back. Restore a safety backup into a staged database if needed.",
      );
  }
}
export async function restoreOperation(file: string) {
  await confirm(
    "Type RESTORE to validate and restore this archive: ",
    "RESTORE",
  );
  const env = await environment(),
    dir = await stage(),
    free = await statfs(base);
  const checked = await validateBackupArchive(
    path.resolve(file),
    dir,
    free.bavail * free.bsize * 0.6,
  );
  const backupMigrations = checked.manifest.version;
  if (
    backupMigrations !==
    JSON.parse(await readFile(path.join(current, "package.json"), "utf8"))
      .version
  )
    throw new Error(
      "Restore this backup with its matching application version first. No live data was changed.",
    );
  const safety = await backupOperation();
  console.log("Safety backup: " + safety);
  const database = "idcard_restore_" + Date.now(),
    storage = path.join(base, "restored", randomUUID());
  const oldEnv = await readFile(envFile);
  let switched = false;
  try {
    await paused(async () => {
      run("runuser", [
        "-u",
        "postgres",
        "--",
        "createdb",
        "--owner=idcard",
        database,
      ]);
      await runDatabaseFile(
        "runuser",
        [
          "-u",
          "postgres",
          "--",
          "/usr/lib/postgresql/16/bin/pg_restore",
          "--exit-on-error",
          "--no-privileges",
          "--dbname=" + database,
        ],
        path.join(dir, "db.dump"),
        "restore",
        {
          PGHOST: "/var/run/postgresql",
          PGUSER: "postgres",
          PGPASSWORD: undefined,
        },
      );
      await mkdir(path.dirname(storage), { recursive: true, mode: 0o755 });
      await cp(path.join(dir, "storage"), storage, { recursive: true });
      for (const folder of [
        "photos",
        "templates",
        "generated",
        "exports",
        "imports",
        "temp",
      ])
        await mkdir(path.join(storage, folder), {
          recursive: true,
          mode: 0o700,
        });
      run("chown", ["-R", "idcard:idcard", storage]);
      run("chown", ["root:idcard", storage]);
      await chmod(storage, 0o750);
      const u = new URL(env.DATABASE_URL);
      u.pathname = "/" + database;
      const next = {
        ...env,
        DATABASE_URL: u.toString(),
        STORAGE_ROOT: storage,
        APP_ORIGIN: env.APP_ORIGIN,
      };
      await writeFile(
        envFile + ".new",
        Object.entries(next)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join("\n") + "\n",
        { mode: 0o600 },
      );
      await rename(envFile + ".new", envFile);
      switched = true;
    });
    run("systemctl", ["restart", "idcard-web", "idcard-worker"]);
    await health();
    console.log(
      "Restore passed. Previous database and storage were retained. New database: " +
        database,
    );
  } catch (e) {
    if (switched) {
      await writeFile(envFile, oldEnv, { mode: 0o600 });
      run("systemctl", ["restart", "idcard-web", "idcard-worker"]);
    }
    throw e;
  }
}
export async function updateOperation(source?: string) {
  const env = await environment();
  if (!source && !env.IDCARD_UPDATE_SOURCE)
    throw new Error(
      "Provide a trusted source directory: idcardctl update /path/to/idcard.",
    );
  const sourceRoot = await realpath(source || env.IDCARD_UPDATE_SOURCE!);
  if (releases === sourceRoot || releases.startsWith(sourceRoot + "/"))
    throw new Error(
      "Update source must not contain the managed releases directory.",
    );
  await stat(path.join(sourceRoot, "package-lock.json"));
  const safety = await backupOperation(),
    release = path.join(releases, Date.now() + "-" + randomUUID());
  await mkdir(release, { recursive: true });
  await cp(sourceRoot, release, {
    recursive: true,
    filter: (src) =>
      !path
        .relative(sourceRoot, src)
        .split(path.sep)
        .some(
          (p) =>
            ["node_modules", ".next", "dist", ".git", "storage"].includes(p) ||
            p.startsWith(".env"),
        ),
  });
  run("chown", ["-R", "idcard:idcard", release]);
  run(
    "runuser",
    ["-u", "idcard", "--", "npm", "--prefix", release, "ci", "--include=dev"],
    { NODE_ENV: "development" },
  );
  run(
    "runuser",
    ["-u", "idcard", "--", "npm", "--prefix", release, "run", "build"],
    { NODE_ENV: "production" },
  );
  const old = await realpath(current);
  await paused(async () => {
    run(
      "runuser",
      [
        "-u",
        "idcard",
        "--",
        process.execPath,
        path.join(release, "dist/cli/main.js"),
        "migrate",
      ],
      { IDCARD_RELEASE_ROOT: release },
    );
    run("chown", ["-R", "root:root", release]);
    run("chmod", ["-R", "a+rX", release]);
    await switchRelease(release);
    installRuntime(release);
  });
  run("systemctl", ["restart", "idcard-web", "idcard-worker"]);
  try {
    await health();
    await writeFile("/opt/idcard/previous-release", old + "\n", {
      mode: 0o600,
    });
    const keep = new Set([release, old]);
    const entries = await Promise.all(
      (await readdir(releases)).map(async (name) => ({
        name,
        mtime: (await stat(path.join(releases, name))).mtimeMs,
      })),
    );
    const dirs = entries.sort((a, b) => b.mtime - a.mtime).map((e) => e.name);
    for (const entry of dirs) {
      const full = path.join(releases, entry);
      if (keep.has(full) || keep.size < 3) {
        keep.add(full);
        continue;
      }
      if (
        (await realpath(full)).startsWith(releases + "/") &&
        (await (await import("node:fs/promises")).lstat(full)).isDirectory()
      )
        await rm(full, { recursive: true, force: true });
    }
    console.log("Update passed. Safety backup: " + safety);
  } catch (e) {
    try {
      await compatible(old);
      await switchRelease(old);
      installRuntime(old);
      run("systemctl", ["restart", "idcard-web", "idcard-worker"]);
    } catch {
      run("systemctl", ["stop", "idcard-web", "idcard-worker"]);
    }
    throw new Error(
      "Update health check failed. Database retained; safety backup: " +
        safety +
        ". " +
        (e as Error).message,
    );
  }
}
async function rollback() {
  const target = (
    await readFile("/opt/idcard/previous-release", "utf8")
  ).trim();
  await compatible(target);
  const old = await realpath(current);
  await paused(() => switchRelease(target));
  installRuntime(target);
  run("systemctl", ["restart", "idcard-web", "idcard-worker"]);
  try {
    await health();
  } catch (error) {
    await switchRelease(old);
    installRuntime(old);
    run("systemctl", ["restart", "idcard-web", "idcard-worker"]);
    throw error;
  }
  await writeFile("/opt/idcard/previous-release", old + "\n", { mode: 0o600 });
  console.log("Code rollback passed. Database was not rolled back.");
}
async function uninstall(purge: boolean) {
  const configured = purge ? await environment() : null;
  for (const unit of ["idcard-backup.timer", "idcard-web", "idcard-worker"]) {
    spawnSync("systemctl", ["disable", "--now", unit]);
  }
  for (const file of [
    "/etc/systemd/system/idcard-web.service",
    "/etc/systemd/system/idcard-worker.service",
    "/etc/systemd/system/idcard-backup.service",
    "/etc/systemd/system/idcard-backup.timer",
    "/etc/caddy/idcard/app.caddy",
    "/usr/local/bin/idcardctl",
  ])
    await rm(file, { force: true });
  run("systemctl", ["daemon-reload"]);
  run("caddy", ["validate", "--config", "/etc/caddy/Caddyfile"]);
  run("systemctl", ["reload", "caddy"]);
  if (!purge) {
    console.log(
      "Application stopped and uninstalled. Configuration, releases, database and storage retained.",
    );
    return;
  }
  await confirm("Type PURGE to remove managed files: ", "PURGE");
  await confirm(
    "Type DELETE ID CARD DATA to confirm permanently: ",
    "DELETE ID CARD DATA",
  );
  const targets = ["/var/lib/idcard", "/opt/idcard", "/etc/idcard"];
  const database = decodeURIComponent(
    new URL(configured!.DATABASE_URL).pathname.slice(1),
  );
  pgEnvironment(configured!.DATABASE_URL);
  if (!/^idcard(?:_restore_\d+)?$/.test(database))
    throw new Error(
      "Purge only supports the configured managed ID Card database. No database removed.",
    );
  for (const target of targets) {
    if ((await realpath(target)) !== target)
      throw new Error("Purge target resolves outside its fixed managed path.");
  }
  run("runuser", ["-u", "postgres", "--", "dropdb", "--if-exists", database]);
  for (const target of targets) {
    await rm(target, { recursive: true, force: true });
  }
  console.log(
    "Managed files and the configured database purged. Other databases and the shared PostgreSQL installation retained.",
  );
}
export async function operations(args: string[]) {
  if (process.platform !== "linux" || process.getuid?.() !== 0)
    throw new Error("Server operations require root on Ubuntu.");
  await mkdir("/run/idcard", { recursive: true });
  const lock = "/run/idcard/operations.lock";
  let handle;
  try {
    handle = await open(lock, "wx", 0o600);
  } catch {
    throw new Error(
      "Another operation may be running. Verify processes before removing /run/idcard/operations.lock after a crash.",
    );
  }
  await handle.writeFile(String(process.pid));
  try {
    switch (args[0]) {
      case "backup":
        await backupOperation();
        break;
      case "restore":
        if (!args[1]) throw new Error("Supply a backup archive.");
        await restoreOperation(args[1]);
        break;
      case "update":
        await updateOperation(args[1]);
        break;
      case "rollback":
        await rollback();
        break;
      case "uninstall":
        await uninstall(args.includes("--purge"));
        break;
      case "prune": {
        const env = await environment(),
          root = path.join(env.STORAGE_ROOT, "backups");
        for (const name of await readdir(root)) {
          if (
            !/^backup-\d{4}-\d{2}-\d{2}-\d{6}\.tar\.gz(?:\.sha256)?$/.test(name)
          )
            continue;
          const file = path.join(root, name);
          if ((await stat(file)).mtimeMs < Date.now() - 14 * 86400000)
            await unlink(file);
        }
        break;
      }
      default:
        throw new Error("Unknown server operation.");
    }
  } finally {
    await handle.close();
    await unlink(lock);
  }
}
