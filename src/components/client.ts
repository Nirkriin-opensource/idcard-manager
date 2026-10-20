"use client";
let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
export async function api(
  path: string,
  method = "GET",
  body?: unknown,
  raw = false,
  extraHeaders: Record<string, string> = {},
): Promise<any> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (method !== "GET") headers["x-csrf-token"] = csrf;
  if (body !== undefined && !raw) headers["Content-Type"] = "application/json";
  const response = await fetch("/api/" + path, {
    method,
    headers,
    body:
      body === undefined
        ? undefined
        : raw
          ? (body as BodyInit)
          : JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    const e = await response.json().catch(() => ({
      error: "The server returned an unreadable response.",
      fix: "Check the application journal.",
    }));
    throw new Error(`${e.error} ${e.fix || ""}`);
  }
  return response.headers.get("content-type")?.includes("application/json")
    ? response.json()
    : response.blob();
}
