import { AppError } from "./errors.ts";
import { z } from "zod";

import { fontFamilySchema, languageSchema } from "./printing.ts";
export const elementSchema = z.object({
  id: z.string().uuid(),
  type: z.enum([
    "text",
    "photo",
    "image",
    "logo",
    "qr",
    "barcode",
    "rect",
    "ellipse",
    "line",
    "signature",
    "stamp",
    "date",
    "map",
  ]),
  x: z.number().min(-100).max(1000),
  y: z.number().min(-100).max(1000),
  width: z.number().positive().max(1000),
  height: z.number().positive().max(1000),
  rotation: z.number().min(-360).max(360).default(0),
  locked: z.boolean().default(false),
  text: z.string().max(4000).default(""),
  fontSize: z.number().min(1).max(100).default(4),
  fontFamily: fontFamilySchema.default("DejaVu Sans"),
  fontOverride: z.boolean().optional(),
  language: languageSchema.optional(),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
  align: z.enum(["left", "center", "right"]).default("left"),
  fill: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#172033"),
  background: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#ffffff"),
  stroke: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#172033"),
  strokeWidth: z.number().min(0).max(10).default(0),
  assetId: z.string().uuid().optional(),
  assetField: z
    .enum(["cardholder_signature", "authorized_signature", "organization_logo"])
    .optional(),
  fieldKey: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/)
    .optional(),
  themeRole: z.enum(["accent", "heading", "text"]).optional(),
  optional: z.boolean().optional(),
  fit: z.enum(["cover", "contain"]).default("cover"),
  faceFit: z.boolean().default(true),
  barcode: z
    .enum(["code128", "code39", "ean13", "ean8", "upca", "upce"])
    .default("code128"),
  errorCorrection: z.enum(["L", "M", "Q", "H"]).default("M"),
});
const cardDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    general: z.boolean().optional(),
    language: languageSchema.optional(),
    secondaryLanguage: languageSchema.optional(),
    secondaryFont: fontFamilySchema.optional(),
    fontFiles: z
      .record(z.string().max(160), z.string().regex(/^[a-f0-9]{64}_\d{1,3}$/))
      .optional(),
    textEngine: z.enum(["pango", "svg"]).optional(),
    cardType: z
      .enum(["staff", "student", "visitor", "professional"])
      .optional(),
    stylePreset: z.enum(["classic", "vertical", "modern"]).optional(),
    requiredFields: z.array(z.string().max(64)).max(40).optional(),
    width: z.number().min(10).max(500),
    height: z.number().min(10).max(500),
    dpi: z.number().int().min(150).max(600).default(300),
    background: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#ffffff"),
    front: z.array(elementSchema).max(150),
    back: z.array(elementSchema).max(150),
  })
  .superRefine((d, ctx) => {
    if (d.general && d.cardType !== "staff")
      ctx.addIssue({
        code: "custom",
        message: "General templates must use the General field policy.",
      });
    const ids = [...d.front, ...d.back].map((e) => e.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: "custom",
        message: "Element IDs must be unique across both sides.",
      });
  });
export const templateSchema = cardDocumentSchema
  .safeExtend({
    variants: z
      .object({
        staff: cardDocumentSchema,
        student: cardDocumentSchema,
        visitor: cardDocumentSchema,
        professional: cardDocumentSchema,
      })
      .optional(),
  })
  .superRefine((doc, ctx) => {
    if (doc.variants) {
      if (doc.cardType)
        ctx.addIssue({
          code: "custom",
          message: "Shared templates cannot have a single card type.",
        });
      for (const [kind, variant] of Object.entries(doc.variants)) {
        if (variant.cardType !== kind)
          ctx.addIssue({
            code: "custom",
            path: ["variants", kind, "cardType"],
            message: "Variant card type must match its key.",
          });
      }
    }
  });
export function templateForPerson(
  document: Template,
  person: Record<string, any>,
  general = false,
): Template {
  if (!document.variants)
    return structuredClone(
      general && !document.cardType
        ? { ...document, cardType: "staff", general: true }
        : document,
    );
  const kind = person.custom_fields?.card_type as keyof NonNullable<
    Template["variants"]
  >;
  if (!Object.hasOwn(document.variants, kind))
    throw new AppError(
      422,
      "Choose a card type for this person.",
      "Set staff, student, visitor or professional before using the shared template.",
    );
  return structuredClone(document.variants[kind]);
}
export type Template = z.infer<typeof templateSchema>;
export type Element = z.infer<typeof elementSchema>;
export function customFieldBindings(
  custom: Record<string, unknown> = {},
  resolved: Record<string, unknown> = {},
) {
  return Object.fromEntries(
    Object.entries({ ...custom, ...resolved }).map(([key, value]) => [
      `custom.${key}`,
      value,
    ]),
  );
}
export function bind(text: string, fields: Record<string, unknown>) {
  return text.replace(
    /\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g,
    (_all, key: string) => {
      if (!Object.hasOwn(fields, key))
        throw new AppError(
          422,
          `Binding ${key} has no value.`,
          "Add the field or remove this binding.",
        );
      const v = fields[key];
      return v === null || v === undefined ? "" : String(v);
    },
  );
}
export const mmToPixels = (mm: number, dpi: number) =>
  Math.round((mm * dpi) / 25.4);
export const escapeXml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
