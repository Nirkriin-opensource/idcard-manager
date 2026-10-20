import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { AppError } from "./errors.ts";
import {
  cardTypes,
  generalCardFields,
  cardFieldCatalog,
  customCardFields,
  defaultCardPolicy,
  type CardType,
  type CardPolicy,
} from "./card-field-catalog.ts";
import { elementSchema, templateSchema, type Template } from "./template.ts";

export const cardTypeSchema = z.enum([
  "staff",
  "student",
  "visitor",
  "professional",
]);
export async function profileSettings(c: pg.PoolClient, org: string) {
  const row = (
    await c.query("SELECT name,card_profiles FROM organizations WHERE id=$1", [
      org,
    ])
  ).rows[0];
  return {
    name: row.name as string,
    profiles: row.card_profiles as Partial<Record<CardType, CardPolicy>>,
  };
}
export function parsePolicy(kind: CardType, raw: unknown): CardPolicy {
  const d = z
    .object({
      general: z.boolean().optional(),
      shown: z.array(z.string()).max(60),
      required: z.array(z.string()).max(40),
      assets: z
        .object({
          organization_logo: z.uuid().optional(),
          authorized_signature: z.uuid().optional(),
        })
        .default({}),
    })
    .parse(raw);
  const valid = new Set(
    (d.general && kind === "staff"
      ? generalCardFields
      : cardFieldCatalog[kind]
    ).map((f) => f.key),
  );
  if (
    (d.general && kind !== "staff") ||
    [...d.shown, ...d.required].some((k) => !valid.has(k)) ||
    d.required.some((k) => !d.shown.includes(k)) ||
    ["name", "external_id"].some((k) => !d.required.includes(k))
  )
    throw new AppError(
      400,
      "Invalid card field choices.",
      "Mandatory fields must be shown. Name and ID identify each record and remain required.",
    );
  return {
    ...d,
    shown: [...new Set(d.shown)],
    required: [...new Set(d.required)],
  };
}
export async function saveProfile(
  c: pg.PoolClient,
  org: string,
  kind: CardType,
  policy: CardPolicy,
) {
  for (const id of Object.values(policy.assets)) {
    if (
      !(
        await c.query(
          "SELECT id FROM assets WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL",
          [org, id],
        )
      ).rowCount
    )
      throw new AppError(
        400,
        "Image belongs to another organization or is missing.",
        "Upload or select an image in this organization.",
      );
  }
  const defs = [
    {
      key: "card_type",
      label: "Card type (staff / student / visitor / professional)",
    },
    ...customCardFields(),
  ];
  for (const f of defs) {
    const type = "type" in f && f.type === "date" ? "date" : "text";
    const existing = (
      await c.query(
        "SELECT type FROM field_definitions WHERE organization_id=$1 AND key=$2",
        [org, f.key],
      )
    ).rows[0];
    if (existing && existing.type !== type)
      throw new AppError(
        409,
        `Existing field ${f.key} has an incompatible type.`,
        `Use ${type} for this card field before configuring profiles.`,
      );
    await c.query(
      "INSERT INTO field_definitions(id,organization_id,key,label,type,required,private) VALUES($1,$2,$3,$4,$5,false,true) ON CONFLICT(organization_id,key) DO NOTHING",
      [randomUUID(), org, f.key, f.label, type],
    );
  }
  await c.query(
    "UPDATE organizations SET card_profiles=jsonb_set(card_profiles,ARRAY[$2]::text[],$3::jsonb,true) WHERE id=$1",
    [org, kind, JSON.stringify(policy)],
  );
}
const empty = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && !v.trim());
export async function validateProfilePerson(
  c: pg.PoolClient,
  org: string,
  person: Record<string, any>,
  requireType = false,
) {
  const generalSettings = await profileSettings(c, org);
  const kind = generalSettings.profiles.staff?.general
    ? "staff"
    : person.custom_fields?.card_type;
  if (!kind) {
    if (
      requireType &&
      Object.keys((await profileSettings(c, org)).profiles).length
    )
      throw new AppError(
        422,
        "Choose a card type for this person.",
        "Set card_type to a configured card type so its mandatory rules can be checked.",
      );
    return;
  }
  const parsed = cardTypeSchema.safeParse(kind);
  if (!parsed.success)
    throw new AppError(
      400,
      "Unknown card type.",
      "Choose staff, student, visitor or professional.",
    );
  const settings = await profileSettings(c, org),
    policy = settings.profiles[parsed.data];
  if (!policy)
    throw new AppError(
      400,
      "Card type is not configured.",
      "Save this card type in Card fields first.",
    );
  validateRequired(
    parsed.data,
    policy.required,
    { ...person.custom_fields, ...person },
    false,
    !!policy.general,
  );
  const until = person.custom_fields?.valid_until;
  if (
    !empty(until) &&
    (typeof until !== "string" ||
      !z.iso.datetime({ offset: true }).safeParse(until).success)
  )
    throw new AppError(
      400,
      "Invalid visitor expiry.",
      "Use an ISO date and time with timezone, e.g. 2026-10-18T17:00:00+05:30.",
    );
}
export function validateRequired(
  kind: CardType,
  required: string[],
  values: Record<string, any>,
  images: boolean,
  general = false,
) {
  const missing = (general ? generalCardFields : cardFieldCatalog[kind]).filter(
    (f) =>
      required.includes(f.key) &&
      (images || !f.source || f.source === "core") &&
      empty(f.key === "photo" ? values.photo_asset_id : values[f.key]),
  );
  if (missing.length)
    throw new AppError(
      422,
      "Mandatory card fields are missing.",
      missing.map((f) => f.label).join(", "),
    );
}
export async function cardProfileValues(
  c: pg.PoolClient,
  org: string,
  person: Record<string, any>,
  doc: Template,
  enforce = true,
  frozenSettings?: Awaited<ReturnType<typeof profileSettings>>,
) {
  if (!doc.cardType) {
    if (enforce && person.custom_fields?.card_type)
      throw new AppError(
        422,
        "Choose a template for this person’s card type.",
        "Create or select a card-type template from Organization → Card fields.",
      );
    return {};
  }
  const kind = doc.cardType,
    settings = frozenSettings || (await profileSettings(c, org)),
    policy = settings.profiles[kind] || defaultCardPolicy(kind);
  if (enforce && !doc.general && person.custom_fields?.card_type !== kind)
    throw new AppError(
      422,
      "Person and template card types do not match.",
      `Set this person's card type to ${cardTypes[kind]} or choose another template.`,
    );
  const values: Record<string, any> = Object.fromEntries(
    (doc.general ? generalCardFields : cardFieldCatalog[kind]).map((f) => [
      f.key,
      "",
    ]),
  );
  Object.assign(values, person.custom_fields, person, {
    organization_name: settings.name,
    organization_logo: policy.assets.organization_logo || "",
    authorized_signature: policy.assets.authorized_signature || "",
    visitor_label: "VISITOR",
    return_note: "Return at exit",
    qr: "QR",
    barcode: person.external_id,
  });
  if (doc.general) values.card_type = "staff";
  // Resolve image references within this tenant before rendering or saving a card.
  for (const key of [
    "cardholder_signature",
    "authorized_signature",
    "organization_logo",
  ]) {
    if (!values[key]) continue;
    if (
      !z.uuid().safeParse(values[key]).success ||
      !(
        await c.query(
          "SELECT id FROM assets WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL",
          [org, values[key]],
        )
      ).rowCount
    )
      throw new AppError(
        422,
        `Invalid ${key.replaceAll("_", " ")} image.`,
        "Upload and select an image from this organization.",
      );
  }
  if (enforce) {
    const required = [
      ...new Set([...(doc.requiredFields || []), ...policy.required]),
    ];
    validateRequired(kind, required, values, true, !!doc.general);
    const elements = [...doc.front, ...doc.back];
    for (const key of required) {
      const field = (
        doc.general ? generalCardFields : cardFieldCatalog[kind]
      ).find((f) => f.key === key);
      if (!field)
        throw new AppError(
          422,
          "Unknown mandatory template field.",
          "Use a field belonging to this card type.",
        );
      const present =
        key === "photo"
          ? elements.some((e) => e.type === "photo")
          : field.source === "image"
            ? elements.some((e) => e.assetField === key)
            : field.source === "code"
              ? elements.some((e) => e.type === key)
              : elements.some(
                  (e) =>
                    e.text.includes(`{{${key}}}`) ||
                    (!field.source && e.text.includes(`{{custom.${key}}}`)) ||
                    (key === "visitor_label" && e.text.includes("VISITOR")) ||
                    (key === "return_note" &&
                      e.text.includes("Return at exit")),
                );
      if (!present)
        throw new AppError(
          422,
          `${field.label} is mandatory but absent from the template.`,
          "Add it in the designer or create a new preset from Card fields.",
        );
    }
  }
  return values;
}
export function profileTemplate(kind: CardType, policy: CardPolicy): Template {
  const el = (v: Record<string, unknown>) =>
    elementSchema.parse({
      id: randomUUID(),
      x: 4,
      y: 4,
      width: 77,
      height: 8,
      fontSize: 2.6,
      ...v,
    });
  const shown = (key: string) => policy.shown.includes(key);
  const front = [
    el({ type: "rect", x: 0, y: 0, width: 85.6, height: 14, fill: "#086b73" }),
    el({
      type: "text",
      text: policy.general ? "General" : cardTypes[kind],
      x: 4,
      y: 4,
      fill: "#ffffff",
      bold: true,
    }),
  ];
  if (shown("organization_name"))
    front.push(
      el({
        type: "text",
        text: "{{organization_name}}",
        y: 16,
        width: shown("organization_logo") ? 60 : 77,
        height: 10,
        bold: true,
      }),
    );
  if (shown("organization_logo"))
    front.push(
      el({
        type: "logo",
        assetField: "organization_logo",
        optional: !policy.required.includes("organization_logo"),
        x: 68,
        y: 16,
        width: 13,
        height: 12,
        fit: "contain",
      }),
    );
  if (shown("photo"))
    front.push(
      el({
        type: "photo",
        optional: !policy.required.includes("photo"),
        x: 4,
        y: 30,
        width: 22,
        height: 28,
      }),
    );
  front.push(
    el({
      type: "text",
      text: "{{name}}",
      x: 29,
      y: 31,
      width: 52,
      height: 12,
      bold: true,
      fontSize: 3.2,
    }),
    el({
      type: "text",
      text:
        (policy.general
          ? "ID: "
          : kind === "student"
            ? "Student ID: "
            : kind === "visitor"
              ? "Pass: "
              : "Employee ID: ") + "{{external_id}}",
      x: 29,
      y: 46,
      width: 52,
      height: 10,
    }),
  );
  const texts = (
    policy.general ? generalCardFields : cardFieldCatalog[kind]
  ).filter(
    (f) =>
      shown(f.key) &&
      (!f.source ||
        f.key === "email" ||
        f.key === "phone" ||
        f.key === "designation"),
  );
  texts.forEach((f, i) =>
    front.push(
      el({
        type: "text",
        text: `${f.label.replace(" (optional)", "")}: {{${f.key}}}`,
        x: 4 + (i % 2) * 39,
        y: 62 + Math.floor(i / 2) * 8,
        width: 37,
        height: 8,
        fontSize: 1.8,
      }),
    ),
  );
  const back = [
    el({
      type: "text",
      text: policy.general ? "General" : cardTypes[kind],
      y: 4,
      bold: true,
    }),
  ];
  if (shown("visitor_label"))
    front.push(
      el({
        type: "text",
        text: "{{visitor_label}}",
        x: 29,
        y: 56,
        width: 48,
        height: 5,
        bold: true,
      }),
    );
  if (shown("qr"))
    back.push(
      el({
        type: "qr",
        text: "{{card.verify_url}}",
        x: 27,
        y: 17,
        width: 32,
        height: 32,
      }),
    );
  if (shown("barcode"))
    back.push(
      el({
        type: "barcode",
        text: "{{external_id}}",
        x: 5,
        y: 54,
        width: 75,
        height: 12,
      }),
    );
  for (const [i, key] of [
    "cardholder_signature",
    "authorized_signature",
  ].entries())
    if (shown(key)) {
      back.push(
        el({
          type: "signature",
          assetField: key,
          optional: !policy.required.includes(key),
          x: 5 + i * 39,
          y: 74,
          width: 35,
          height: 12,
          fit: "contain",
        }),
      );
      back.push(
        el({
          type: "text",
          text:
            key === "cardholder_signature"
              ? "Cardholder signature"
              : "Authorized signature",
          x: 5 + i * 39,
          y: 88,
          width: 35,
          height: 7,
          fontSize: 2,
        }),
      );
    }
  if (shown("return_note"))
    back.push(el({ type: "text", text: "{{return_note}}", y: 98, bold: true }));
  return templateSchema.parse({
    schemaVersion: 1,
    width: 85.6,
    height: Math.max(110, 62 + Math.ceil(texts.length / 2) * 8 + 8),
    general: policy.general,
    cardType: kind,
    requiredFields: policy.required,
    front,
    back,
  });
}

export async function useGeneralCardType(
  c: pg.PoolClient,
  org: string,
  person: Record<string, any>,
) {
  if ((await profileSettings(c, org)).profiles.staff?.general)
    person.custom_fields = { ...person.custom_fields, card_type: "staff" };
}
