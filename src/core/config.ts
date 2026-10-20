import path from "node:path";
export function config() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl)
    throw new Error(
      "DATABASE_URL is missing. Load the environment file before starting.",
    );
  const origin = process.env.APP_ORIGIN || "http://localhost:3000";
  const url = new URL(origin);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error(
      "APP_ORIGIN must be an HTTP(S) origin without credentials or a path.",
    );
  return {
    databaseUrl,
    origin: url.origin,
    storage: path.resolve(process.env.STORAGE_ROOT || "./storage"),
    secure: url.protocol === "https:",
  };
}
