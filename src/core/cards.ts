import { locationFields } from "./locations.ts";
import { getTimeSettings } from "./time-settings.ts";
import { toWallTime } from "./organization-time.ts";
import { retentionLock } from "./retention-lock.ts";
import { cardProfileValues } from "./card-profiles.ts";
import { resolveStyle, type StyleSnapshot } from "./appearance.ts";
import { applyCardTheme } from "./themes.ts";
import type pg from "pg";
import { randomUUID, randomBytes } from "node:crypto";
import { digest } from "./auth.ts";
import { cardNumber } from "./numbering.ts";
import { config } from "./config.ts";
import {
  templateSchema,
  templateForPerson,
  customFieldBindings,
} from "./template.ts";
import { renderSide, RENDERER_VERSION } from "./render.ts";
import { storeImage, assetBytes } from "./storage.ts";
import { AppError } from "./errors.ts";
export async function requireRow(
  c: pg.PoolClient,
  sql: string,
  args: unknown[],
) {
  const q = await c.query(sql, args);
  if (!q.rowCount)
    throw new AppError(
      404,
      "Record not found.",
      "Choose a record in the current organization.",
    );
  return q.rows[0];
}
export async function generateCard(
  c: pg.PoolClient,
  org: string,
  actorId: string,
  d: {
    person_id: string;
    template_id: string;
    expires_at?: string;
    theme_key?: string;
  },
  options: {
    cardId?: string;
    versionId?: string;
    personSnapshot?: Record<string, any>;
    requestKey?: string;
    styleSnapshot?: StyleSnapshot;
  } = {},
) {
  await retentionLock(c, org);
  await requireRow(
    c,
    "SELECT id FROM people WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL FOR SHARE",
    [org, d.person_id],
  );
  if (options.cardId) {
    const old = await c.query(
      "SELECT id FROM cards WHERE organization_id=$1 AND id=$2",
      [org, options.cardId],
    );
    if (old.rowCount)
      return {
        id: old.rows[0].id,
        render_id: (
          await requireRow(
            c,
            "SELECT id FROM card_renders WHERE card_id=$1 ORDER BY created_at DESC LIMIT 1",
            [options.cardId],
          )
        ).id,
      };
  }
  if (options.requestKey) {
    const old = await c.query(
      "SELECT id,number,person_id FROM cards WHERE organization_id=$1 AND request_key=$2",
      [org, options.requestKey],
    );
    if (old.rowCount) {
      if (old.rows[0].person_id !== d.person_id)
        throw new AppError(
          409,
          "Request key was used for another person.",
          "Use a new idempotency key.",
        );
      return {
        ...old.rows[0],
        render_id: (
          await requireRow(
            c,
            "SELECT id FROM card_renders WHERE card_id=$1 ORDER BY created_at DESC LIMIT 1",
            [old.rows[0].id],
          )
        ).id,
      };
    }
  }
  const person =
    options.personSnapshot ||
    (await requireRow(
      c,
      "SELECT p.*,(SELECT asset_id FROM person_assets pa WHERE pa.person_id=p.id AND slot='photo') photo_asset_id FROM people p WHERE organization_id=$1 AND id=$2",
      [org, d.person_id],
    ));
  await requireRow(
    c,
    "SELECT id FROM templates WHERE organization_id=$1 AND id=$2 AND NOT archived",
    [org, d.template_id],
  );
  const v = options.versionId
    ? await requireRow(
        c,
        "SELECT * FROM template_versions WHERE organization_id=$1 AND id=$2",
        [org, options.versionId],
      )
    : await requireRow(
        c,
        "SELECT * FROM template_versions WHERE template_id=$1 ORDER BY version DESC LIMIT 1",
        [d.template_id],
      );
  const style =
    options.styleSnapshot || (await resolveStyle(c, org, d.theme_key));
  const savedDoc = templateSchema.parse(v.document);
  const rawDoc = templateForPerson(
    savedDoc,
    person,
    !!style.profiles.profiles.staff?.general,
  );
  if (rawDoc.cardType)
    rawDoc.requiredFields = [
      ...new Set([
        ...(rawDoc.requiredFields || []),
        ...(style.profiles.profiles[rawDoc.cardType]?.required || []),
      ]),
    ];
  const doc = applyCardTheme(
    rawDoc,
    style.theme,
    false,
    !savedDoc.cardType && !savedDoc.variants,
  );
  doc.fontFiles = style.fontFiles;
  const profileValues = await cardProfileValues(
    c,
    org,
    person,
    doc,
    true,
    style.profiles,
  );
  const configuredExpiry =
    doc.cardType === "visitor" ||
    (doc.general && person.custom_fields?.valid_until)
      ? person.custom_fields?.valid_until
      : doc.cardType && person.custom_fields?.validity_date
        ? person.custom_fields.validity_date + "T23:59:59Z"
        : null;
  if (
    configuredExpiry &&
    d.expires_at &&
    Date.parse(d.expires_at) !== Date.parse(configuredExpiry)
  )
    throw new AppError(
      422,
      "Card expiry must match the printed validity.",
      "Change the person’s validity date/time, or leave the separate expiry override empty.",
    );
  const seq = await requireRow(
    c,
    "UPDATE number_sequences SET next_value=next_value+1 WHERE organization_id=$1 RETURNING prefix,pattern,next_value-1 n,padding",
    [org],
  );
  const dept =
    (
      await c.query(
        "SELECT u.code FROM org_units u JOIN person_units pu ON pu.unit_id=u.id WHERE pu.person_id=$1 AND u.kind='DEPARTMENT' ORDER BY u.code LIMIT 1",
        [person.id],
      )
    ).rows[0]?.code || "";
  const organizationDate = toWallTime(
    Date.now(),
    (await getTimeSettings(c, org)).timeZone,
  ).slice(0, 10);
  const number = cardNumber(
      seq.pattern,
      seq.prefix,
      String(seq.n),
      seq.padding,
      dept,
      Number(organizationDate.slice(0, 4)),
    ),
    cid = options.cardId || randomUUID(),
    token = randomBytes(32).toString("base64url");
  const fields = {
    ...(await locationFields(c, org, person.id)),
    ...person.custom_fields,
    ...person,
    ...profileValues,
    ...customFieldBindings(person.custom_fields, profileValues),
    "card.number": number,
    "card.verify_url": config().origin + "/verify/" + token,
    "card.date": organizationDate,
    _appearance: { key: style.key, theme: style.theme, locked: style.locked },
  };
  const front = await storeImage(
    c,
    org,
    await renderSide(doc, "front", fields, (aid) =>
      assetBytes(c, org, aid, false, true),
    ),
    "RENDER",
  );
  const back = doc.back.length
    ? await storeImage(
        c,
        org,
        await renderSide(doc, "back", fields, (aid) =>
          assetBytes(c, org, aid, false, true),
        ),
        "RENDER",
      )
    : null;
  await c.query(
    "INSERT INTO cards(id,organization_id,person_id,number,verify_hash,status,expires_at) VALUES($1,$2,$3,$4,$5,'DRAFT',$6)",
    [
      cid,
      org,
      d.person_id,
      number,
      digest(token),
      configuredExpiry || d.expires_at || null,
    ],
  );
  const rid = randomUUID();
  await c.query(
    "INSERT INTO card_renders(id,organization_id,card_id,template_version_id,snapshot,front_asset_id,back_asset_id,renderer_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      rid,
      org,
      cid,
      v.id,
      JSON.stringify({ ...fields, _document: doc }),
      front.id,
      back?.id || null,
      RENDERER_VERSION,
    ],
  );
  await c.query(
    "INSERT INTO card_events(id,organization_id,card_id,type,actor_id) VALUES($1,$2,$3,'GENERATED',$4)",
    [randomUUID(), org, cid, actorId],
  );

  await c.query(
    "UPDATE cards SET request_key=$1 WHERE organization_id=$2 AND id=$3",
    [options.requestKey || null, org, cid],
  );
  await c.query(
    "INSERT INTO audit_events(id,organization_id,actor_id,action,target_id) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), org, actorId, "card.generate", cid],
  );
  return { id: cid, number, render_id: rid };
}
