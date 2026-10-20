import { z } from "zod";
import {
  generalCardFields,
  cardFieldCatalog,
  type CardType,
} from "./card-field-catalog.ts";
import { templateSchema, type Template } from "./template.ts";
import { fontFamilySchema, languageSchema } from "./printing.ts";
import { timeSettingsSchema } from "./organization-time.ts";
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const themeSchema = z.object({
  name: z.string().trim().min(1).max(60),
  paper: color,
  surface: color,
  ink: color,
  muted: color,
  accent: color,
  line: color,
  mint: color,
  cardAccent: color,
  cardBackground: color,
  cardText: color,
  font: fontFamilySchema,
  language: languageSchema.default("en"),
  secondaryLanguage: languageSchema.optional(),
  secondaryFont: fontFamilySchema.optional(),
  logoPosition: z.enum(["left", "right"]),
  fields: z
    .object({
      staff: z.array(z.string()).max(40).optional(),
      student: z.array(z.string()).max(40).optional(),
      visitor: z.array(z.string()).max(40).optional(),
      professional: z.array(z.string()).max(40).optional(),
    })
    .default({}),
});
export type AppTheme = z.infer<typeof themeSchema>;
const themeKey = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
export const appearanceSchema = z.object({
  time: timeSettingsSchema.default({ timeZone: "Asia/Kolkata", hour12: true }),
  printing: z
    .object({
      language: languageSchema.default("en"),
      secondaryLanguage: languageSchema.optional(),
      font: fontFamilySchema.optional(),
      secondaryFont: fontFamilySchema.optional(),
    })
    .default({ language: "en" }),
  defaultTheme: themeKey.default("paper"),
  locked: z.boolean().default(false),
  lockedTheme: themeKey.default("paper"),
  customThemes: z.record(themeKey, themeSchema).default({}),
  defaults: z
    .object({
      staff: z.uuid().optional(),
      student: z.uuid().optional(),
      visitor: z.uuid().optional(),
      professional: z.uuid().optional(),
    })
    .default({}),
});
export type Appearance = z.infer<typeof appearanceSchema>;
const theme = (name: string, values: Partial<AppTheme>) =>
  themeSchema.parse({
    name,
    paper: "#f4f7f8",
    surface: "#ffffff",
    ink: "#182a35",
    muted: "#4b626f",
    accent: "#07646a",
    line: "#ccd8de",
    mint: "#e4f2ec",
    cardAccent: "#075e63",
    cardBackground: "#ffffff",
    cardText: "#182a35",
    font: "DejaVu Sans",
    logoPosition: "right",
    fields: {},
    ...values,
  });
