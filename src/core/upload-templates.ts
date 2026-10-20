import type pg from "pg";
import { ZipArchive } from "archiver";
import { csvCell } from "./imports.ts";
import {
  cardFieldCatalog,
  cardTypes,
  generalCardFields,
  customCardFields,
  type CardType,
} from "./card-field-catalog.ts";
import { profileSettings } from "./card-profiles.ts";
import { AppError } from "./errors.ts";
import { templateSchema, type Template } from "./template.ts";

export function photoFilename(id: string): string {
  return /[<>:"/\\|?*\x00-\x1f]/.test(id) ||
    /[. ]$/.test(id) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(id)
    ? ""
    : `${id}.jpg`;
}
const csv = (rows: unknown[][]) =>
  "\uFEFF" +
  rows
    .map((row) => row.map((value) => csvCell(String(value ?? ""))).join(","))
    .join("\r\n") +
  "\r\n";
export async function uploadTemplate(
  c: pg.PoolClient,
  org: string,
  kind: string,
  profile?: CardType,
  templateId?: string,
  general = false,
) {
  let document: Template | undefined;
  if (templateId) {
    const found = (
      await c.query(
        "SELECT v.document FROM templates t JOIN template_versions v ON v.template_id=t.id WHERE t.organization_id=$1 AND t.id=$2 AND NOT t.archived ORDER BY v.version DESC LIMIT 1",
        [org, templateId],
      )
    ).rows[0];
    if (!found)
      throw new AppError(
        404,
        "Template not found.",
        "Choose an active template from this organization.",
      );
    document = templateSchema.parse(found.document);
    if (!document.cardType)
      throw new AppError(
        409,
        "This template has no card type.",
        "Create a typed preset from Organization → Card fields.",
      );
    profile = document.cardType;
  }
  const settings = await profileSettings(c, org);
  let policy = profile ? settings!.profiles[profile] : undefined;
  if (policy && document)
    policy = {
      ...policy,
      shown: [
        ...new Set([...policy.shown, ...(document.requiredFields || [])]),
      ],
      required: [
        ...new Set([...policy.required, ...(document.requiredFields || [])]),
      ],
    };
  if (profile && !policy)
    throw new AppError(
      409,
      "Save this card type’s field choices first.",
      "Open Organization → Card fields, select the type and save its field choices.",
    );
  const fields = (
    await c.query(
      "SELECT key FROM field_definitions WHERE organization_id=$1 ORDER BY key",
      [org],
    )
  ).rows;
  const columns = profile
    ? [
        "external_id",
        "name",
        "status",
        "custom.card_type",
        ...cardFieldCatalog[profile]
          .filter(
            (f) =>
              policy!.shown.includes(f.key) &&
              (!f.source ||
                f.source === "core" ||
                f.key === "cardholder_signature") &&
              !["name", "external_id"].includes(f.key),
          )
          .map((f) => (f.source === "core" ? f.key : `custom.${f.key}`)),
      ]
    : [
        "external_id",
        "name",
        "email",
        "phone",
        "designation",
        "status",
        ...(!general ? ["custom.card_type"] : []),
        ...new Set([
          ...customCardFields().map((f) => `custom.${f.key}`),
          ...fields
            .filter((f) => f.key !== "card_type")
            .map((f) => `custom.${f.key}`),
        ]),
      ];
  const people = csv([
    columns,
    ...(profile
      ? [
          columns.map((k) =>
            k === "custom.card_type" ? profile : k === "status" ? "ACTIVE" : "",
          ),
        ]
      : []),
  ]);
  const requirements = general
    ? csv([
        [
          "field",
          "import_column",
          "mandatory",
          "shown_on_card",
          "instructions",
        ],
        ...generalCardFields.map((f) => [
          f.label,
          f.source === "core"
            ? f.key
            : !f.source || f.key === "cardholder_signature"
              ? `custom.${f.key}`
              : "",
          settings.profiles.staff?.required.includes(f.key) ? "YES" : "NO",
          settings.profiles.staff?.shown.includes(f.key) ? "YES" : "NO",
          f.source === "image"
            ? "Upload/select the image in this organization."
            : "General card rules apply; leave unused optional fields blank.",
        ]),
      ])
    : profile
      ? csv([
          [
            "field",
            "import_column",
            "mandatory",
            "shown_on_card",
            "checked_when",
          ],
          ...cardFieldCatalog[profile].map((f) => [
            f.label,
            f.source === "core"
              ? f.key
              : !f.source || f.key === "cardholder_signature"
                ? `custom.${f.key}`
                : "",
            policy!.required.includes(f.key) ? "YES" : "NO",
            policy!.shown.includes(f.key) ? "YES" : "NO",
            document?.requiredFields?.includes(f.key) &&
            !settings!.profiles[profile]!.required.includes(f.key)
              ? "Card generation (extra template requirement)"
              : f.source === "image"
                ? "Card generation (upload/select image after importing people)"
                : f.source === "code" ||
                    f.source === "organization" ||
                    f.source === "literal"
                  ? "Card generation (provided by template/organization)"
                  : "People save, import validation and card generation",
          ]),
        ])
      : csv([
          [
            "card_type",
            "field",
            "import_column",
            "mandatory",
            "shown_on_card",
            "instructions",
          ],
          ...Object.entries(cardTypes).flatMap(([key, label]) => {
            const configured = settings.profiles[key as CardType];
            return cardFieldCatalog[key as CardType].map((f) => [
              key,
              f.label,
              f.source === "core"
                ? f.key
                : !f.source || f.key === "cardholder_signature"
                  ? `custom.${f.key}`
                  : "",
              ["name", "external_id"].includes(f.key) ||
              configured?.required.includes(f.key)
                ? "YES"
                : "NO",
              configured?.shown.includes(f.key) ? "YES" : "NO",
              !configured
                ? "Configure this card type in Organization before importing."
                : f.source === "image"
                  ? "Upload/select this image in the app."
                  : f.source === "organization" ||
                      f.source === "code" ||
                      f.source === "literal"
                    ? "Provided by organization/template."
                    : "Fill for this card type; leave unrelated fields blank.",
            ]);
          }),
          ...fields
            .filter(
              (f) =>
                f.key !== "card_type" &&
                !customCardFields().some((v) => v.key === f.key),
            )
            .map((f) => [
              "all",
              f.key,
              `custom.${f.key}`,
              "See organization field settings",
              "",
              "Organization custom field",
            ]),
        ]);
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (kind === "requirements")
    return new Response(requirements, {
      headers: {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="card-field-requirements.csv"',
      },
    });
  if (kind === "people")
    return new Response(people, {
      headers: {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="people-upload-template.csv"',
      },
    });
  const records = (
    await c.query(
      profile
        ? "SELECT external_id,name FROM people WHERE organization_id=$1 AND deleted_at IS NULL AND custom_fields->>'card_type'=$2 ORDER BY external_id LIMIT 10001"
        : "SELECT external_id,name FROM people WHERE organization_id=$1 AND deleted_at IS NULL ORDER BY external_id LIMIT 10001",
      profile ? [org, profile] : [org],
    )
  ).rows;
  if (records.length > 10000)
    throw new Error(
      "Photo guide supports up to 10,000 people. Download a guide after reducing the organization size.",
    );
  const photos = csv([
    ["external_id", "name", "photo_filename", "instructions"],
    ...records.map((p) => [
      p.external_id,
      p.name,
      photoFilename(p.external_id),
      photoFilename(p.external_id)
        ? "Rename the real portrait to this filename (PNG or WebP also accepted)."
        : "ID cannot be used as a Windows filename. Use another matching field or match manually.",
    ]),
  ]);
  if (kind === "photos")
    return new Response(photos, {
      headers: {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="photo-filename-guide.csv"',
      },
    });
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    archive.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
  });
  archive.append(people, { name: "people-upload-template.csv" });
  archive.append(requirements, { name: "card-field-requirements.csv" });
  if (profile)
    archive.append(
      `CARD TYPE: ${profile}\r\nKeep custom.card_type set to ${profile} on EVERY row. Read card-field-requirements.csv for your administrator's mandatory and printed choices. The initial blank row is for you to fill, not sample person data. Use YYYY-MM-DD for dates. Visitor valid_until must include time and timezone (e.g. 2026-10-18T17:00:00+05:30). Cardholder signature cells may contain an existing signature asset ID from this organization; alternatively upload signatures in the person editor after importing. Photos, logo and authorized signatures are uploaded/selected in the app and checked at card generation. RFID is an identifier only, not chip programming.\r\n`,
      { name: "CARD-TYPE-INSTRUCTIONS.txt" },
    );
  archive.append(photos, { name: "photo-filename-guide.csv" });
  archive.append(
    general
      ? "GENERAL CARD IMPORT\r\n\r\nNo card type column is needed. Save General field rules in Organization first. Fill external_id and name plus required fields in people-upload-template.csv. Match columns in Imports, validate, then commit. Use YYYY-MM-DD for dates. Match photos by external_id in Photos; the filename guide lists IDs. Upload signatures in the app or use an existing signature image ID from this organization; never enter a local file path. The requirements guide lists every available field and mandatory choices. Upload/select organization logo and authorized signature in Organization.\r\n"
      : "BULK PEOPLE AND PHOTO UPLOAD\r\n\r\nCARD TYPES: Set custom.card_type on every row to staff, student, visitor or professional. Different card types can share this sheet. Leave fields for other types blank. Configure the card types in Organization first and read card-field-requirements.csv. Use YYYY-MM-DD for dates; visitor valid_until includes time and timezone. Signature cells accept only an existing signature image ID from this organization; otherwise leave them blank and upload in the person editor. Organization logos and authorized signatures are selected in Organization; photos match by external_id. Template-specific mandatory fields are checked when generating cards.\r\n\r\n1. Open people-upload-template.csv in Excel. Keep the header row. Enter one person per row. external_id and name are required. Keep IDs and phone numbers as Text to preserve leading zeros. status is ACTIVE or INACTIVE (blank means ACTIVE). custom.* columns correspond to this organization's custom fields. Save as CSV UTF-8 or XLSX.\r\n2. In Imports, upload the completed file, map columns, validate, then commit the import.\r\n3. Download a fresh Photo filename guide AFTER importing people. It lists the actual IDs and expected portrait filenames.\r\n4. Rename each real portrait to its external_id, such as STAFF001.jpg. PNG and WebP are also accepted. Select Organization ID as the photo matching field. Do not add CSV or instruction files to the photo ZIP.\r\n5. Select multiple photos on Photos, or create a ZIP containing only the renamed portraits and upload it there (up to 200 images / 25 MB per ZIP). Repeat for larger batches.\r\n\r\nThis kit contains templates and instructions only. It does not contain portraits. Photo matching happens during photo upload, not through a spreadsheet photo column.\r\n",
    { name: "READ-ME.txt" },
  );
  await archive.finalize();
  return new Response(new Uint8Array(await completed), {
    headers: {
      ...headers,
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="bulk-upload-kit.zip"',
    },
  });
}
