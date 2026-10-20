import type pg from "pg";
import { tenant, audit, type Actor } from "./auth.ts";
import { timeSettingsSchema } from "./organization-time.ts";
import { AppError } from "./errors.ts";
export async function getTimeSettings(c: pg.PoolClient, org: string) {
  const row = (
    await c.query(
      "SELECT appearance->'time' AS settings FROM organizations WHERE id=$1",
      [org],
    )
  ).rows[0];
  if (!row)
    throw new AppError(
      404,
      "Organization not found.",
      "Choose an organization.",
    );
  return timeSettingsSchema.parse(row.settings || {});
}
export async function timeSettingsRoute(
  req: Request,
  p: string[],
  actor: Actor,
  json: () => Promise<any>,
): Promise<Response | null> {
  if (p[0] !== "orgs" || p[2] !== "time-settings" || p.length !== 3)
    return null;
  return tenant(
    actor,
    p[1],
    req.method === "GET" ? "read" : "admin",
    async (c) => {
      if (req.method === "GET")
        return Response.json(
          {
            ...(await getTimeSettings(c, p[1])),
            serverNow: new Date().toISOString(),
            zones: [
              ...new Set([
                "Asia/Kolkata",
                "UTC",
                ...Intl.supportedValuesOf("timeZone"),
              ]),
            ].sort(),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      if (req.method === "PUT") {
        const settings = timeSettingsSchema.parse(await json());
        await c.query(
          "UPDATE organizations SET appearance=jsonb_set(appearance,'{time}',$1::jsonb,true) WHERE id=$2",
          [JSON.stringify(settings), p[1]],
        );
        await audit(c, actor, p[1], "organization.time-settings");
        return Response.json(
          { ...settings, serverNow: new Date().toISOString() },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      throw new AppError(405, "Method not supported.", "Use GET or PUT.");
    },
  );
}
