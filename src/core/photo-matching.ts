import type pg from "pg";
import { z } from "zod";
import { digest, audit, type Actor } from "./auth.ts";
import { AppError } from "./errors.ts";

type Person = {
  id: string;
  name: string;
  external_id: string;
  value: string | null;
  has_photo: boolean;
};
type Photo = {
  id: string;
  original_name: string;
  sha256: string;
  assigned_to: string[];
};
export function buildPhotoMatches(
  people: Person[],
  photos: Photo[],
  ignoreSpaces: boolean,
) {
  const normalize = (value: string) =>
    ignoreSpaces ? value.replace(/\s/gu, "") : value;
  const byPerson = new Map<string, Person[]>(),
    byPhoto = new Map<string, Photo[]>();
  for (const p of people) {
    const key = normalize(p.value ?? "");
    if (key) byPerson.set(key, [...(byPerson.get(key) || []), p]);
  }
  for (const photo of photos) {
    const filename = photo.original_name.split(/[\\/]/).pop() || "";
    const key = normalize(filename.replace(/\.(jpe?g|png|webp)$/i, ""));
    if (key) byPhoto.set(key, [...(byPhoto.get(key) || []), photo]);
  }
  return [...byPhoto.entries()].map(([key, candidates]) => {
    const photo = candidates[0],
      persons = byPerson.get(key) || [],
      person = persons.length === 1 ? persons[0] : undefined;
    const reason = !persons.length
      ? "No person with this ID"
      : persons.length > 1
        ? "More than one person matches"
        : person!.has_photo
          ? "Person already has a photo"
          : new Set(candidates.map((a) => a.sha256)).size > 1
            ? "Different photos have the same matching filename"
            : candidates.some((a) =>
                  a.assigned_to.some((id) => id !== person!.id),
                )
              ? "Photo already assigned to another person"
              : "Ready to match";
    return {
      asset_id: photo.id,
      filename: photo.original_name,
      person_id: person?.id || null,
      person_name: person?.name || "",
      external_id: person?.external_id || "",
      ready: reason === "Ready to match",
      reason,
      duplicates: candidates.length - 1,
    };
  });
}
export async function photoMatches(
  c: pg.PoolClient,
  org: string,
  actor: Actor,
  raw: unknown,
) {
  const input = z
    .object({
      field: z
        .string()
        .regex(/^[a-z][a-z0-9_]*$/)
        .max(64)
        .default("external_id"),
      ignore_spaces: z.boolean().default(true),
      action: z.enum(["preview", "apply"]).default("preview"),
      preview_token: z.string().length(64).optional(),
    })
    .parse(raw);
  if (
    input.field !== "external_id" &&
    !(
      await c.query(
        "SELECT 1 FROM field_definitions WHERE organization_id=$1 AND key=$2",
        [org, input.field],
      )
    ).rowCount
  )
    throw new AppError(
      400,
      "Unknown photo matching field.",
      "Select Organization ID or an organization field.",
    );
  const people = (
    await c.query(
      "SELECT p.id,p.name,p.external_id,CASE WHEN $2='external_id' THEN p.external_id ELSE p.custom_fields->>$2 END AS value,EXISTS(SELECT 1 FROM person_assets pa WHERE pa.person_id=p.id AND pa.slot='photo') AS has_photo FROM people p WHERE p.organization_id=$1 AND p.deleted_at IS NULL ORDER BY p.id LIMIT 10001",
      [org, input.field],
    )
  ).rows;
  const photos = (
    await c.query(
      "SELECT a.id,a.original_name,a.sha256,ARRAY(SELECT pa.person_id::text FROM person_assets pa WHERE pa.asset_id=a.id AND pa.slot='photo' ORDER BY pa.person_id) AS assigned_to FROM assets a WHERE a.organization_id=$1 AND a.kind='PHOTO' AND a.deleted_at IS NULL AND NOT a.collection_private ORDER BY a.created_at DESC,a.id DESC LIMIT 10001",
      [org],
    )
  ).rows;
  if (people.length > 10000 || photos.length > 10000)
    throw new AppError(
      422,
      "Bulk matching supports up to 10,000 people and photos.",
      "Use individual photo matching for larger organizations.",
    );
  const items = buildPhotoMatches(people, photos, input.ignore_spaces);
  const preview_token = digest(
    JSON.stringify({
      field: input.field,
      ignore_spaces: input.ignore_spaces,
      items,
    }),
  );
  const ready = items.filter((i) => i.ready);
  if (input.action === "preview")
    return {
      items,
      preview_token,
      ready: ready.length,
      skipped: items.length - ready.length,
    };
  if (input.preview_token !== preview_token)
    throw new AppError(
      409,
      "Photos or people changed since the preview.",
      "Preview bulk matches again before applying.",
    );
  const matched = await c.query(
    "INSERT INTO person_assets(organization_id,person_id,slot,asset_id) SELECT $1,p.id,'photo',a.id FROM jsonb_to_recordset($2::jsonb) AS d(person_id uuid,asset_id uuid) JOIN people p ON p.id=d.person_id AND p.organization_id=$1 AND p.deleted_at IS NULL JOIN assets a ON a.id=d.asset_id AND a.organization_id=$1 AND a.kind='PHOTO' AND a.deleted_at IS NULL AND NOT a.collection_private ON CONFLICT(person_id,slot) DO NOTHING RETURNING person_id",
    [org, JSON.stringify(ready)],
  );
  await audit(c, actor, org, "photos.bulk-match");
  return {
    matched: matched.rowCount,
    skipped: items.length - (matched.rowCount || 0),
  };
}
