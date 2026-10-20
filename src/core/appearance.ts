import { randomUUID } from "node:crypto";
import { getTimeSettings } from "./time-settings.ts";
import { snapshotFontFamilies } from "./font-library.ts";
import type pg from "pg";
import { AppError } from "./errors.ts";
import {
  builtInThemes,
  appearanceSchema,
  themeContrast,
  validThemeFields,
  applyCardTheme,
  type AppTheme,
  type CardLayout,
  type Appearance,
} from "./themes.ts";
import {
  cardTypes,
  defaultCardPolicy,
  type CardType,
} from "./card-field-catalog.ts";
import {
  profileSettings,
  profileTemplate,
  saveProfile,
} from "./card-profiles.ts";
import { templateSchema } from "./template.ts";
export async function getAppearance(c: pg.PoolClient, org: string) {
  const row = (
    await c.query("SELECT appearance FROM organizations WHERE id=$1", [org])
  ).rows[0];
  return appearanceSchema.parse(row.appearance);
}
export function allThemes(settings: Appearance) {
  return { ...builtInThemes, ...settings.customThemes };
}
export async function saveAppearance(
  c: pg.PoolClient,
  org: string,
  raw: unknown,
) {
  const d = appearanceSchema.parse(raw),
    themes = allThemes(d);
  // Appearance editors may hold an older copy of these independently saved settings.
  await c.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [org]);
  d.time = await getTimeSettings(c, org);
  if (
    Object.keys(d.customThemes).length > 30 ||
    Object.keys(d.customThemes).some((key) => key in builtInThemes)
  )
    throw new AppError(
      422,
      "Choose a unique custom theme name.",
      "Keep built-in themes unchanged and use up to 30 custom themes.",
    );
  if (!themes[d.defaultTheme] || !themes[d.lockedTheme])
    throw new AppError(
      422,
      "Theme is unavailable.",
      "Select an existing theme.",
    );
  for (const theme of Object.values(d.customThemes)) {
    const low = Object.entries(themeContrast(theme)).filter(
      ([, value]) => value < 4.5,
    );
    if (!validThemeFields(theme) || low.length)
      throw new AppError(
        422,
        "Theme needs clearer colours or valid fields.",
        low.length
          ? low
              .map(
                ([key, value]) =>
                  `${key}: ${value.toFixed(2)}:1 (minimum 4.5:1)`,
              )
              .join("; ")
          : "Choose fields belonging to the selected card type.",
      );
  }
  for (const [kind, id] of Object.entries(d.defaults)) {
    const row = (
      await c.query(
        "SELECT v.document FROM templates t JOIN template_versions v ON v.template_id=t.id WHERE t.organization_id=$1 AND t.id=$2 AND NOT t.archived ORDER BY v.version DESC LIMIT 1",
        [org, id],
      )
    ).rows[0];
    if (
      !row ||
      (!row.document.general &&
        row.document.cardType !== kind &&
        !row.document.variants?.[kind])
    )
      throw new AppError(
        422,
        "Default template does not match the card type.",
        "Select an active template for this card type in this organization.",
      );
  }
  await c.query("UPDATE organizations SET appearance=$2 WHERE id=$1", [
    org,
    JSON.stringify(d),
  ]);
  return d;
}
export type StyleSnapshot = {
  fontFiles?: Record<string, string>;
  key: string;
  theme: AppTheme;
  locked: boolean;
  profiles: Awaited<ReturnType<typeof profileSettings>>;
};
export async function resolveStyle(
  c: pg.PoolClient,
  org: string,
  requested?: string,
): Promise<StyleSnapshot> {
  const settings = await getAppearance(c, org),
    key = settings.locked
      ? settings.lockedTheme
      : requested || settings.defaultTheme,
    theme = allThemes(settings)[key];
  if (!theme)
    throw new AppError(
      422,
      "Theme is unavailable.",
      "Refresh and choose an available theme.",
    );
  return {
    key,
    theme: { ...theme, ...settings.printing },
    fontFiles: await snapshotFontFamilies(),
    locked: settings.locked,
    profiles: await profileSettings(c, org),
  };
}
export async function defaultTemplate(
  c: pg.PoolClient,
  org: string,
  kind?: string,
) {
  const settings = await getAppearance(c, org),
    id = settings.defaults[kind as CardType];
  if (!id)
    throw new AppError(
      422,
      "Choose a template or configure a default for this card type.",
      "Open Organization → Appearance to set the default.",
    );
  const row = (
    await c.query(
      "SELECT id FROM templates WHERE organization_id=$1 AND id=$2 AND NOT archived",
      [org, id],
    )
  ).rows[0];
  if (!row)
    throw new AppError(
      422,
      "Default template is archived or missing.",
      "Select a new default template.",
    );
  return id;
}
export async function createStylePreset(
  c: pg.PoolClient,
  org: string,
  kind: CardType,
  layout: CardLayout,
  themeKey?: string,
) {
  const style = await resolveStyle(c, org, themeKey),
    policy = style.profiles.profiles[kind] || defaultCardPolicy(kind);
  await saveProfile(c, org, kind, policy);
  const doc = styleDocument(kind, policy, style, layout);
  const id = randomUUID();
  await c.query(
    "INSERT INTO templates(id,organization_id,name) VALUES($1,$2,$3)",
    [id, org, `${cardTypes[kind]} · ${layout} · ${style.theme.name}`],
  );
  await c.query(
    "INSERT INTO template_versions(id,organization_id,template_id,version,document) VALUES($1,$2,$3,1,$4)",
    [randomUUID(), org, id, JSON.stringify(doc)],
  );
  return { id };
}

