import { test } from "node:test";
import assert from "node:assert/strict";
import {
  templateSchema,
  templateForPerson,
  customFieldBindings,
  bind,
} from "../src/core/template.ts";
import { profileTemplate } from "../src/core/card-profiles.ts";
import {
  cardTypes,
  defaultCardPolicy,
  type CardType,
} from "../src/core/card-field-catalog.ts";
const variants = Object.fromEntries(
  Object.keys(cardTypes).map((k) => [
    k,
    profileTemplate(k as CardType, defaultCardPolicy(k as CardType)),
  ]),
);
const shared = () =>
  templateSchema.parse({
    ...variants.staff,
    cardType: undefined,
    requiredFields: undefined,
    variants,
  });
test("custom-prefixed bindings use resolved defaults and do not expose inherited keys", () => {
  const custom = Object.assign(Object.create({ hidden: "private" }), {
    birth_date: "2000-01-02",
    practice: "Clinic",
  });
  const aliases = customFieldBindings(custom, {
    birth_date: "2000-01-02",
    course: "",
  });
  assert.equal(
    bind(
      "{{custom.birth_date}} / {{custom.practice}} / {{custom.course}}",
      aliases,
    ),
    "2000-01-02 / Clinic / ",
  );
  assert.throws(() => bind("{{custom.hidden}}", aliases));
  assert.throws(() => bind("{{custom.unknown}}", aliases));
});
test("custom templates adopt the General policy without changing the saved design or legacy typed templates", () => {
  const custom = templateSchema.parse({
    ...variants.staff,
    cardType: undefined,
    requiredFields: ["name", "external_id"],
  });
  const before = JSON.stringify(custom);
  const resolved = templateForPerson(
    custom,
    { custom_fields: { card_type: "staff" } },
    true,
  );
  assert.equal(resolved.general, true);
  assert.equal(resolved.cardType, "staff");
  assert.deepEqual(resolved.front, custom.front);
  assert.deepEqual(resolved.requiredFields, custom.requiredFields);
  assert.equal(JSON.stringify(custom), before);
  assert.equal(templateForPerson(custom, {}, false).cardType, undefined);
  assert.equal(
    templateForPerson(variants.student, {}, true).cardType,
    "student",
  );
});
test("one shared template selects all four complete layouts without changing the saved template", () => {
  const doc = shared(),
    before = JSON.stringify(doc);
  for (const kind of Object.keys(cardTypes)) {
    const chosen = templateForPerson(doc, {
      custom_fields: { card_type: kind },
    });
    assert.equal(chosen.cardType, kind);
    assert.ok(chosen.front.length && chosen.back.length);
    chosen.front[0].width = 1;
  }
  assert.equal(JSON.stringify(doc), before);
  assert.throws(
    () => templateForPerson(doc, { custom_fields: {} }),
    /card type/,
  );
  assert.throws(
    () => templateForPerson(doc, { custom_fields: { card_type: "wrong" } }),
    /card type/,
  );
});
test("shared template schema rejects missing or incorrectly tagged layouts", () => {
  const doc = shared();
  delete (doc.variants as any).student;
  assert.equal(templateSchema.safeParse(doc).success, false);
  const wrong = shared();
  wrong.variants!.visitor.cardType = "staff";
  assert.equal(templateSchema.safeParse(wrong).success, false);
});

test("General templates use one policy and expose fields from every former category", () => {
  const doc = profileTemplate("staff", {
    ...defaultCardPolicy("staff"),
    general: true,
    shown: ["name", "external_id", "course", "visitor_company", "access_level"],
  });
  assert.equal(doc.general, true);
  assert.ok(doc.front.some((e) => e.text.includes("{{course}}")));
  assert.ok(doc.front.some((e) => e.text.includes("{{visitor_company}}")));
  assert.ok(doc.front.some((e) => e.text.includes("{{access_level}}")));
  assert.equal(
    templateSchema.safeParse({ ...doc, cardType: "student" }).success,
    false,
  );
});
