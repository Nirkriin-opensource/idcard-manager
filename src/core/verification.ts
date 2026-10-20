import { db, transaction } from "./db.ts";
import { digest } from "./auth.ts";
import { AppError } from "./errors.ts";
export async function rateLimit(key: string, limit: number, seconds: number) {
  const q = await db().query(
    "INSERT INTO login_limits(key,attempts,window_start) VALUES($1,1,now()) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_limits.window_start<now()-($2*interval '1 second') THEN 1 ELSE login_limits.attempts+1 END,window_start=CASE WHEN login_limits.window_start<now()-($2*interval '1 second') THEN now() ELSE login_limits.window_start END RETURNING attempts",
    [digest(key), seconds],
  );
  if (q.rows[0].attempts > limit)
    throw new AppError(
      429,
      "Request limit reached.",
      "Wait briefly and try again.",
    );
}
export function effectiveStatus(status: string, expires: string | null) {
  return ["ACTIVE", "PRINTED"].includes(status) &&
    expires &&
    Date.parse(expires) < Date.now()
    ? "EXPIRED"
    : status === "PRINTED"
      ? "ACTIVE"
      : status;
}
export async function verifyCard(token: string) {
  if (!/^[a-zA-Z0-9_-]{43}$/.test(token))
    throw new AppError(
      404,
      "Card not found.",
      "Check the code or contact the issuing organization.",
    );
  const registry = await db().query(
    "SELECT organization_id FROM verification_lookup WHERE token_hash=$1",
    [digest(token)],
  );
  if (!registry.rowCount)
    throw new AppError(
      404,
      "Card not found.",
      "Check the code or contact the issuing organization.",
    );
  const org = registry.rows[0].organization_id;
  return transaction(async (c) => {
    const q = await c.query(
      "SELECT ca.expires_at,p.*,ca.status card_status,o.name organization_name,s.verification_fields FROM cards ca JOIN people p ON p.id=ca.person_id JOIN organizations o ON o.id=ca.organization_id LEFT JOIN organization_settings s ON s.organization_id=o.id WHERE ca.organization_id=$1 AND ca.verify_hash=$2",
      [org, digest(token)],
    );
    if (!q.rowCount)
      throw new AppError(
        404,
        "Card not found.",
        "Contact the issuing organization.",
      );
    const row = q.rows[0],
      status = row.deleted_at
        ? "CANCELLED"
        : effectiveStatus(
            row.card_status,
            row.expires_at?.toISOString() || null,
          ),
      fields: Record<string, unknown> = {};
    if (status === "ACTIVE") {
      const custom = (
        await c.query(
          "SELECT key FROM field_definitions WHERE organization_id=$1 AND NOT private",
          [org],
        )
      ).rows.map((r) => r.key);
      for (const key of row.verification_fields || []) {
        if (["name", "external_id", "designation"].includes(key))
          fields[key] = row[key];
        else if (custom.includes(key))
          fields[key] = row.custom_fields[key] ?? "";
      }
    }
    return {
      organization: row.organization_name,
      status,
      valid: status === "ACTIVE",
      fields,
    };
  }, org);
}
