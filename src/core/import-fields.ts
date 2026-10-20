import { cardTypes, customCardFields } from "./card-field-catalog";
const core = [
  { key: "external_id", label: "Employee / Student / Pass ID" },
  { key: "name", label: "Full name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Contact number" },
  { key: "designation", label: "Designation" },
  { key: "status", label: "Status" },
  { key: "custom.card_type", label: "Card type" },
];
export function importFields(definitions: { key: string; label?: string }[]) {
  return [
    ...new Map(
      [
        ...core,
        ...customCardFields().map((f) => ({
          key: `custom.${f.key}`,
          label: f.label,
        })),
        ...definitions.map((f) => ({
          key: `custom.${f.key}`,
          label: f.label || f.key,
        })),
      ].map((f) => [f.key, f]),
    ).values(),
  ];
}
export function matchImportColumns(
  columns: string[],
  definitions: { key: string; label?: string }[],
) {
  const fields = importFields(definitions),
    used = new Set<string>(),
    result: Record<string, string> = {};
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const column of columns) {
    const exact = fields.find((f) => f.key === column);
    if (exact && !used.has(exact.key)) {
      result[column] = exact.key;
      used.add(exact.key);
    }
  }
  for (const column of columns) {
    if (result[column]) continue;
    const candidates = fields.filter(
      (f) =>
        !used.has(f.key) &&
        [f.label, f.key, f.key.replace(/^custom\./, "")].some(
          (v) => normalize(v) === normalize(column),
        ),
    );
    if (candidates.length === 1) {
      result[column] = candidates[0].key;
      used.add(candidates[0].key);
    }
  }
  return result;
}
export function importCardType(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    Object.keys(cardTypes).find(
      (k) =>
        k === normalized ||
        cardTypes[k as keyof typeof cardTypes].toLowerCase() === normalized,
    ) ||
    (
      {
        faculty: "staff",
        "faculty / staff": "staff",
        temporary: "visitor",
        "temporary / visitor": "visitor",
        "working professional": "professional",
      } as Record<string, string>
    )[normalized] ||
    normalized
  );
}
