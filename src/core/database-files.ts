import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
export async function runDatabaseFile(
  binary: string,
  args: string[],
  file: string,
  direction: "dump" | "restore",
  environment: Record<string, string | undefined>,
) {
  const handle = await open(file, direction === "dump" ? "wx" : "r", 0o600);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(binary, args, {
        env: { ...process.env, ...environment },
        stdio:
          direction === "dump"
            ? ["ignore", handle.fd, "pipe"]
            : [handle.fd, "ignore", "pipe"],
      });
      let error = "";
      child.stderr?.on("data", (b) => {
        if (error.length < 8000) error += b.toString();
      });
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error("PostgreSQL file operation failed: " + error)),
      );
    });
  } finally {
    await handle.close();
  }
}
