import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "./errors.ts";
export const numberingSchema = z.object({
  prefix: z.string().regex(/^[A-Za-z0-9_-]{1,20}$/),
  pattern: z
    .string()
    .min(1)
    .max(150)
    .refine(
      (v) =>
        !v
          .replace(/\{\{(prefix|year|dept|seq|random|uuid)\}\}/g, "")
          .includes("{"),
      "Use prefix, year, dept, seq, random or uuid bindings.",
    )
    .refine(
      (v) => /\{\{(seq|random|uuid)\}\}/.test(v),
      "Include seq, random or uuid to make numbers unique.",
    ),
  padding: z.number().int().min(1).max(18),
  start: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});
export function cardNumber(
  pattern: string,
  prefix: string,
  sequence: string,
  padding: number,
  dept: string,
  year = new Date().getUTCFullYear(),
) {
  if (pattern.includes("{{dept}}") && !dept)
    throw new AppError(
      422,
      "The card number format requires a department code.",
      "Assign this person to a department or change the number format.",
    );
  const values: Record<string, string> = {
    prefix,
    year: String(year),
    seq: sequence.padStart(padding, "0"),
    dept,
    random: randomBytes(12).toString("hex").toUpperCase(),
    uuid: randomUUID(),
  };
  return pattern.replace(
    /\{\{(prefix|year|dept|seq|random|uuid)\}\}/g,
    (_, key: string) => values[key],
  );
}
