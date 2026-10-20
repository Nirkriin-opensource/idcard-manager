import { z } from "zod";
import type pg from "pg";
import { AppError } from "./errors.ts";
export const personSchema = z.object({
  external_id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  email: z.union([z.email(), z.literal("")]).default(""),
  phone: z.string().max(40).default(""),
  designation: z.string().max(200).default(""),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  custom_fields: z
    .record(
      z.string().max(64),
      z.union([
        z.string().max(4000),
        z.number().finite(),
        z.boolean(),
        z.null(),
      ]),
    )
    .default({}),
  unit_ids: z.array(z.uuid()).max(30).default([]),
});
export async function validateFields(
  c: pg.PoolClient,
  org: string,
  fields: Record<string, unknown>,
) {
  const definitions = (
    await c.query("SELECT * FROM field_definitions WHERE organization_id=$1", [
      org,
    ])
  ).rows;
  const errors: string[] = [];
  for (const key of Object.keys(fields))
    if (!definitions.some((d) => d.key === key))
      errors.push(`Unknown custom field ${key}`);
  for (const d of definitions) {
    const v = fields[d.key],
      empty = v === undefined || v === null || v === "";
    if (d.required && empty) errors.push(`${d.label} is required`);
    if (!empty) {
      if (d.type === "number" && (typeof v !== "number" || !Number.isFinite(v)))
        errors.push(`${d.label} must be a number`);
      if (d.type === "boolean" && typeof v !== "boolean")
        errors.push(`${d.label} must be true or false`);
      if (
        d.type === "date" &&
        (typeof v !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
          Number.isNaN(Date.parse(v)) ||
          new Date(v).toISOString().slice(0, 10) !== v)
      )
        errors.push(`${d.label} must be YYYY-MM-DD`);
      if (d.type === "text" && typeof v !== "string")
        errors.push(`${d.label} must be text`);
    }
  }
  if (errors.length)
    throw new AppError(400, "Custom fields are invalid.", errors.join("; "));
}
