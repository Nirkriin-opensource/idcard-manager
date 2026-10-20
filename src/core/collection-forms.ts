import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type pg from "pg";
import { tenant, audit, type Actor } from "./auth.ts";
import { transaction } from "./db.ts";
import { config } from "./config.ts";
import { AppError } from "./errors.ts";
import {
  collectionSchema,
  collectionFields,
  fieldType,
  validateCollectionValues,
  type CollectionField,
} from "./collection-schema.ts";
import { personSchema, validateFields } from "./people.ts";
import {
  useGeneralCardType,
  validateProfilePerson,
  profileSettings,
} from "./card-profiles.ts";
import { storeImage } from "./storage.ts";
import { rateLimit } from "./verification.ts";
import { retentionLock } from "./retention-lock.ts";
import { getTimeSettings } from "./time-settings.ts";
import {
  toWallTime,
  wallTimeToInstant,
  normalizeLocalAnswers,
  type TimeSettings,
} from "./organization-time.ts";

const response = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
const coreKeys = ["name", "external_id", "email", "phone", "designation"];
const unavailable = () =>
  new AppError(
    404,
    "This form is unavailable.",
    "Ask the organization for an active form link.",
  );
async function find(c: pg.PoolClient, org: string, id: string, lock = false) {
  const row = (
    await c.query(
      `SELECT * FROM collection_forms WHERE organization_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
      [org, id],
    )
  ).rows[0];
  if (!row) throw unavailable();
  return row;
}
function values(
  fields: CollectionField[],
  raw: unknown,
  images: Record<string, unknown>,
) {
  try {
    return validateCollectionValues(fields, raw, images);
  } catch (e) {
    throw new AppError(
      400,
      "Please check the form fields.",
      (e as Error).message,
    );
  }
}
async function catalog(c: pg.PoolClient, org: string) {
  const defs = (
    await c.query(
      "SELECT key,label,type,required FROM field_definitions WHERE organization_id=$1 AND key<>'card_type' ORDER BY label",
      [org],
    )
  ).rows;
  const fields = new Map(collectionFields.map((f) => [f.key, { ...f }]));
  for (const d of defs) {
    const known = fields.get(d.key);
    // Organization-managed images, codes and labels never become public questions.
    if (
      !known &&
      [
        "photo_asset_id",
        "signature_asset_id",
        "authorized_signature",
        "organization_name",
        "organization_logo",
        "visitor_label",
        "qr",
        "barcode",
        "return_note",
        "status",
        "unit_ids",
        "custom_fields",
        "constructor",
        "prototype",
      ].includes(d.key)
    )
      continue;
    fields.set(
      d.key,
      known
        ? { ...known, required: known.required || d.required }
        : {
            key: d.key,
            label: d.label,
            type: fieldType(d),
            required: d.required,
            options: [],
          },
    );
  }
  const policy = (await profileSettings(c, org)).profiles.staff;
  if (policy?.general)
    for (const key of policy.required) {
      const field = fields.get(key);
      if (field) field.required = true;
    }
  return [...fields.values()];
}
function share(row: Record<string, any>, time: TimeSettings) {
  return {
    ...row,
    share_url: `${config().origin}/collect/${row.organization_id}/${row.public_key}`,
    closes_local: row.closes_at ? toWallTime(row.closes_at, time.timeZone) : "",
    timeZone: time.timeZone,
    expired: !!row.closes_at && Date.parse(row.closes_at) <= Date.now(),
  };
}

export async function collectionAdminRoute(
  req: Request,
  p: string[],
  a: Actor,
  json: () => Promise<any>,
): Promise<Response | null> {
  if (p[0] !== "orgs" || p[2] !== "forms") return null;
  const org = z.uuid().parse(p[1]),
    id = p[3] ? z.uuid().parse(p[3]) : null;
  // Form links, personal submissions and review decisions are for signed-in admins.
  if (a.tokenOrg)
    throw new AppError(
      403,
      "Forms require an admin session.",
      "Sign in as an organization administrator.",
    );
  return tenant(a, org, "admin", async (c) => {
    const time = await getTimeSettings(c, org);
    if (req.method !== "GET") await retentionLock(c, org);
    if (!id && p.length === 3) {
      if (req.method === "GET") {
        const forms = (
          await c.query(
            "SELECT f.*,(SELECT count(*)::int FROM collection_submissions s WHERE s.form_id=f.id AND s.organization_id=f.organization_id AND s.status='PENDING') pending_count FROM collection_forms f WHERE organization_id=$1 ORDER BY created_at DESC",
            [org],
          )
        ).rows;
        return response({
          forms: forms.map((row) => share(row, time)),
          fields: await catalog(c, org),
          ...time,
          serverNow: new Date().toISOString(),
        });
      }
      if (req.method === "POST") return save(null);
    }
    if (id && p.length === 4) {
      if (req.method === "GET")
        return response(share(await find(c, org, id), time));
      if (req.method === "PUT") return save(id);
    }
    if (
      id &&
      p[4] === "rotate-link" &&
      p.length === 5 &&
      req.method === "POST"
    ) {
      await find(c, org, id, true);
      const row = (
        await c.query(
          "UPDATE collection_forms SET public_key=$1,updated_at=now() WHERE organization_id=$2 AND id=$3 RETURNING *",
          [randomBytes(32).toString("base64url"), org, id],
        )
      ).rows[0];
      await audit(c, a, org, "form.rotate-link", id);
      return response(share(row, time));
    }
    if (id && p[4] === "submissions") {
      await find(c, org, id);
      if (p.length === 5 && req.method === "GET") {
        const url = new URL(req.url),
          status = z
            .enum(["PENDING", "APPROVED", "REJECTED"])
            .parse(url.searchParams.get("status") || "PENDING"),
          page = z.coerce
            .number()
            .int()
            .min(1)
            .max(100000)
            .parse(url.searchParams.get("page") || 1);
        const items = (
          await c.query(
            "SELECT * FROM collection_submissions WHERE organization_id=$1 AND form_id=$2 AND status=$3 ORDER BY created_at DESC,id LIMIT 25 OFFSET $4",
            [org, id, status, (page - 1) * 25],
          )
        ).rows;
        const total = Number(
          (
            await c.query(
              "SELECT count(*) FROM collection_submissions WHERE organization_id=$1 AND form_id=$2 AND status=$3",
              [org, id, status],
            )
          ).rows[0].count,
        );
        return response({ items, total, page, limit: 25 });
      }
      if (p.length === 6 && req.method === "POST") {
        const sid = z.uuid().parse(p[5]),
          decision = z
            .object({
              action: z.enum(["approve", "reject"]),
              values: z.record(z.string(), z.unknown()).optional(),
              time_zone: z.string().optional(),
            })
            .parse(await json()),
          action = decision.action;
        const submission = (
          await c.query(
            "SELECT * FROM collection_submissions WHERE organization_id=$1 AND form_id=$2 AND id=$3 FOR UPDATE",
            [org, id, sid],
          )
        ).rows[0];
        if (!submission) throw unavailable();
        if (submission.status !== "PENDING")
          throw new AppError(
            409,
            "This submission has already been reviewed.",
            "Refresh the review queue.",
          );
        let pid: string | null = null;
        if (action === "approve") {
          if (decision.time_zone && decision.time_zone !== time.timeZone)
            throw new AppError(
              409,
              "The organization time zone changed.",
              "Reload the response before reviewing it.",
            );
          let submitted = decision.values || submission.values;
          try {
            submitted = normalizeLocalAnswers(
              submission.definition.fields,
              submitted,
              time.timeZone,
            );
          } catch (e) {
            throw new AppError(
              400,
              "Invalid date and time.",
              (e as Error).message,
            );
          }
          const v = values(
              submission.definition.fields,
              submitted,
              submission.assets,
            ),
            custom: Record<string, any> = {};
          for (const [key, value] of Object.entries(v))
            if (!coreKeys.includes(key)) custom[key] = value;
          const person = personSchema.parse({
            ...Object.fromEntries(coreKeys.map((k) => [k, v[k]])),
            custom_fields: custom,
          });
          await useGeneralCardType(c, org, person);
          await validateFields(c, org, person.custom_fields);
          await validateProfilePerson(c, org, person, true);
          pid = randomUUID();
          await c.query(
            "INSERT INTO people(id,organization_id,external_id,name,email,phone,designation,custom_fields) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              pid,
              org,
              person.external_id,
              person.name,
              person.email,
              person.phone,
              person.designation,
              JSON.stringify(person.custom_fields),
            ],
          );
          for (const [key, asset] of Object.entries(submission.assets)) {
            await c.query(
              "UPDATE assets SET collection_private=false WHERE organization_id=$1 AND id=$2",
              [org, asset],
            );
            await c.query(
              "INSERT INTO person_assets(organization_id,person_id,slot,asset_id) VALUES($1,$2,$3,$4)",
              [org, pid, key === "photo" ? "photo" : "signature", asset],
            );
          }
          await audit(c, a, org, "person.create", pid);
          await c.query(
            "UPDATE collection_submissions SET values=$1 WHERE organization_id=$2 AND id=$3",
            [JSON.stringify(v), org, sid],
          );
        }
        await c.query(
          "UPDATE collection_submissions SET status=$1,person_id=$2,reviewed_by=$3,reviewed_at=now() WHERE organization_id=$4 AND id=$5",
          [action === "approve" ? "APPROVED" : "REJECTED", pid, a.id, org, sid],
        );
        await audit(c, a, org, "form." + action, sid);
        return response({ ok: true, person_id: pid });
      }
    }
    throw new AppError(
      405,
      "Method not supported.",
      "Choose a form action from the application.",
    );
    async function save(existing: string | null) {
      const raw = z.record(z.string(), z.unknown()).parse(await json());
      if (
        Object.prototype.hasOwnProperty.call(raw, "closes_local") &&
        !Object.prototype.hasOwnProperty.call(raw, "closes_at")
      ) {
        if (raw.editing_time_zone !== time.timeZone)
          throw new AppError(
            409,
            "The organization time zone changed.",
            "Reload the form before setting its closing time.",
          );
        const local = z.string().max(19).parse(raw.closes_local);
        try {
          raw.closes_at = local
            ? wallTimeToInstant(local, time.timeZone)
            : null;
        } catch (e) {
          throw new AppError(
            400,
            "Invalid closing time.",
            (e as Error).message,
          );
        }
      }
      const d = collectionSchema.parse(raw),
        choices = await catalog(c, org);
      if (d.active && d.closes_at && Date.parse(d.closes_at) <= Date.now())
        throw new AppError(
          400,
          "The closing time has already passed.",
          "Choose a future time in the organization time zone or remove the closing date.",
        );
      for (const required of choices.filter((f) => f.required))
        if (!d.fields.some((f) => f.key === required.key && f.required))
          throw new AppError(
            400,
            `${required.label} is required by this organization.`,
            "Include this field and mark it required.",
          );
      for (const field of d.fields.filter(
        (f) => !coreKeys.includes(f.key) && f.type !== "image",
      )) {
        const type =
          field.type === "date"
            ? "date"
            : field.type === "number"
              ? "number"
              : field.type === "boolean"
                ? "boolean"
                : "text";
        const old = (
          await c.query(
            "SELECT type FROM field_definitions WHERE organization_id=$1 AND key=$2",
            [org, field.key],
          )
        ).rows[0];
        if (old && old.type !== type)
          throw new AppError(
            409,
            `${field.label} already uses another field type.`,
            "Keep its existing type or use a new custom field key.",
          );
        await c.query(
          "INSERT INTO field_definitions(id,organization_id,key,label,type,required,private) VALUES($1,$2,$3,$4,$5,false,true) ON CONFLICT(organization_id,key) DO NOTHING",
          [randomUUID(), org, field.key, field.label, type],
        );
      }
      let row;
      if (existing) {
        await find(c, org, existing, true);
        row = (
          await c.query(
            "UPDATE collection_forms SET title=$1,profession=$2,description=$3,fields=$4,active=$5,closes_at=$6,version=version+1,updated_at=now() WHERE organization_id=$7 AND id=$8 RETURNING *",
            [
              d.title,
              d.profession,
              d.description,
              JSON.stringify(d.fields),
              d.active,
              d.closes_at,
              org,
              existing,
            ],
          )
        ).rows[0];
      } else
        row = (
          await c.query(
            "INSERT INTO collection_forms(id,organization_id,title,profession,description,fields,active,closes_at,public_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
            [
              randomUUID(),
              org,
              d.title,
              d.profession,
              d.description,
              JSON.stringify(d.fields),
              d.active,
              d.closes_at,
              randomBytes(32).toString("base64url"),
            ],
          )
        ).rows[0];
      await audit(c, a, org, existing ? "form.update" : "form.create", row.id);
      return response(share(row, time), existing ? 200 : 201);
    }
  });
}

export async function collectionPublicRoute(
  req: Request,
  p: string[],
  json: () => Promise<any>,
): Promise<Response | null> {
  if (p[0] !== "collect") return null;
  if (
    p.length !== 3 ||
    !z.uuid().safeParse(p[1]).success ||
    !/^[A-Za-z0-9_-]{43}$/.test(p[2] || "")
  )
    throw unavailable();
  if (!["GET", "POST"].includes(req.method))
    throw new AppError(405, "Method not supported.", "Open the form link.");
  if (req.method === "POST" && req.headers.get("origin") !== config().origin)
    throw new AppError(
      403,
      "Form origin is invalid.",
      "Submit using the original form page.",
    );
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  await rateLimit(
    "collect-ip:" + req.method + ":" + ip,
    req.method === "POST" ? 30 : 120,
    req.method === "POST" ? 3600 : 60,
  );
  return transaction(async (c) => {
    // The link capability is checked inside the tenant-scoped transaction before any data is read or written.
    const row = (
      await c.query(
        "SELECT f.*,o.name organization_name FROM collection_forms f JOIN organizations o ON o.id=f.organization_id WHERE f.organization_id=$1 AND public_key=$2 AND active AND (closes_at IS NULL OR closes_at>now()) FOR SHARE OF f",
        [p[1], p[2]],
      )
    ).rows[0];
    if (!row) throw unavailable();
    const time = await getTimeSettings(c, p[1]);
    if (req.method === "GET")
      return response({
        title: row.title,
        profession: row.profession,
        description: row.description,
        fields: row.fields,
        organization_name: row.organization_name,
        version: row.version,
        ...time,
        closes_at: row.closes_at,
        serverNow: new Date().toISOString(),
      });
    await retentionLock(c, p[1]);
    const d = z
      .object({
        version: z.number().int(),
        values: z.record(z.string(), z.unknown()),
        images: z.record(z.string(), z.string().max(5600000)).default({}),
        consent: z.literal(true),
        website: z.string().max(200).default(""),
        time_zone: z.string().optional(),
      })
      .strict()
      .parse(await json());
    if (d.website)
      throw new AppError(
        400,
        "Submission could not be accepted.",
        "Reload the form and try again.",
      );
    if (d.version !== row.version)
      throw new AppError(
        409,
        "This form has changed.",
        "Reload it before submitting your details.",
      );
    if (d.time_zone && d.time_zone !== time.timeZone)
      throw new AppError(
        409,
        "The organization time zone changed.",
        "Reload the form before submitting.",
      );
    let normalized: Record<string, unknown>;
    try {
      normalized = normalizeLocalAnswers(row.fields, d.values, time.timeZone);
    } catch (e) {
      throw new AppError(400, "Invalid date and time.", (e as Error).message);
    }
    const v = values(row.fields, normalized, d.images);
    // Serialize the capacity check without blocking admin closure or link rotation indefinitely.
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1))", [
      row.id,
    ]);
    const pending = Number(
      (
        await c.query(
          "SELECT count(*) FROM collection_submissions WHERE organization_id=$1 AND form_id=$2 AND status='PENDING'",
          [p[1], row.id],
        )
      ).rows[0].count,
    );
    if (pending >= 1000)
      throw new AppError(
        429,
        "This form's review queue is full.",
        "Contact the organization to review existing submissions.",
      );
    const assets: Record<string, string> = {};
    for (const [key, encoded] of Object.entries(d.images)) {
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0)
        throw new AppError(
          400,
          "Invalid image upload.",
          "Choose a JPEG, PNG or WebP file.",
        );
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.length > 4 * 1024 * 1024)
        throw new AppError(
          413,
          "Photo exceeds 4 MB.",
          "Choose a smaller photo.",
        );
      assets[key] = (
        await storeImage(
          c,
          p[1],
          bytes,
          key === "photo" ? "PHOTO" : "SIGNATURE",
          undefined,
          true,
        )
      ).id;
    }
    const id = randomUUID();
    await c.query(
      "INSERT INTO collection_submissions(id,organization_id,form_id,definition,values,assets) VALUES($1,$2,$3,$4,$5,$6)",
      [
        id,
        p[1],
        row.id,
        JSON.stringify({
          fields: row.fields,
          title: row.title,
          profession: row.profession,
          version: row.version,
          organization_name: row.organization_name,
          time_zone: time.timeZone,
          submitted_values: v,
          consent:
            "Applicant agreed to use these details and images to prepare their ID card.",
        }),
        JSON.stringify(v),
        JSON.stringify(assets),
      ],
    );
    return response(
      {
        reference: id,
        message: "Your details have been submitted for review.",
      },
      201,
    );
  }, p[1]);
}
