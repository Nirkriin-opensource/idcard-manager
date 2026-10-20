const rootFiles = new Set([
  ".env.example",
  ".gitattributes",
  ".gitignore",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "THIRD-PARTY-NOTICES.md",
  "install.sh",
  "package.json",
  "package-lock.json",
  "release.json",
  "next.config.ts",
  "next-env.d.ts",
  "tsconfig.json",
  "tsconfig.server.json",
]);
const directories = ["src", "tests", "deploy", "docs", "scripts", ".github"];
const forbiddenParts = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "storage",
  "backups",
  "delivery",
  "test-results",
  "__pycache__",
  ".production-dist",
]);
export function publicReleasePath(value: string) {
  const file = value.replaceAll("\\", "/");
  const parts = file.split("/");
  if (
    parts.some(
      (p) =>
        !p || p === "." || p === ".." || forbiddenParts.has(p.toLowerCase()),
    )
  )
    return false;
  if (file.startsWith("docs/screenshots/")) return false;
  if (
    file !== ".env.example" &&
    parts.some(
      (p) =>
        p.toLowerCase().startsWith(".env") || p.toLowerCase().endsWith(".env"),
    )
  )
    return false;
  if (/\.(log|dump|pem|key|p12|pfx|zip|gz|tsbuildinfo|pyc)$/i.test(file))
    return false;
  if (/\.sql$/i.test(file) && !file.startsWith("src/db/migrations/"))
    return false;
  return (
    rootFiles.has(file) || directories.some((dir) => file.startsWith(dir + "/"))
  );
}
export const publicRootFiles = [...rootFiles];
export const publicDirectories = directories;
export function hasRecognizableSecret(text: string) {
  return (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) ||
    /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/.test(
      text,
    ) ||
    /\bAKIA[0-9A-Z]{16}\b/.test(text)
  );
}