function styleDocument(
  kind: CardType,
  policy: ReturnType<typeof defaultCardPolicy>,
  style: StyleSnapshot,
  layout: CardLayout,
) {
  let doc = profileTemplate(kind, policy);
  doc.stylePreset = layout;
  for (const side of ["front", "back"] as const)
    for (const e of doc[side]) {
      if (e.type === "rect") e.themeRole = "accent";
      else if (e.fill === "#ffffff") e.themeRole = "heading";
      else if (e.type === "text") e.themeRole = "text";
      const binding = /\{\{\s*([a-z_]+)\s*\}\}/.exec(e.text)?.[1];
      e.fieldKey =
        e.assetField ||
        (e.type === "photo"
          ? "photo"
          : e.type === "qr"
            ? "qr"
            : e.type === "barcode"
              ? "barcode"
              : binding);
      if (e.type === "text" && e.text === "Cardholder signature")
        e.fieldKey = "cardholder_signature";
      if (e.type === "text" && e.text === "Authorized signature")
        e.fieldKey = "authorized_signature";
    }
  doc.back.unshift({ ...doc.front[0], id: randomUUID() });
  doc.back[1].themeRole = "heading";
  if (layout === "vertical") {
    doc.height = 140;
    for (const e of doc.front) {
      if (e.fieldKey === "photo") {
        e.x = 31.8;
        e.y = 30;
      } else if (e.fieldKey === "name") {
        e.x = 4;
        e.y = 61;
        e.width = 77;
        e.align = "center";
      } else if (e.fieldKey === "external_id") {
        e.x = 4;
        e.y = 74;
        e.width = 77;
        e.align = "center";
      } else if (e.fieldKey === "visitor_label") {
        e.x = 4;
        e.y = 85;
        e.width = 77;
      } else if (e.y >= 62) e.y += 30;
    }
  }
  if (layout === "modern") {
    for (const side of ["front", "back"] as const)
      doc[side].push({
        ...doc.front[0],
        id: randomUUID(),
        x: 0,
        y: doc.height - 2,
        height: 2,
      });
  }
  doc = applyCardTheme(templateSchema.parse(doc), style.theme, true);
  return doc;
}
export async function createSharedTemplate(
  c: pg.PoolClient,
  org: string,
  themeKey?: string,
  general = false,
) {
  const style = await resolveStyle(c, org, themeKey);
  const variants = {} as NonNullable<
    import("./template.ts").Template["variants"]
  >;
  for (const kind of (general
    ? ["staff"]
    : Object.keys(cardTypes)) as CardType[]) {
    const policy = {
      ...(style.profiles.profiles[kind] || defaultCardPolicy(kind)),
      ...(general ? { general: true } : {}),
    };
    await saveProfile(c, org, kind, policy);
    variants[kind] = styleDocument(kind, policy, style, "classic");
  }
  const document = templateSchema.parse({
    ...variants.staff,
    ...(general
      ? {}
      : { cardType: undefined, requiredFields: undefined, variants }),
  });
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    "shared-template:" + org,
  ]);
  const existing = (
    await c.query(
      "SELECT t.id FROM templates t JOIN LATERAL (SELECT document FROM template_versions WHERE template_id=t.id ORDER BY version DESC LIMIT 1) v ON true WHERE t.organization_id=$1 AND NOT t.archived AND (v.document ? 'variants' OR v.document->>'general'='true') ORDER BY t.created_at LIMIT 1",
      [org],
    )
  ).rows[0];
  const id = existing?.id || randomUUID();
  if (!existing)
    await c.query(
      "INSERT INTO templates(id,organization_id,name) VALUES($1,$2,$3)",
      [id, org, general ? "General card template" : "Shared card template"],
    );
  if (existing && general)
    await c.query("UPDATE templates SET name=$2 WHERE id=$1", [
      id,
      "General card template",
    ]);
  const version = (
    await c.query(
      "SELECT COALESCE(max(version),0)+1 n FROM template_versions WHERE template_id=$1",
      [id],
    )
  ).rows[0].n;
  await c.query(
    "INSERT INTO template_versions(id,organization_id,template_id,version,document) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), org, id, version, JSON.stringify(document)],
  );
  return { id };
}
