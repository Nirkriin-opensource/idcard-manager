export const cardTypes = {
  staff: "Faculty / Staff",
  student: "Student",
  visitor: "Temporary / Visitor",
  professional: "Working Professional",
} as const;
export type CardType = keyof typeof cardTypes;
export type CardField = {
  key: string;
  label: string;
  type?: "date";
  source?: "core" | "image" | "organization" | "code" | "literal";
};
const f = (
  key: string,
  label: string,
  source?: CardField["source"],
  type?: "date",
): CardField => ({ key, label, source, type });
const common = [
  f("photo", "Photo", "image"),
  f("name", "Full name", "core"),
  f("external_id", "Employee / Student / Pass ID", "core"),
];
const end = [
  f("cardholder_signature", "Cardholder signature", "image"),
  f("authorized_signature", "Authorized signature", "image"),
  f("issue_date", "Issue date", undefined, "date"),
  f("validity_date", "Validity date", undefined, "date"),
  f("qr", "QR code", "code"),
  f("barcode", "Barcode", "code"),
  f("rfid", "RFID identifier"),
  f("organization_name", "Organization / company name", "organization"),
  f("organization_logo", "Organization / company logo", "image"),
];
export const cardFieldCatalog: Record<CardType, CardField[]> = {
  staff: [
    ...common,
    f("designation", "Designation", "core"),
    f("department", "Department"),
    f("joining_date", "Date of joining", undefined, "date"),
    f("birth_date", "Date of birth", undefined, "date"),
    f("blood_group", "Blood group"),
    f("phone", "Contact number", "core"),
    f("emergency_contact", "Emergency contact"),
    f("email", "Email ID", "core"),
    f("residential_address", "Residential address"),
    ...end,
  ],
  student: [
    ...common,
    f("course", "Course / program"),
    f("year_semester_batch", "Year / semester / batch"),
    f("department", "Department"),
    f("birth_date", "Date of birth", undefined, "date"),
    f("blood_group", "Blood group"),
    f("phone", "Contact number", "core"),
    f("guardian_name", "Parent / guardian name"),
    f("guardian_phone", "Parent / guardian phone"),
    f("residential_address", "Residential address"),
    ...end,
  ],
  visitor: [
    f("visitor_label", "Visitor label", "literal"),
    ...common,
    f("visitor_company", "Visitor’s company"),
    f("visit_purpose", "Purpose of visit"),
    f("person_to_meet", "Person to meet"),
    f("department_to_meet", "Department to meet"),
    f("visit_date", "Visit date", undefined, "date"),
    f("time_in", "Time in"),
    f("time_out", "Time out"),
    f("permitted_areas", "Areas permitted"),
    f("valid_until", "Valid until (date and time)"),
    ...end.filter((v) =>
      [
        "authorized_signature",
        "qr",
        "barcode",
        "organization_name",
        "organization_logo",
      ].includes(v.key),
    ),
    f("return_note", "Return at exit note", "literal"),
  ],
  professional: [
    ...common,
    f("designation", "Designation", "core"),
    f("department", "Department / team"),
    f("work_location", "Work location / branch"),
    f("joining_date", "Date of joining", undefined, "date"),
    f("blood_group", "Blood group"),
    f("emergency_contact", "Emergency contact"),
    f("email", "Official email (optional)", "core"),
    f("registration_number", "Professional registration number (optional)"),
    f("access_level", "Access level"),
    ...end.filter((v) => v.key !== "cardholder_signature"),
  ],
};
export const generalCardFields = [
  ...new Map(
    Object.values(cardFieldCatalog)
      .flat()
      .map((f) => [f.key, f]),
  ).values(),
].map((field) => ({
  ...field,
  label:
    field.key === "external_id"
      ? "ID number"
      : field.key === "email"
        ? "Email"
        : field.key === "organization_name"
          ? "Organization name"
          : field.label.replace(" (optional)", ""),
}));
export const generalCardTypes = { staff: "General" } as const;
export type CardPolicy = {
  general?: boolean;
  shown: string[];
  required: string[];
  assets: { organization_logo?: string; authorized_signature?: string };
};
export const defaultCardPolicy = (kind: CardType): CardPolicy => ({
  shown: cardFieldCatalog[kind].map((f) => f.key),
  required: ["name", "external_id"],
  assets: {},
});
export const customCardFields = () => [
  ...new Map(
    Object.values(cardFieldCatalog)
      .flat()
      .filter((f) => !f.source || f.key === "cardholder_signature")
      .map((f) => [f.key, f]),
  ).values(),
];