export const builtInThemes: Record<string, AppTheme> = {
  paper: theme("Paper", {}),
  night: theme("Night", {
    paper: "#0d1520",
    surface: "#172231",
    ink: "#eef4fa",
    muted: "#b5c4d4",
    accent: "#7edbe4",
    line: "#415365",
    mint: "#243b49",
    cardAccent: "#1c3855",
  }),
  forest: theme("Forest", {
    paper: "#eef5ef",
    ink: "#193528",
    muted: "#476352",
    accent: "#1c633b",
    mint: "#dfefe3",
    cardAccent: "#1c633b",
    cardText: "#193528",
  }),
  plum: theme("Plum", {
    paper: "#f7f1fa",
    ink: "#35233d",
    muted: "#6b4f73",
    accent: "#713b83",
    mint: "#f0e3f4",
    cardAccent: "#713b83",
    cardText: "#35233d",
  }),
  slate: theme("Slate", {
    paper: "#eef1f5",
    ink: "#263445",
    muted: "#536477",
    accent: "#425e7a",
    mint: "#e0e7ef",
    cardAccent: "#344e68",
    cardText: "#263445",
  }),
  carddesk: theme("CardDesk", {
    paper: "#eef2f7",
    surface: "#ffffff",
    ink: "#14213d",
    muted: "#5d6b82",
    accent: "#1f5eff",
    line: "#d9e0ea",
    mint: "#e4ecff",
    cardAccent: "#1f5eff",
    cardBackground: "#ffffff",
    cardText: "#14213d",
  }),
};
export const layouts = {
  classic: "Classic",
  vertical: "Vertical",
  modern: "Modern",
} as const;
export type CardLayout = keyof typeof layouts;
export function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const v = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return v[0] * 0.2126 + v[1] * 0.7152 + v[2] * 0.0722;
  };
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function themeContrast(t: AppTheme) {
  return {
    "Dashboard text": contrast(t.ink, t.surface),
    "Page text": contrast(t.ink, t.paper),
    "Secondary text": contrast(t.muted, t.surface),
    Links: contrast(t.accent, t.surface),
    "Card text": contrast(t.cardText, t.cardBackground),
    "Card heading": contrast("#ffffff", t.cardAccent),
  };
}
export function validThemeFields(t: AppTheme) {
  return Object.entries(t.fields).every(([kind, keys]) =>
    keys!.every((key) =>
      (kind === "staff"
        ? generalCardFields
        : cardFieldCatalog[kind as CardType]
      ).some((f) => f.key === key),
    ),
  );
}
export function applyCardTheme(
  raw: Template,
  theme: AppTheme,
  includeAllFields = false,
  preserveLayout = false,
): Template {
  const doc = structuredClone(raw);
  doc.language = theme.language || "en";
  doc.secondaryLanguage = theme.secondaryLanguage;
  doc.secondaryFont = theme.secondaryFont;
  if (
    (theme.language || "en") !== "en" ||
    theme.secondaryLanguage ||
    !["DejaVu Sans", "DejaVu Serif", "DejaVu Sans Mono"].includes(theme.font)
  )
    doc.textEngine = "pango";
  if (!doc.cardType || preserveLayout) {
    for (const e of [...doc.front, ...doc.back])
      if (!e.fontOverride && ["text", "date"].includes(e.type)) {
        if (e.language === theme.secondaryLanguage && theme.secondaryFont)
          e.fontFamily = theme.secondaryFont;
        else if (
          !["DejaVu Sans", "DejaVu Serif", "DejaVu Sans Mono"].includes(
            theme.font,
          )
        )
          e.fontFamily = theme.font;
      }
    return templateSchema.parse(doc);
  }
  doc.background = theme.cardBackground;
  const allowed = theme.fields[doc.cardType];
  for (const side of ["front", "back"] as const) {
    for (const e of doc[side])
      if (!e.fieldKey) {
        e.fieldKey =
          e.assetField ||
          (e.type === "photo"
            ? "photo"
            : e.type === "qr"
              ? "qr"
              : e.type === "barcode"
                ? "barcode"
                : /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/.exec(e.text)?.[1]);
        if (e.text === "Cardholder signature")
          e.fieldKey = "cardholder_signature";
        if (e.text === "Authorized signature")
          e.fieldKey = "authorized_signature";
      }
    doc[side] = doc[side].filter(
      (e) =>
        includeAllFields ||
        !allowed ||
        !e.fieldKey ||
        allowed.includes(e.fieldKey) ||
        ["name", "external_id", ...(doc.requiredFields || [])].includes(
          e.fieldKey,
        ),
    );
    for (const e of doc[side]) {
      if (!e.fontOverride)
        e.fontFamily =
          e.language &&
          e.language === theme.secondaryLanguage &&
          theme.secondaryFont
            ? theme.secondaryFont
            : theme.font;
      if (
        e.themeRole === "accent" ||
        (e.type === "rect" && e.fill === "#086b73")
      )
        e.fill = theme.cardAccent;
      if (e.type === "text" || e.type === "date")
        e.fill =
          e.themeRole === "heading" || e.fill === "#ffffff"
            ? "#ffffff"
            : theme.cardText;
      if (e.type === "qr" || e.type === "barcode") {
        e.fill = "#000000";
        e.background = "#ffffff";
      }
      if (e.fieldKey === "organization_logo")
        e.x = theme.logoPosition === "left" ? 4 : doc.width - e.width - 4;
      if (
        e.fieldKey === "organization_name" &&
        doc[side].some((v) => v.fieldKey === "organization_logo")
      )
        e.x = theme.logoPosition === "left" ? 21 : 4;
    }
  }
  return templateSchema.parse(doc);
}
export function themeVariables(t: AppTheme): Record<string, string> {
  return {
    "--ink": t.ink,
    "--muted": t.muted,
    "--teal": t.accent,
    "--line": t.line,
    "--paper": t.paper,
    "--mint": t.mint,
    "--surface": t.surface,
    "--button-ink":
      contrast("#ffffff", t.accent) >= 4.5 ? "#ffffff" : "#10212b",
    "--app-font":
      t.font === "DejaVu Serif"
        ? "Georgia, serif"
        : t.font === "DejaVu Sans Mono"
          ? "monospace"
          : "Arial, Helvetica, sans-serif",
  };
}
