import {
  randomBytes,
  createHash,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import argon2 from "argon2";
import type pg from "pg";
import { db, transaction } from "./db.ts";
import { AppError } from "./errors.ts";
import { config } from "./config.ts";
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export type Actor = {
  id: string;
  email: string;
  super_admin: boolean;
  must_change_password: boolean;
  csrf: string;
  tokenOrg?: string;
  tokenScopes?: string[];
};
export type Role = "ORG_ADMIN" | "DESIGNER" | "OPERATOR" | "VIEWER";
export const permissions: Record<string, Role[]> = {
  read: ["ORG_ADMIN", "DESIGNER", "OPERATOR", "VIEWER"],
  people: ["ORG_ADMIN", "OPERATOR"],
  asset: ["ORG_ADMIN", "DESIGNER", "OPERATOR"],
  design: ["ORG_ADMIN", "DESIGNER"],
  generate: ["ORG_ADMIN", "OPERATOR"],
  admin: ["ORG_ADMIN"],
};
export async function actor(request: Request): Promise<Actor> {
  const bearer = request.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) {
    if (new URL(request.url).pathname.startsWith("/api/auth/"))
      throw new AppError(
        403,
        "API tokens cannot manage account sessions.",
        "Sign in with your password.",
      );
    const hash = digest(bearer.slice(7)),
      registry = await db().query(
        "SELECT organization_id FROM api_token_lookup WHERE token_hash=$1",
        [hash],
      );
    if (!registry.rowCount)
      throw new AppError(
        401,
        "API token is invalid.",
        "Create a new token in organization settings.",
      );
    return transaction(async (c) => {
      const q = await c.query(
        "SELECT u.id,u.email,u.super_admin,u.must_change_password,t.scopes FROM api_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.expires_at>now() AND NOT u.disabled AND NOT u.must_change_password",
        [hash],
      );
      if (!q.rowCount)
        throw new AppError(
          401,
          "API token expired or was revoked.",
          "Create a new token.",
        );
      return {
        ...q.rows[0],
        csrf: "",
        tokenOrg: registry.rows[0].organization_id,
        tokenScopes: q.rows[0].scopes,
      };
    }, registry.rows[0].organization_id);
  }
  const token = (request.headers.get("cookie") || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("idcard_session="))
    ?.slice(15);
  if (!token)
    throw new AppError(401, "Please sign in.", "Open the sign-in page.");
  const q = await db().query(
    "SELECT u.id,u.email,u.super_admin,u.must_change_password,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now() AND NOT u.disabled",
    [digest(token)],
  );
  if (!q.rowCount)
    throw new AppError(401, "Your session has expired.", "Sign in again.");
  const a = q.rows[0] as Actor;
  if (!["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const csrf = request.headers.get("x-csrf-token") || "";
    if (
      origin !== config().origin ||
      Buffer.byteLength(csrf) !== Buffer.byteLength(a.csrf) ||
      !timingSafeEqual(Buffer.from(csrf), Buffer.from(a.csrf))
    )
      throw new AppError(
        403,
        "Request security validation failed.",
        "Refresh this page and try again from the configured application URL.",
      );
  }
  return a;
}
export async function tenant<T>(
  a: Actor,
  org: string,
  permission: string,
  fn: (c: pg.PoolClient) => Promise<T>,
) {
  if (!/^[0-9a-f-]{36}$/i.test(org))
    throw new AppError(
      400,
      "Choose an organization.",
      "Select an organization from the menu.",
    );
  if (
    a.tokenOrg &&
    (a.tokenOrg !== org || !a.tokenScopes?.includes(permission))
  )
    throw new AppError(
      403,
      "API token scope does not permit this action.",
      "Use a token for this organization with the required scope.",
    );
  return transaction(async (c) => {
    await c.query("SELECT set_config('app.actor_id',$1,true)", [a.id]);
    if (!a.super_admin) {
      const m = await c.query(
        "SELECT role FROM memberships WHERE user_id=$1 AND organization_id=$2",
        [a.id, org],
      );
      if (!m.rowCount || !permissions[permission]?.includes(m.rows[0].role))
        throw new AppError(
          403,
          "You do not have permission for this organization or action.",
          "Ask an organization administrator to review your role.",
        );
    } else {
      const exists = await c.query("SELECT id FROM organizations WHERE id=$1", [
        org,
      ]);
      if (!exists.rowCount)
        throw new AppError(
          404,
          "Organization not found.",
          "Select an existing organization.",
        );
    }
    return fn(c);
  }, org);
}
export async function audit(
  c: pg.PoolClient,
  a: Actor,
  org: string | null,
  action: string,
  target?: string,
) {
  await c.query(
    "INSERT INTO audit_events(id,organization_id,actor_id,action,target_id) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), org, a.id, action, target || null],
  );
}
export async function login(email: string, password: string, ip: string) {
  const key = digest(`${email.toLowerCase()}|${ip}`);
  const allowed = await db().query(
    "INSERT INTO login_limits(key,attempts,window_start) VALUES($1,1,now()) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_limits.window_start < now()-interval '15 minutes' THEN 1 ELSE login_limits.attempts+1 END,window_start=CASE WHEN login_limits.window_start < now()-interval '15 minutes' THEN now() ELSE login_limits.window_start END RETURNING attempts",
    [key],
  );
  if (allowed.rows[0].attempts > 10)
    throw new AppError(
      429,
      "Too many sign-in attempts.",
      "Wait 15 minutes before trying again.",
    );
  const q = await db().query(
    "SELECT * FROM users WHERE email=$1 AND NOT disabled",
    [email.toLowerCase()],
  );
  const fallback =
    "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQxMjM0NTY3OA$9WckNk3cE/pqmR4GvVkqjp/HmCX3a1RwXNXQxD2aGUE";
  const valid = await argon2
    .verify(q.rows[0]?.password_hash || fallback, password)
    .catch(() => false);
  if (!valid || !q.rowCount)
    throw new AppError(
      401,
      "Email or password is incorrect.",
      "Check your credentials and try again.",
    );
  const token = randomBytes(32).toString("base64url"),
    csrf = randomBytes(24).toString("base64url");
  await db().query(
    "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",
    [digest(token), q.rows[0].id, csrf],
  );
  return { token, csrf };
}
