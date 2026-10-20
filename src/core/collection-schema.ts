import { z } from "zod";
import { generalCardFields } from "./card-field-catalog.ts";
export const collectionFieldSchema = z
  .object({
    key: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,63}$/)
      .refine(
        (k) =>
          ![
            "constructor",
            "prototype",
            "card_type",
            "status",
            "unit_ids",
            "custom_fields",
            "photo_asset_id",
            "signature_asset_id",
          ].includes(k),
      ),
    label: z.string().trim().min(1).max(120),
    type: z.enum([
      "text",
      "email",
      "tel",
      "textarea",
      "date",
      "datetime-local",
      "number",
      "boolean",
      "select",
      "image",
    ]),
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  })
  .superRefine((f, c) => {
    if (
      f.type === "select" &&
      (f.options.length < 1 || new Set(f.options).size !== f.options.length)
    )
      c.addIssue({
        code: "custom",
        message: "Choose unique dropdown options.",
        path: ["options"],
      });
    if (
      (f.type === "image") !==
      ["photo", "cardholder_signature"].includes(f.key)
    )
      c.addIssue({
        code: "custom",
        message: "Image fields must be photo or cardholder_signature.",
        path: ["type"],
      });
    const built = generalCardFields.find((b) => b.key === f.key);
    if (
      (built &&
        ["organization", "code", "literal"].includes(built.source || "")) ||
      f.key === "authorized_signature" ||
      f.key === "organization_logo"
    )
      c.addIssue({
        code: "custom",
        message:
          "This field is supplied by the organization, not the applicant.",
      });
    const expected =
      (
        {
          name: "text",
          external_id: "text",
          email: "email",
          phone: "tel",
          designation: "text",
          valid_until: "datetime-local",
        } as Record<string, string>
      )[f.key] || (built?.type === "date" ? "date" : null);
    if (expected && f.type !== expected)
      c.addIssue({
        code: "custom",
        message: `Use ${expected} for ${f.label}.`,
        path: ["type"],
      });
  });
export type CollectionField = z.infer<typeof collectionFieldSchema>;
export const collectionSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    profession: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).default(""),
    fields: z.array(collectionFieldSchema).min(2).max(80),
    active: z.boolean().default(false),
    closes_at: z.iso.datetime({ offset: true }).nullable().default(null),
  })
  .superRefine((f, c) => {
    if (new Set(f.fields.map((f) => f.key)).size !== f.fields.length)
      c.addIssue({
        code: "custom",
        message: "Each field can appear only once.",
        path: ["fields"],
      });
    for (const key of ["name", "external_id"])
      if (!f.fields.some((f) => f.key === key && f.required))
        c.addIssue({
          code: "custom",
          message: "Full name and ID number must be included and required.",
          path: ["fields"],
        });
  });
export type CollectionDefinition = z.infer<typeof collectionSchema>;
export function fieldType(field: {
  key: string;
  type?: string;
}): CollectionField["type"] {
  if (["photo", "cardholder_signature"].includes(field.key)) return "image";
  if (field.key === "email") return "email";
  if (field.key === "phone" || field.key.includes("phone")) return "tel";
  if (field.key === "valid_until") return "datetime-local";
  if (field.key.includes("address")) return "textarea";
  if (["date", "number", "boolean"].includes(field.type || ""))
    return field.type as CollectionField["type"];
  return "text";
}
export const collectionFields: CollectionField[] = [
  ...generalCardFields
    .filter(
      (f) =>
        !["organization", "code", "literal"].includes(f.source || "") &&
        !["authorized_signature", "organization_logo"].includes(f.key),
    )
    .map((f) => ({
      key: f.key,
      label: f.label,
      type: fieldType(f),
      required: ["name", "external_id"].includes(f.key),
      options: [],
    })),
  {
    key: "practice_name",
    label: "Practice name",
    type: "text",
    required: false,
    options: [],
  },
  {
    key: "specialization",
    label: "Specialization",
    type: "text",
    required: false,
    options: [],
  },
  {
    key: "practice_address",
    label: "Practice address",
    type: "textarea",
    required: false,
    options: [],
  },
];
export const professionPresets: Record<string, string[]> = {
  Employee: [
    "name",
    "external_id",
    "photo",
    "designation",
    "department",
    "joining_date",
    "phone",
    "email",
    "emergency_contact",
    "blood_group",
  ],
  Student: [
    "name",
    "external_id",
    "photo",
    "course",
    "year_semester_batch",
    "department",
    "birth_date",
    "phone",
    "guardian_name",
    "guardian_phone",
  ],
  "Healthcare / practice": [
    "name",
    "external_id",
    "photo",
    "designation",
    "registration_number",
    "practice_name",
    "specialization",
    "practice_address",
    "work_location",
    "phone",
    "email",
  ],
  Visitor: [
    "name",
    "external_id",
    "photo",
    "visitor_company",
    "visit_purpose",
    "person_to_meet",
    "visit_date",
    "phone",
  ],
  Custom: ["name", "external_id", "photo", "phone", "email"],
};
export function validateCollectionValues(
  fields: CollectionField[],
  raw: unknown,
  images: Record<string, unknown> = {},
) {
  const input = z.record(z.string(), z.unknown()).parse(raw),
    values: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(input))
    if (!fields.some((f) => f.key === key && f.type !== "image"))
      throw new Error(`Unexpected field: ${key}`);
  for (const key of Object.keys(images))
    if (!fields.some((f) => f.key === key && f.type === "image"))
      throw new Error(`Unexpected image: ${key}`);
  for (const f of fields) {
    const rawValue = input[f.key],
      value = typeof rawValue === "string" ? rawValue.trim() : rawValue;
    if (f.type === "image") {
      if (f.required && !images[f.key])
        throw new Error(`${f.label} is required.`);
      continue;
    }
    const empty =
      value === undefined ||
      value === null ||
      value === "" ||
      (f.type === "boolean" && f.required && value !== true);
    if (empty) {
      if (f.required) throw new Error(`${f.label} is required.`);
      continue;
    }
    if (f.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new Error(`${f.label} must be a number.`);
    } else if (f.type === "boolean") {
      if (typeof value !== "boolean")
        throw new Error(`${f.label} must be yes or no.`);
    } else {
      const max =
        f.key === "external_id"
          ? 100
          : f.key === "name" || f.key === "designation"
            ? 200
            : f.key === "phone"
              ? 40
              : 4000;
      if (typeof value !== "string" || value.length > max)
        throw new Error(`${f.label} is too long or invalid.`);
      if (f.type === "email" && !z.email().safeParse(value).success)
        throw new Error(`${f.label} must be a valid email.`);
      if (
        f.type === "date" &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value)
      )
        throw new Error(`${f.label} must be a valid date.`);
      if (
        f.type === "datetime-local" &&
        !z.iso.datetime({ offset: true }).safeParse(value).success
      )
        throw new Error(
          `${f.label} must include a valid date, time and timezone.`,
        );
      if (f.type === "select" && !f.options.includes(value))
        throw new Error(`${f.label} must be one of the available options.`);
    }
    values[f.key] = value as string | number | boolean;
  }
  return values;
}
