import { test, before, after, beforeEach } from "node:test";
import { digest } from "../../src/core/auth.ts";
import {
  bootstrapAdmin,
  bootstrapAdminInTransaction,
  initialAdminEmail,
} from "../../src/core/bootstrap-admin.ts";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import EmbeddedPostgres from "embedded-postgres";
import argon2 from "argon2";
import sharp from "sharp";
import { chromium } from "@playwright/test";
import { db, closeDb, transaction } from "../../src/core/db.ts";
import { migrate } from "../../src/core/migrate.ts";
import { handle } from "../../src/core/api.ts";
import { elementSchema, templateSchema } from "../../src/core/template.ts";
import { zipFile } from "../zip-fixture.ts";
import ExcelJS from "exceljs";
import { ZipArchive } from "archiver";
import { once } from "node:events";
import { cleanupPurgeFiles } from "../../src/core/retention.ts";
import { runExport, runGeneration } from "../../src/core/jobs.ts";
import { builtInThemes, appearanceSchema } from "../../src/core/themes.ts";
import {
  defaultCardPolicy,
  type CardType,
} from "../../src/core/card-field-catalog.ts";
import { renderExport, createExport, pt } from "../../src/core/exports.ts";
import { storagePath } from "../../src/core/storage.ts";
import { readFile } from "node:fs/promises";
const root = path.resolve("storage", "test-" + randomUUID()),
  password = randomBytes(20).toString("hex"),
  origin = "http://localhost:" + (process.env.IDCARD_TEST_HTTP_PORT || "3107");
let postgres: EmbeddedPostgres, server: ChildProcess, worker: ChildProcess;
let cookie = "",
  csrf = "",
  org = "",
  otherOrg = "",
  person = "",
  template = "",
  card = "",
  render = "",
  photo = "";
const adminEmail = "admin@example.test",
  adminPassword = randomBytes(24).toString("base64url");
beforeEach(async () => {
  // Each isolated test gets its own API budget; production limits stay unchanged.
  const user = (
    await db().query("SELECT id FROM users WHERE email=$1", [adminEmail])
  ).rows[0];
  if (user)
    await db().query("DELETE FROM login_limits WHERE key=$1", [
      digest("api:" + user.id),
    ]);
});

test(
  "font catalog and files are private, uploads are validated and print settings persist",
  { timeout: 90000 },
  async () => {
    const fontOrg = (
      await ok("orgs", "POST", { name: "Font test", code: "FONTTEST" })
    ).id;
    assert.equal(
      (await call("fonts", "GET", undefined, false, { cookie: "", csrf: "" }))
        .response.status,
      401,
    );
    const catalog = await ok("fonts");
    assert.ok(catalog.fonts.length > 0);
    assert.equal(catalog.fonts[0].file, undefined);
    const file = await call(`fonts/file/${catalog.fonts[0].id}`);
    assert.equal(file.response.status, 200);
    assert.ok(file.data.length > 12);
    assert.match(file.response.headers.get("cache-control") || "", /private/);
    assert.equal(
      (
        await call(
          `fonts/file/${catalog.fonts[0].id}`,
          "GET",
          undefined,
          false,
          { cookie: "", csrf: "" },
        )
      ).response.status,
      401,
    );
    assert.equal(
      (
        await call(
          `fonts?org=${fontOrg}&filename=fake.ttf`,
          "POST",
          Buffer.from("not a font"),
          true,
        )
      ).response.status,
      400,
    );
    const upload = await ok(
      `fonts?org=${fontOrg}&filename=sample.${file.response.headers.get("content-type") === "font/collection" ? "ttc" : file.response.headers.get("content-type") === "font/otf" ? "otf" : "ttf"}`,
      "POST",
      file.data,
      true,
    );
    assert.ok(upload.length > 0);
    const base = `orgs/${fontOrg}/appearance`,
      settings = await ok(base);
    await ok(base, "PUT", {
      ...settings,
      printing: {
        language: "en",
        secondaryLanguage: "ta",
        font: catalog.fonts[0].family,
      },
    });
    assert.equal((await ok(base)).printing.secondaryLanguage, "ta");
    await ok(base, "PUT", settings);
  },
);

test("General cards combine all fields and need no person category", async () => {
  const generalOrg = (
      await ok("orgs", "POST", { name: "General Cards", code: "GENERAL" })
    ).id,
    base = "orgs/" + generalOrg + "/";
  const { generalCardFields } =
    await import("../../src/core/card-field-catalog.ts");
  await ok(base + "card-profiles", "PUT", {
    kind: "staff",
    policy: {
      general: true,
      shown: generalCardFields.map((f) => f.key),
      required: [
        "name",
        "external_id",
        "course",
        "visitor_company",
        "access_level",
      ],
      assets: {},
    },
  });
  const invalid = await call(base + "people", "POST", {
    external_id: "G-BAD",
    name: "Missing fields",
  });
  assert.equal(invalid.response.status, 422);
  const p = (
    await ok(base + "people", "POST", {
      external_id: "G001",
      name: "General Person",
      custom_fields: {
        course: "Science",
        visitor_company: "Example",
        access_level: "Office",
      },
    })
  ).id;
  assert.equal(
    (await ok(base + "people/" + p)).custom_fields.card_type,
    "staff",
  );
  const created = (
    await ok(base + "appearance", "POST", { shared: true, general: true })
  ).id;
  const doc = (await ok(base + "templates/" + created)).document;
  assert.equal(doc.general, true);
  assert.equal(doc.variants, undefined);
  assert.ok(doc.height >= 110);
  assert.ok(doc.front.some((e: any) => e.text === "General"));
  assert.equal(
    (await ok(base + "appearance", "POST", { shared: true, general: true })).id,
    created,
  );
  const generated = await ok(base + "cards", "POST", {
    person_id: p,
    template_id: created,
  });
  assert.ok(generated.render_id);
  const customDoc = { ...doc };
  delete customDoc.cardType;
  delete customDoc.general;
  customDoc.background = "#f1e2d3";
  customDoc.front = customDoc.front.map((e: any) => ({
    ...e,
    text: e.text
      .replace("{{course}}", "{{custom.course}}")
      .replace("{{birth_date}}", "{{custom.birth_date}}"),
  }));
  customDoc.back = customDoc.back.map((e: any) => ({
    ...e,
    text: e.text
      .replace("{{course}}", "{{custom.course}}")
      .replace("{{birth_date}}", "{{custom.birth_date}}"),
  }));
  const customTemplate = (
    await ok(base + "templates", "POST", {
      name: "Custom General design",
      document: customDoc,
    })
  ).id;
  const customCard = await ok(base + "cards", "POST", {
    person_id: p,
    template_id: customTemplate,
  });
  assert.ok(
    (
      await ok(base + "preview", "POST", {
        person_id: p,
        document: customDoc,
        side: "front",
      })
    ).length > 0,
  );
  assert.ok(customCard.render_id);
  const customSnapshot = await transaction(
    async (c) =>
      (
        await c.query("SELECT snapshot FROM card_renders WHERE id=$1", [
          customCard.render_id,
        ])
      ).rows[0].snapshot,
    generalOrg,
  );
  assert.equal(customSnapshot._document.general, true);
  assert.equal(customSnapshot._document.background, "#f1e2d3");
  assert.equal(customSnapshot["custom.course"], "Science");
  assert.equal(customSnapshot["custom.birth_date"], "");
  assert.equal(
    (await ok(base + "templates/" + customTemplate)).document.cardType,
    undefined,
  );
  const incompleteDoc = {
    ...customDoc,
    front: customDoc.front.filter((e: any) => !e.text.includes("course}}")),
    back: customDoc.back.filter((e: any) => !e.text.includes("course}}")),
  };
  await ok(base + "templates/" + customTemplate, "PUT", {
    document: incompleteDoc,
  });
  const missingMandatory = await call(base + "cards", "POST", {
    person_id: p,
    template_id: customTemplate,
  });
  assert.equal(missingMandatory.response.status, 422);
  assert.match(missingMandatory.data.error, /mandatory but absent/);
  const imported = await ok(
    base + "imports?filename=general.csv",
    "POST",
    Buffer.from(
      "external_id,name,custom.course,custom.visitor_company,custom.access_level\nG002,Imported General,Science,Example,Office\n",
    ),
    true,
  );
  const checked = await ok(
    base + "imports/" + imported.id + "/validate",
    "POST",
    {
      mapping: Object.fromEntries(
        [
          "external_id",
          "name",
          "custom.course",
          "custom.visitor_company",
          "custom.access_level",
        ].map((k) => [k, k]),
      ),
    },
  );
  assert.equal(checked.valid, 1);
  assert.equal(checked.invalid, 0);
  await ok(base + "imports/" + imported.id + "/commit", "POST", {});
  const kit = await ok(base + "upload-templates?kind=kit&general=1"),
    files: Record<string, string> = {};
  const { zipEntries } = await import("../../src/core/imports.ts");
  await zipEntries(kit, async (n, b) => {
    files[n] = b.toString("utf8");
  });
  assert.ok(!files["people-upload-template.csv"].includes("custom.card_type"));
  assert.ok(files["people-upload-template.csv"].includes("custom.course"));
  assert.ok(files["card-field-requirements.csv"].includes("Visitor"));
});

test(
  "four card profiles share mandatory rules with forms, imports, templates and generated cards",
  { timeout: 90000 },
  async () => {
    const profileOrg = (
      await ok("orgs", "POST", { name: "Profile College", code: "PROFILES" })
    ).id;
    const base = `orgs/${profileOrg}/`;
    assert.equal(
      (await call(base + "upload-templates?kind=kit&profile=staff")).response
        .status,
      409,
    );
    const image = await sharp({
      create: { width: 100, height: 140, channels: 3, background: "#b4cbd3" },
    })
      .png()
      .toBuffer();
    const asset = (
      await ok(base + "assets?kind=SIGNATURE", "POST", image, true)
    ).id;
    const templates: Record<string, string> = {};
    const staffPolicy = defaultCardPolicy("staff");
    staffPolicy.required.push(
      "department",
      "photo",
      "authorized_signature",
      "organization_logo",
      "cardholder_signature",
    );
    staffPolicy.assets = {
      organization_logo: asset,
      authorized_signature: asset,
    };
    for (const kind of [
      "staff",
      "student",
      "visitor",
      "professional",
    ] as CardType[]) {
      const policy = kind === "staff" ? staffPolicy : defaultCardPolicy(kind);
      if (kind === "visitor") policy.required.push("valid_until");
      templates[kind] = (
        await ok(base + "card-profiles", "POST", { kind, policy })
      ).id;
      const template = await ok(base + "templates/" + templates[kind]);
      assert.equal(template.document.cardType, kind);
      assert.deepEqual(template.document.requiredFields, policy.required);
      const kit = await ok(base + `upload-templates?kind=kit&profile=${kind}`);
      const files: Record<string, string> = {};
      const { zipEntries } = await import("../../src/core/imports.ts");
      await zipEntries(kit, async (name, data) => {
        files[name] = data.toString("utf8");
      });
      assert.match(files["people-upload-template.csv"], /custom.card_type/);
      assert.match(files["card-field-requirements.csv"], /mandatory/);
      assert.ok(files["CARD-TYPE-INSTRUCTIONS.txt"].includes(kind));
    }
    const universal = await ok(base + "upload-templates?kind=kit");
    const universalFiles: Record<string, string> = {};
    const { zipEntries: readUniversal, parseSheet: parseUniversal } =
      await import("../../src/core/imports.ts");
    const { matchImportColumns } =
      await import("../../src/core/import-fields.ts");
    await readUniversal(universal, async (name, data) => {
      universalFiles[name] = data.toString("utf8");
    });
    const header = universalFiles["people-upload-template.csv"].trim();
    assert.ok(
      header.includes("custom.course") &&
        header.includes("custom.visitor_company") &&
        header.includes("custom.registration_number"),
    );
    assert.equal(
      Object.keys(universalFiles).filter((k) => k.includes("people-upload"))
        .length,
      1,
    );
    const { parse: parseHeader } = await import("csv-parse/sync");
    const columns: string[] = parseHeader(header, { bom: true })[0];
    const data: Record<string, string>[] = [
      {
        external_id: "MIX-STUDENT",
        name: "Mixed Student",
        "custom.card_type": "Student",
        "custom.course": "Science",
      },
      {
        external_id: "MIX-VISITOR",
        name: "Mixed Visitor",
        "custom.card_type": "Temporary / Visitor",
        "custom.valid_until": "2099-12-31T17:00:00+05:30",
      },
      {
        external_id: "MIX-PRO",
        name: "Mixed Professional",
        "custom.card_type": "Working Professional",
      },
    ];
    const sheet =
      header +
      "\r\n" +
      data
        .map((row) =>
          columns
            .map((k) =>
              JSON.stringify((row as Record<string, string>)[k] || ""),
            )
            .join(","),
        )
        .join("\r\n");
    const uploaded = await ok(
      base + "imports?filename=mixed.csv",
      "POST",
      Buffer.from(sheet),
      true,
    );
    const matched = matchImportColumns(columns, []);
    const checked = await ok(
      base + "imports/" + uploaded.id + "/validate",
      "POST",
      { mapping: matched },
    );
    assert.equal(checked.valid, 3);
    assert.equal(checked.invalid, 0);
    await ok(base + "imports/" + uploaded.id + "/commit", "POST", {});
    const mixed = await transaction(
      async (c) =>
        (
          await c.query(
            "SELECT custom_fields->>'card_type' AS type FROM people WHERE organization_id=$1 AND external_id LIKE 'MIX-%' ORDER BY external_id",
            [profileOrg],
          )
        ).rows,
      profileOrg,
    );
    assert.deepEqual(
      mixed.map((row) => row.type),
      ["professional", "student", "visitor"],
    );
    assert.equal(
      (
        await call(base + "people", "POST", {
          external_id: "S001",
          name: "Staff",
          custom_fields: { card_type: "staff" },
        })
      ).response.status,
      422,
    );
    assert.equal(
      (
        await call(base + "people", "POST", {
          external_id: "NOTYPE",
          name: "Missing type",
        })
      ).response.status,
      422,
    );
    const staff = (
      await ok(base + "people", "POST", {
        external_id: "S001",
        name: "Staff",
        custom_fields: {
          card_type: "staff",
          department: "Engineering",
          cardholder_signature: asset,
        },
      })
    ).id;
    assert.equal(
      (
        await call(base + "cards", "POST", {
          person_id: staff,
          template_id: templates.staff,
        })
      ).response.status,
      422,
    );
    await ok(base + "photos/" + staff, "PUT", { asset_id: asset });
    const generated = await ok(base + "cards", "POST", {
      person_id: staff,
      template_id: templates.staff,
    });
    const snapshot = await transaction(
      async (c) =>
        (
          await c.query("SELECT snapshot FROM card_renders WHERE id=$1", [
            generated.render_id,
          ])
        ).rows[0].snapshot,
      profileOrg,
    );
    assert.equal(snapshot.department, "Engineering");
    assert.equal(snapshot.authorized_signature, asset);
    assert.equal(snapshot.organization_name, "Profile College");
    assert.equal(
      (
        await call(base + "cards", "POST", {
          person_id: staff,
          template_id: templates.student,
        })
      ).response.status,
      422,
    );
    const doc = (await ok(base + "templates/" + templates.staff)).document;
    doc.front = doc.front.filter(
      (e: any) => !e.text.includes("{{department}}"),
    );
    doc.requiredFields.push("email");
    await ok(base + "templates/" + templates.staff, "PUT", { document: doc });
    const templateRequirements = await ok(
      base +
        `upload-templates?kind=requirements&template_id=${templates.staff}`,
    );
    assert.match(
      templateRequirements.toString("utf8"),
      /"Email ID","email","YES"/,
    );
    assert.equal(
      (
        await call(base + "cards", "POST", {
          person_id: staff,
          template_id: templates.staff,
        })
      ).response.status,
      422,
    );
    const batch = await ok(
      base + "imports?filename=staff.csv",
      "POST",
      Buffer.from(
        "external_id,name,custom.card_type,custom.department\nS002,Imported,staff,Engineering",
      ),
      true,
    );
    const mapping = Object.fromEntries(
      ["external_id", "name", "custom.card_type", "custom.department"].map(
        (k) => [k, k],
      ),
    );
    const validated = await ok(base + `imports/${batch.id}/validate`, "POST", {
      mapping,
    });
    assert.equal(validated.invalid, 0);
    staffPolicy.required.push("birth_date");
    await ok(base + "card-profiles", "PUT", {
      kind: "staff",
      policy: staffPolicy,
    });
    assert.equal(
      (await call(base + `imports/${batch.id}/commit`, "POST", {})).response
        .status,
      422,
    );
    const bad = await ok(
      base + "imports?filename=missing.csv",
      "POST",
      Buffer.from("external_id,name,custom.card_type\nS003,Missing,staff"),
      true,
    );
    assert.equal(
      (
        await ok(base + `imports/${bad.id}/validate`, "POST", {
          mapping: {
            external_id: "external_id",
            name: "name",
            "custom.card_type": "custom.card_type",
          },
        })
      ).invalid,
      1,
    );
    const visitor = (
      await ok(base + "people", "POST", {
        external_id: "V001",
        name: "Visitor",
        custom_fields: {
          card_type: "visitor",
          valid_until: "2026-12-31T17:00:00+05:30",
        },
      })
    ).id;
    const visitorCard = await ok(base + "cards", "POST", {
      person_id: visitor,
      template_id: templates.visitor,
    });
    assert.equal(
      (
        await call(base + "cards", "POST", {
          person_id: visitor,
          template_id: templates.visitor,
          expires_at: "2027-01-01T00:00:00Z",
        })
      ).response.status,
      422,
    );
    const expires = await transaction(
      async (c) =>
        (
          await c.query("SELECT expires_at FROM cards WHERE id=$1", [
            visitorCard.id,
          ])
        ).rows[0].expires_at,
      profileOrg,
    );
    assert.equal(new Date(expires).toISOString(), "2026-12-31T11:30:00.000Z");
    const shared = (
      await ok(base + "appearance", "POST", { shared: true, theme: "forest" })
    ).id;
    const sharedDoc = (await ok(base + "templates/" + shared)).document;
    assert.deepEqual(Object.keys(sharedDoc.variants).sort(), [
      "professional",
      "staff",
      "student",
      "visitor",
    ]);
    assert.equal(
      (await ok(base + "templates")).find((t: any) => t.id === shared)
        .card_type,
      "shared",
    );
    assert.equal(
      (await ok(base + "appearance", "POST", { shared: true })).id,
      shared,
    );
    await ok(base + "templates/" + shared, "PUT", { is_default: true });
    assert.deepEqual(Object.values((await ok(base + "appearance")).defaults), [
      shared,
      shared,
      shared,
      shared,
    ]);
    const completeStaff = await ok(base + "people/" + staff);
    await ok(base + "people/" + staff, "PUT", {
      ...completeStaff,
      custom_fields: {
        ...completeStaff.custom_fields,
        birth_date: "1990-01-01",
      },
    });
    const sharedPeople = await transaction(
      async (c) =>
        (
          await c.query(
            "SELECT id FROM people WHERE organization_id=$1 AND (external_id LIKE 'MIX-%' OR external_id='S001') ORDER BY external_id",
            [profileOrg],
          )
        ).rows.map((r) => r.id),
      profileOrg,
    );
    const mixedJob = await ok(base + "generation", "POST", {
      template_id: shared,
      person_ids: sharedPeople,
      request_key: randomUUID(),
    });
    await runGeneration(profileOrg, mixedJob.id);
    const mixedResult = await ok(base + "generation/" + mixedJob.id);
    assert.equal(
      mixedResult.status,
      "COMPLETED",
      JSON.stringify(mixedResult.items),
    );
    assert.equal(
      mixedResult.items.filter((i: any) => i.status === "DONE").length,
      4,
    );
    const frozen = await transaction(
      async (c) =>
        (
          await c.query(
            "SELECT r.snapshot FROM card_renders r JOIN generation_items i ON i.card_id=r.card_id WHERE i.job_id=$1",
            [mixedJob.id],
          )
        ).rows,
      profileOrg,
    );
    assert.deepEqual(frozen.map((r) => r.snapshot.card_type).sort(), [
      "professional",
      "staff",
      "student",
      "visitor",
    ]);
    const sharedPreview = await call(base + "preview", "POST", {
      document: sharedDoc,
      person_id: visitor,
      side: "back",
    });
    assert.equal(sharedPreview.response.status, 200);
    const foreignOrg = (
      await ok("orgs", "POST", {
        name: "Foreign profile images",
        code: "PROFFOREIGN",
      })
    ).id;
    const foreignAsset = (
      await ok(`orgs/${foreignOrg}/assets?kind=SIGNATURE`, "POST", image, true)
    ).id;
    assert.equal(
      (
        await call(base + "card-profiles", "PUT", {
          kind: "staff",
          policy: {
            ...staffPolicy,
            assets: { authorized_signature: foreignAsset },
          },
        })
      ).response.status,
      400,
    );
  },
);
async function call(
  route: string,
  method = "GET",
  body?: unknown,
  raw = false,
  session = { cookie, csrf },
) {
  const headers: Record<string, string> = {
    origin,
    cookie: session.cookie,
    "x-csrf-token": session.csrf,
  };
  if (!raw) headers["Content-Type"] = "application/json";
  const response = await handle(
    new Request(origin + "/api/" + route, {
      method,
      headers,
      body:
        body === undefined
          ? undefined
          : raw
            ? (body as BodyInit)
            : JSON.stringify(body),
    }),
    route.split("?")[0].split("/"),
  );
  const data = response.headers
    .get("content-type")
    ?.includes("application/json")
    ? await response.json()
    : Buffer.from(await response.arrayBuffer());
  return { response, data };
}
async function ok(route: string, method = "GET", body?: unknown, raw = false) {
  const r = await call(route, method, body, raw);
  assert.ok(r.response.ok, JSON.stringify(r.data));
  return r.data;
}
before(async () => {
  await mkdir(root, { recursive: true });
  postgres = new EmbeddedPostgres({
    databaseDir: path.join(root, "postgres"),
    port: Number(process.env.IDCARD_TEST_PG_PORT || 55432),
    user: "postgres",
    password,
    persistent: true,
    authMethod: "scram-sha-256",
    onLog: () => {},
    onError: () => {},
  });
  await postgres.initialise();
  await postgres.start();
  const admin = postgres.getPgClient();
  await admin.connect();
  await admin.query(
    `CREATE ROLE idcard_test LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`,
  );
  await admin.query("CREATE DATABASE idcard_test OWNER idcard_test");
  await admin.end();
  process.env.DATABASE_URL = `postgresql://idcard_test:${password}@localhost:${process.env.IDCARD_TEST_PG_PORT || 55432}/idcard_test`;
  process.env.STORAGE_ROOT = path.join(root, "assets");
  process.env.APP_ORIGIN = origin;
  await migrate();
  await migrate();
  await db().query(
    "INSERT INTO users(id,email,password_hash,super_admin,must_change_password) VALUES($1,$2,$3,true,false)",
    [randomUUID(), adminEmail, await argon2.hash(adminPassword)],
  );
  const r = await call("auth/login", "POST", {
    email: adminEmail,
    password: adminPassword,
  });
  assert.equal(r.response.status, 200);
  cookie = r.response.headers.get("set-cookie")!.split(";")[0];
  csrf = r.data.csrf;
});
after(async () => {
  server?.kill();
  worker?.kill();
  await closeDb();
  if (postgres) await postgres.stop();
});
test("initial admin bootstrap is one-time, hashes a random password and requires first-login change", async () => {
  assert.deepEqual(await bootstrapAdmin(), { created: false });
  await transaction(async (c) => {
    await c.query(
      "CREATE TEMP TABLE users (LIKE public.users INCLUDING ALL) ON COMMIT DROP",
    );
    const first = await bootstrapAdminInTransaction(c);
    assert.equal(first.created, true);
    if (!first.created)
      throw new Error("Initial administrator was not created");
    assert.equal(first.email, initialAdminEmail);
    assert.ok(first.password.length >= 26);
    const user = (await c.query("SELECT * FROM users")).rows[0];
    assert.equal(user.super_admin, true);
    assert.equal(user.must_change_password, true);
    assert.notEqual(user.password_hash, first.password);
    assert.equal(await argon2.verify(user.password_hash, first.password), true);
    assert.deepEqual(
      await bootstrapAdminInTransaction(c, "another@example.test"),
      { created: false },
    );
    assert.equal(
      (await c.query("SELECT count(*) FROM users")).rows[0].count,
      "1",
    );
  });
});

test("PostgreSQL 16 migrations are idempotent and application role cannot bypass RLS", async () => {
  assert.equal((await call("health/ready")).response.status, 503);
  assert.match(
    (await db().query("SHOW server_version")).rows[0].server_version,
    /^16\./,
  );
  const role = (
    await db().query(
      "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
    )
  ).rows[0];
  assert.equal(role.rolsuper, false);
  assert.equal(role.rolbypassrls, false);
  assert.equal(
    (await db().query("SELECT * FROM schema_migrations")).rowCount,
    10,
  );
});
test("create two organizations and a scoped custom-field person", async () => {
  org = (await ok("orgs", "POST", { name: "Test Organization", code: "TEST" }))
    .id;
  otherOrg = (
    await ok("orgs", "POST", { name: "Other Organization", code: "OTHER" })
  ).id;
  await ok(`orgs/${org}/fields`, "POST", {
    key: "grade",
    label: "Grade",
    type: "number",
    private: false,
  });
  const unit = (
    await ok(`orgs/${org}/units`, "POST", {
      name: "Engineering",
      code: "ENG",
      kind: "DEPARTMENT",
    })
  ).id;
  person = (
    await ok(`orgs/${org}/people`, "POST", {
      name: "Anita Rao",
      external_id: "EMP001",
      email: "anita@example.test",
      custom_fields: { grade: 4 },
      unit_ids: [unit],
    })
  ).id;
  assert.equal((await ok(`orgs/${org}/people?q=Anita`)).total, 1);
  assert.equal((await ok(`orgs/${otherOrg}/people`)).total, 0);
});
test("RLS blocks unscoped reads, cross-tenant writes and cross-tenant unit references", async () => {
  assert.equal((await db().query("SELECT * FROM people")).rowCount, 0);
  await assert.rejects(
    transaction(async (c) => {
      await c.query(
        "INSERT INTO people(id,organization_id,external_id,name) VALUES($1,$2,$3,$4)",
        [randomUUID(), otherOrg, "bad", "bad"],
      );
    }, org),
    /row-level security/,
  );
  const foreignUnit = (
    await ok(`orgs/${otherOrg}/units`, "POST", {
      name: "Other",
      code: "O",
      kind: "BRANCH",
    })
  ).id;
  const r = await call(`orgs/${org}/people`, "POST", {
    name: "Invalid reference",
    external_id: "BAD",
    unit_ids: [foreignUnit],
  });
  assert.equal(r.response.status, 400);
});
test("session requires CSRF and matching Origin on writes", async () => {
  const r = await call(
    "orgs",
    "POST",
    { name: "Unsafe", code: "UNSAFE" },
    false,
    { cookie, csrf: "wrong" },
  );
  assert.equal(r.response.status, 403);
  const response = await handle(
    new Request(origin + "/api/orgs", {
      method: "POST",
      headers: {
        cookie,
        origin: "https://attacker.example",
        "x-csrf-token": csrf,
      },
      body: "{}",
    }),
    ["orgs"],
  );
  assert.equal(response.status, 403);
});
test("Viewer cannot mutate records or enter another tenant", async () => {
  const pw = randomBytes(20).toString("hex");
  await ok(`orgs/${org}/members`, "POST", {
    email: "viewer@example.test",
    password: pw,
    role: "VIEWER",
  });
  await db().query(
    "UPDATE users SET must_change_password=false WHERE email='viewer@example.test'",
  );
  const signed = await call("auth/login", "POST", {
    email: "viewer@example.test",
    password: pw,
  });
  const s = {
    cookie: signed.response.headers.get("set-cookie")!.split(";")[0],
    csrf: signed.data.csrf,
  };
  assert.equal(
    (await call(`orgs/${org}/recycle-bin`, "GET", undefined, false, s)).response
      .status,
    403,
  );
  assert.equal(
    (
      await call(
        `orgs/${org}/recycle-bin`,
        "POST",
        { action: "preview", kind: "people", all: true },
        false,
        s,
      )
    ).response.status,
    403,
  );
  assert.equal(
    (
      await call(
        `orgs/${org}/bulk-records`,
        "POST",
        { kind: "people", action: "delete", ids: [person] },
        false,
        s,
      )
    ).response.status,
    403,
  );
  assert.equal(
    (await call(`orgs/${org}/assets?deleted=only`, "GET", undefined, false, s))
      .response.status,
    403,
  );
  assert.equal(
    (await call(`orgs/${org}/people/${person}`, "DELETE", undefined, false, s))
      .response.status,
    403,
  );
  assert.equal(
    (await call(`orgs/${org}/people/${person}/restore`, "POST", {}, false, s))
      .response.status,
    403,
  );
  assert.equal(
    (await call(`orgs/${org}/people?deleted=only`, "GET", undefined, false, s))
      .response.status,
    403,
  );
  assert.equal(
    (await call(`orgs/${org}/photo-matches`, "POST", {}, false, s)).response
      .status,
    403,
  );
  assert.equal(
    (await call(`orgs/${org}/people`, "GET", undefined, false, s)).response
      .status,
    200,
  );
  assert.equal(
    (
      await call(
        `orgs/${org}/people`,
        "POST",
        { name: "No", external_id: "NO" },
        false,
        s,
      )
    ).response.status,
    403,
  );
  assert.equal(
    (await call(`orgs/${otherOrg}/people`, "GET", undefined, false, s)).response
      .status,
    403,
  );
  assert.equal(
    (
      await call(
        `orgs/${org}/card-profiles`,
        "PUT",
        { kind: "staff", policy: defaultCardPolicy("staff") },
        false,
        s,
      )
    ).response.status,
    403,
  );
  assert.equal(
    (await call(`orgs/${org}/appearance`, "PUT", {}, false, s)).response.status,
    403,
  );
  assert.equal(
    (await call(`orgs/${org}/forms`, "GET", undefined, false, s)).response
      .status,
    403,
  );
  assert.equal(
    (await call(`orgs/${org}/forms`, "POST", {}, false, s)).response.status,
    403,
  );
  assert.equal(
    (await call(`orgs/${org}/time-settings`, "GET", undefined, false, s))
      .response.status,
    200,
  );
  assert.equal(
    (
      await call(
        `orgs/${org}/time-settings`,
        "PUT",
        { timeZone: "UTC", hour12: false },
        false,
        s,
      )
    ).response.status,
    403,
  );
  assert.equal(
    (await call(`branding?org=${org}`, "PUT", { name: "Forbidden" }, false, s))
      .response.status,
    403,
  );
  assert.equal(
    (await call(`orgs/${otherOrg}/card-profiles`, "GET", undefined, false, s))
      .response.status,
    403,
  );
  assert.equal(
    (
      await call(
        `orgs/${org}/upload-templates?kind=photos`,
        "GET",
        undefined,
        false,
        s,
      )
    ).response.status,
    403,
  );
});
test("shareable profession forms keep submissions private and review into General people", async () => {
  const formOrg = (
      await ok("orgs", "POST", { name: "Practice Forms", code: "PRACTICE" })
    ).id,
    base = `orgs/${formOrg}/`;
  await ok(base + "card-profiles", "PUT", {
    kind: "staff",
    policy: {
      general: true,
      shown: ["name", "external_id", "photo", "registration_number"],
      required: ["name", "external_id"],
      assets: {},
    },
  });
  const { collectionFields } =
    await import("../../src/core/collection-schema.ts");
  const fields = [
    ...collectionFields
      .filter((f) =>
        [
          "name",
          "external_id",
          "photo",
          "email",
          "registration_number",
        ].includes(f.key),
      )
      .map((f) => (f.key === "photo" ? { ...f, required: true } : f)),
    {
      key: "practice_name",
      label: "Practice name",
      type: "text",
      required: true,
      options: [],
    },
    {
      key: "specialty",
      label: "Specialty",
      type: "select",
      required: true,
      options: ["Dental", "General"],
    },
  ];
  const form = await ok(base + "forms", "POST", {
    title: "Practice registration",
    profession: "Doctor",
    description: "Clinic ID details",
    fields,
    active: true,
  });
  const route = `collect/${formOrg}/${form.public_key}`,
    anonymous = { cookie: "", csrf: "" };
  const info = await call(route, "GET", undefined, false, anonymous);
  assert.equal(info.response.status, 200);
  assert.equal(info.data.organization_name, "Practice Forms");
  assert.equal(info.data.public_key, undefined);
  assert.equal(info.data.submissions, undefined);
  assert.equal(
    (await call(`orgs/${formOrg}/forms`, "GET", undefined, false, anonymous))
      .response.status,
    401,
  );
  assert.equal(
    (
      await call(
        `collect/${otherOrg}/${form.public_key}`,
        "GET",
        undefined,
        false,
        anonymous,
      )
    ).response.status,
    404,
  );
  assert.equal(
    (await db().query("SELECT * FROM collection_forms")).rowCount,
    0,
  );
  const image = (
    await sharp({
      create: { width: 120, height: 160, channels: 3, background: "#aaccdd" },
    })
      .png()
      .toBuffer()
  ).toString("base64");
  const body = {
    version: form.version,
    values: {
      name: "Doctor Example",
      external_id: "DOC001",
      email: "doctor@example.test",
      registration_number: "REG001",
      practice_name: "City Clinic",
      specialty: "Dental",
    },
    images: { photo: image },
    consent: true,
  };
  assert.equal(
    (await call(route, "POST", { ...body, consent: false }, false, anonymous))
      .response.status,
    400,
  );
  assert.equal(
    (await call(route, "POST", { ...body, images: {} }, false, anonymous))
      .response.status,
    400,
  );
  assert.equal(
    (
      await call(
        route,
        "POST",
        { ...body, values: { ...body.values, specialty: "Invalid" } },
        false,
        anonymous,
      )
    ).response.status,
    400,
  );
  assert.equal(
    (
      await call(
        route,
        "POST",
        { ...body, images: { authorized_signature: image } },
        false,
        anonymous,
      )
    ).response.status,
    400,
  );
  const badOrigin = await handle(
    new Request(origin + "/api/" + route, {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    route.split("/"),
  );
  assert.equal(badOrigin.status, 403);
  const submitted = await call(route, "POST", body, false, anonymous);
  assert.equal(submitted.response.status, 201);
  assert.equal((await ok(base + "people?q=DOC001")).total, 0);
  const inbox = await ok(base + `forms/${form.id}/submissions`);
  assert.equal(inbox.total, 1);
  assert.equal(inbox.items[0].definition.profession, "Doctor");
  const uploaded = inbox.items[0].assets.photo;
  await transaction(async (c) => {
    assert.equal(
      (await c.query("SELECT id FROM assets WHERE id=$1", [uploaded])).rowCount,
      0,
    );
  }, formOrg);
  assert.equal(
    (
      await call(
        base + `assets/${uploaded}`,
        "GET",
        undefined,
        false,
        anonymous,
      )
    ).response.status,
    401,
  );
  assert.equal(
    (await db().query("SELECT * FROM collection_submissions")).rowCount,
    0,
  );
  const updated = await ok(base + `forms/${form.id}`, "PUT", {
    ...form,
    title: "Practice registration updated",
    fields: fields.map((f) =>
      f.key === "practice_name" ? { ...f, label: "Clinic name" } : f,
    ),
  });
  assert.equal(
    (await call(route, "POST", body, false, anonymous)).response.status,
    409,
  );
  const approved = await ok(
    base + `forms/${form.id}/submissions/${submitted.data.reference}`,
    "POST",
    { action: "approve", values: { ...body.values, name: "Dr Example" } },
  );
  const person = await ok(base + `people/${approved.person_id}`);
  assert.equal(person.name, "Dr Example");
  assert.equal(person.photo_asset_id, uploaded);
  assert.equal(person.custom_fields.practice_name, "City Clinic");
  assert.equal(person.custom_fields.card_type, "staff");
  await transaction(async (c) => {
    assert.equal(
      (await c.query("SELECT id FROM assets WHERE id=$1", [uploaded])).rowCount,
      1,
    );
  }, formOrg);
  const reviewed = (
    await ok(base + `forms/${form.id}/submissions?status=APPROVED`)
  ).items[0];
  assert.equal(reviewed.definition.submitted_values.name, "Doctor Example");
  assert.equal(reviewed.values.name, "Dr Example");
  const cardTemplate = await ok(base + "appearance", "POST", {
    shared: true,
    general: true,
  });
  const collectedCard = await ok(base + "cards", "POST", {
    person_id: approved.person_id,
    template_id: cardTemplate.id,
  });
  assert.ok(collectedCard.render_id);
  assert.equal(
    (
      await call(
        base + `forms/${form.id}/submissions/${submitted.data.reference}`,
        "POST",
        { action: "approve" },
      )
    ).response.status,
    409,
  );
  const duplicate = await call(
    route,
    "POST",
    { ...body, version: updated.version },
    false,
    anonymous,
  );
  assert.equal(duplicate.response.status, 201);
  assert.equal(
    (
      await call(
        base + `forms/${form.id}/submissions/${duplicate.data.reference}`,
        "POST",
        { action: "approve" },
      )
    ).response.status,
    409,
  );
  assert.equal(
    (await ok(base + `forms/${form.id}/submissions`)).items[0].status,
    "PENDING",
  );
  await ok(
    base + `forms/${form.id}/submissions/${duplicate.data.reference}`,
    "POST",
    { action: "reject" },
  );
  assert.equal(
    (await ok(base + `forms/${form.id}/submissions?status=REJECTED`)).total,
    1,
  );
  const rotated = await ok(base + `forms/${form.id}/rotate-link`, "POST", {});
  assert.equal(
    (await call(route, "GET", undefined, false, anonymous)).response.status,
    404,
  );
  const newRoute = `collect/${formOrg}/${rotated.public_key}`;
  assert.equal(
    (await call(newRoute, "GET", undefined, false, anonymous)).response.status,
    200,
  );
  await ok(base + `forms/${form.id}`, "PUT", { ...rotated, active: false });
  assert.equal(
    (await call(newRoute, "GET", undefined, false, anonymous)).response.status,
    404,
  );
  assert.equal(
    (
      await call(base + `forms/${form.id}`, "PUT", {
        ...rotated,
        active: true,
        closes_at: "2020-01-01T00:00:00Z",
      })
    ).response.status,
    400,
  );
  const expired = await ok(base + `forms/${form.id}`, "PUT", {
    ...rotated,
    active: false,
    closes_at: "2020-01-01T00:00:00Z",
  });
  assert.equal(
    (
      await call(
        newRoute,
        "POST",
        { ...body, version: expired.version },
        false,
        anonymous,
      )
    ).response.status,
    404,
  );
});

test("organization time controls deadlines and datetime answers without changing scheduled instants", async () => {
  const timeOrg = (
      await ok("orgs", "POST", { name: "Time rules", code: "TIMEFIX" })
    ).id,
    base = `orgs/${timeOrg}/`,
    year = new Date().getUTCFullYear() + 1;
  const initial = await ok(base + "time-settings");
  assert.equal(initial.timeZone, "Asia/Kolkata");
  assert.ok(initial.serverNow);
  assert.ok(initial.zones.includes("UTC"));
  assert.equal(
    (await call(base + "time-settings", "PUT", { timeZone: "Asia/Fake" }))
      .response.status,
    400,
  );
  await ok(base + "time-settings", "PUT", { timeZone: "UTC", hour12: false });
  const prefs = await ok(base + "appearance");
  assert.equal(prefs.time.timeZone, "UTC");
  assert.equal(prefs.defaultTheme, "paper");
  await ok(base + "appearance", "PUT", {
    ...prefs,
    time: { timeZone: "Asia/Kolkata", hour12: true },
  });
  assert.equal((await ok(base + "time-settings")).timeZone, "UTC");
  await ok(base + "time-settings", "PUT", {
    timeZone: "Asia/Kolkata",
    hour12: true,
  });
  const { collectionFields } =
    await import("../../src/core/collection-schema.ts");
  const fields = collectionFields.filter((f) =>
    ["name", "external_id", "valid_until"].includes(f.key),
  );
  const definition = {
    title: "Time test",
    profession: "Custom",
    fields,
    active: true,
  };
  const form = await ok(base + "forms", "POST", {
    ...definition,
    closes_local: `${year}-10-20T14:50`,
    editing_time_zone: "Asia/Kolkata",
  });
  assert.equal(form.closes_at, `${year}-10-20T09:20:00.000Z`);
  assert.equal(form.closes_local, `${year}-10-20T14:50`);
  assert.equal(
    (
      await call(base + "forms", "POST", {
        ...definition,
        closes_local: "2000-01-01T02:50",
        editing_time_zone: "Asia/Kolkata",
      })
    ).response.status,
    400,
  );
  await ok(base + "time-settings", "PUT", {
    timeZone: "America/New_York",
    hour12: true,
  });
  const changed = await ok(base + `forms/${form.id}`);
  assert.equal(changed.closes_at, form.closes_at);
  assert.equal(changed.closes_local, `${year}-10-20T05:20`);
  assert.equal(
    (
      await call(base + `forms/${form.id}`, "PUT", {
        ...definition,
        closes_local: `${year}-10-20T14:50`,
        editing_time_zone: "Asia/Kolkata",
      })
    ).response.status,
    409,
  );
  const route = `collect/${timeOrg}/${form.public_key}`,
    anonymous = { cookie: "", csrf: "" };
  const publicInfo = await call(route, "GET", undefined, false, anonymous);
  assert.equal(publicInfo.data.timeZone, "America/New_York");
  const body = {
    version: form.version,
    consent: true,
    values: {
      name: "Clock Person",
      external_id: "CLOCK001",
      valid_until: `${year}-10-20T14:50`,
    },
    time_zone: "Asia/Kolkata",
  };
  assert.equal(
    (await call(route, "POST", body, false, anonymous)).response.status,
    409,
  );
  const submitted = await call(
    route,
    "POST",
    { ...body, time_zone: "America/New_York" },
    false,
    anonymous,
  );
  assert.equal(submitted.response.status, 201);
  const inbox = (await ok(base + `forms/${form.id}/submissions`)).items[0];
  assert.equal(inbox.values.valid_until, `${year}-10-20T18:50:00.000Z`);
  assert.equal(inbox.definition.time_zone, "America/New_York");
  assert.equal(
    (
      await call(base + `forms/${form.id}/submissions/${inbox.id}`, "POST", {
        action: "approve",
        values: body.values,
        time_zone: "Asia/Kolkata",
      })
    ).response.status,
    409,
  );
  const approved = await ok(
    base + `forms/${form.id}/submissions/${inbox.id}`,
    "POST",
    { action: "approve", values: body.values, time_zone: "America/New_York" },
  );
  assert.equal(
    (await ok(base + `people/${approved.person_id}`)).custom_fields.valid_until,
    `${year}-10-20T18:50:00.000Z`,
  );
  // Seed an expired active fixture to exercise automatic closure and reopening.
  await transaction(
    (c) =>
      c.query(
        "UPDATE collection_forms SET closes_at=now()-interval '1 second' WHERE organization_id=$1 AND id=$2",
        [timeOrg, form.id],
      ),
    timeOrg,
  );
  assert.equal(
    (await call(route, "GET", undefined, false, anonymous)).response.status,
    404,
  );
  assert.equal((await ok(base + `forms/${form.id}`)).expired, true);
  await ok(base + `forms/${form.id}`, "PUT", {
    ...definition,
    closes_local: "",
    editing_time_zone: "America/New_York",
  });
  assert.equal(
    (await call(route, "GET", undefined, false, anonymous)).response.status,
    200,
  );
});

test("CSV import validates duplicate IDs, reports errors and commits valid batches once", async () => {
  const batch = await ok(
    `orgs/${org}/imports?filename=bad.csv`,
    "POST",
    Buffer.from(
      "external_id,name\nEMP001,Existing\nEMP002,New\nEMP002,Duplicate",
    ),
    true,
  );
  const check = await ok(`orgs/${org}/imports/${batch.id}/validate`, "POST", {
    mapping: { external_id: "external_id", name: "name" },
  });
  assert.equal(check.invalid, 2);
  assert.equal(
    (await call(`orgs/${org}/imports/${batch.id}/commit`, "POST", {})).response
      .status,
    409,
  );
  assert.match(
    (await ok(`orgs/${org}/imports/${batch.id}?report=csv`)).toString(),
    /Duplicate/,
  );
  const good = await ok(
    `orgs/${org}/imports?filename=good.csv`,
    "POST",
    Buffer.from("external_id,name\nEMP002,Person Two\nEMP003,Person Three"),
    true,
  );
  await ok(`orgs/${org}/imports/${good.id}/validate`, "POST", {
    mapping: { external_id: "external_id", name: "name" },
  });
  assert.equal(
    (await ok(`orgs/${org}/imports/${good.id}/commit`, "POST", {})).imported,
    2,
  );
  assert.equal(
    (await call(`orgs/${org}/imports/${good.id}/commit`, "POST", {})).response
      .status,
    409,
  );
});
test("photos upload, thumbnail and match; assets stay inside tenant", async () => {
  const bytes = await sharp({
    create: { width: 120, height: 160, channels: 3, background: "#a7c8d0" },
  })
    .png()
    .toBuffer();
  photo = (await ok(`orgs/${org}/assets`, "POST", bytes, true)).id;
  await ok(`orgs/${org}/photos/${person}`, "PUT", { asset_id: photo });
  assert.equal(
    (await ok(`orgs/${org}/people/${person}`)).photo_asset_id,
    photo,
  );
  const thumb = await ok(`orgs/${org}/assets/${photo}?thumb=1`);
  assert.equal(
    (await call(`orgs/${org}/assets/${photo}?thumb=1`)).response.headers.get(
      "content-type",
    ),
    "image/jpeg",
  );
  assert.ok((await sharp(thumb).metadata()).width! <= 240);
  const framed = await call(`orgs/${org}/assets/${photo}?face=1&w=150&h=180`);
  assert.equal(framed.response.status, 200);
  assert.equal(
    framed.response.headers.get("cache-control"),
    "private, no-store",
  );
  const framedMeta = await sharp(
    await ok(`orgs/${org}/assets/${photo}?face=1&w=150&h=180`),
  ).metadata();
  assert.equal(framedMeta.width, 150);
  assert.equal(framedMeta.height, 180);
  assert.equal(
    (await call(`orgs/${org}/assets/${photo}?face=1&w=601&h=180`)).response
      .status,
    400,
  );
  assert.equal(
    (await call(`orgs/${otherOrg}/assets/${photo}?face=1&w=150&h=180`)).response
      .status,
    404,
  );
  assert.equal(
    (await call(`orgs/${otherOrg}/assets/${photo}`)).response.status,
    404,
  );
});
test("automatic filename matching and crops preserve the original asset", async () => {
  const bytes = await sharp({
    create: { width: 100, height: 120, channels: 3, background: "#ddaa88" },
  })
    .png()
    .toBuffer();
  const uploaded = await ok(
    `orgs/${org}/assets?filename=EMP002.png`,
    "POST",
    bytes,
    true,
  );
  assert.equal(uploaded.matched, true);
  const cropped = await ok(`orgs/${org}/assets/${uploaded.id}/crop`, "POST", {
    left: 10,
    top: 10,
    width: 50,
    height: 60,
  });
  assert.equal(cropped.width, 50);
  assert.equal(cropped.height, 60);
  assert.equal(
    (await sharp(await ok(`orgs/${org}/assets/${uploaded.id}`)).metadata())
      .width,
    100,
  );
  assert.equal(
    (
      await call(`orgs/${org}/assets/${uploaded.id}/crop`, "POST", {
        left: 90,
        top: 0,
        width: 50,
        height: 60,
      })
    ).response.status,
    422,
  );
});
test("photo ZIP matches by ID and spreadsheet error reports are valid workbooks", async () => {
  const image = await sharp({
    create: { width: 90, height: 120, channels: 3, background: "#88aacc" },
  })
    .png()
    .toBuffer();
  const upload = await ok(
    `orgs/${org}/photos?match=external_id`,
    "POST",
    zipFile("EMP003.png", image),
    true,
  );
  assert.equal(upload.results[0].matched, true);
  const bad = await ok(
    `orgs/${org}/imports?filename=errors.csv`,
    "POST",
    Buffer.from("external_id,name\nEMP001,Duplicate"),
    true,
  );
  await ok(`orgs/${org}/imports/${bad.id}/validate`, "POST", {
    mapping: { external_id: "external_id", name: "name" },
  });
  const report = await ok(`orgs/${org}/imports/${bad.id}?report=xlsx`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(report);
  assert.equal(workbook.worksheets[0].getCell("A2").value, 2);
  assert.match(workbook.worksheets[0].getCell("C2").text, /already exists/);
});
test("bulk photo matching previews normalized IDs, protects private photos and preserves existing assignments", async () => {
  const bulkOrg = (
    await ok("orgs", "POST", { name: "Bulk photo matching", code: "BULKPHOTO" })
  ).id;
  const base = `orgs/${bulkOrg}/`;
  const p1 = (
    await ok(base + "people", "POST", {
      name: "Bulk One",
      external_id: "BULK_1",
    })
  ).id;
  const p2 = (
    await ok(base + "people", "POST", {
      name: "Bulk Two",
      external_id: "BULK_2",
    })
  ).id;
  const p3 = (
    await ok(base + "people", "POST", {
      name: "Bulk Three",
      external_id: "BULK_3",
    })
  ).id;
  const image = await readFile("tests/fixtures/portrait.jpg");
  const a1 = (
    await ok(base + "assets?filename=BULK_%201.jpg", "POST", image, true)
  ).id;
  await ok(base + "assets?filename=BULK_%201.jpg", "POST", image, true);
  const privatePhoto = (
    await ok(base + "assets?filename=BULK_%202.jpg", "POST", image, true)
  ).id;
  await transaction(async (c) => {
    const admin = (
      await c.query("SELECT id FROM users WHERE email=$1", [adminEmail])
    ).rows[0];
    await c.query("SELECT set_config('app.actor_id',$1,true)", [admin.id]);
    await c.query("UPDATE assets SET collection_private=true WHERE id=$1", [
      privatePhoto,
    ]);
  }, bulkOrg);
  const existing = (
    await ok(base + "assets?filename=unmatched.jpg", "POST", image, true)
  ).id;
  await ok(base + "photos/" + p3, "PUT", { asset_id: existing });
  await ok(base + "assets?filename=BULK_%203.jpg", "POST", image, true);
  assert.equal(
    (await ok(base + "photo-matches", "POST", { ignore_spaces: false })).ready,
    0,
  );
  const preview = await ok(base + "photo-matches", "POST", {});
  assert.equal(preview.ready, 1);
  assert.equal(
    preview.items.some((i: any) => i.asset_id === privatePhoto),
    false,
  );
  assert.equal(
    (
      await call(base + "photo-matches", "POST", {
        action: "apply",
        preview_token: "0".repeat(64),
      })
    ).response.status,
    409,
  );
  const applied = await ok(base + "photo-matches", "POST", {
    action: "apply",
    preview_token: preview.preview_token,
  });
  assert.equal(applied.matched, 1);
  assert.ok((await ok(base + "people/" + p1)).photo_asset_id);
  assert.equal((await ok(base + "people/" + p2)).photo_asset_id, null);
  assert.equal((await ok(base + "people/" + p3)).photo_asset_id, existing);
  assert.equal(
    (
      await call(base + "photo-matches", "POST", {
        action: "apply",
        preview_token: preview.preview_token,
      })
    ).response.status,
    409,
  );
  assert.equal((await ok(base + "photo-matches", "POST", {})).ready, 0);
});
test("admin person deletion is restorable, hides generation candidates and disables card verification while keeping history", async () => {
  const deleteOrg = (
      await ok("orgs", "POST", { name: "Deleted people", code: "DELETEPEOPLE" })
    ).id,
    base = `orgs/${deleteOrg}/`;
  const personId = (
    await ok(base + "people", "POST", {
      name: "Delete example",
      external_id: "DELETE_1",
    })
  ).id;
  const photo = (
    await ok(
      base + "assets?filename=DELETE_1.jpg",
      "POST",
      await readFile("tests/fixtures/portrait.jpg"),
      true,
    )
  ).id;
  const document = templateSchema.parse({
    schemaVersion: 1,
    width: 85.6,
    height: 54,
    front: [
      {
        id: randomUUID(),
        type: "text",
        x: 4,
        y: 4,
        width: 65,
        height: 10,
        text: "{{name}}",
      },
    ],
    back: [],
  });
  const templateId = (
    await ok(base + "templates", "POST", { name: "Delete test card", document })
  ).id;
  const generated = await ok(base + "cards", "POST", {
    person_id: personId,
    template_id: templateId,
  });
  await ok(base + `cards/${generated.id}/state`, "POST", { status: "ACTIVE" });
  const snapshot = await transaction(
    async (c) =>
      (
        await c.query("SELECT snapshot FROM card_renders WHERE id=$1", [
          generated.render_id,
        ])
      ).rows[0].snapshot,
    deleteOrg,
  );
  const token = snapshot["card.verify_url"].split("/").pop();
  assert.equal((await ok("verify/" + token)).valid, true);
  await ok(base + "people/" + personId, "DELETE");
  assert.equal((await ok(base + "people")).total, 0);
  assert.equal((await call(base + "people/" + personId)).response.status, 404);
  assert.equal((await ok(base + "people?deleted=only")).total, 1);
  assert.equal((await ok("verify/" + token)).valid, false);
  assert.equal(
    (
      await call(base + "cards", "POST", {
        person_id: personId,
        template_id: templateId,
      })
    ).response.status,
    404,
  );
  assert.equal(
    (
      await call(base + "generation", "POST", {
        person_ids: [personId],
        template_id: templateId,
        request_key: randomUUID(),
      })
    ).response.status,
    404,
  );
  assert.equal((await ok(base + "photo-matches", "POST", {})).ready, 0);
  assert.equal(
    (await call(`orgs/${otherOrg}/people/${personId}`, "DELETE")).response
      .status,
    404,
  );
  await ok(base + `people/${personId}/restore`, "POST", {});
  assert.equal((await ok(base + "people")).total, 1);
  assert.equal((await ok(base + "people/" + personId)).photo_asset_id, photo);
  assert.equal((await ok("verify/" + token)).valid, true);
  assert.equal((await ok(base + "people?deleted=only")).total, 0);
  assert.equal(
    await transaction(
      async (c) =>
        (
          await c.query(
            "SELECT count(*)::int AS n FROM card_renders WHERE id=$1",
            [generated.render_id],
          )
        ).rows[0].n,
      deleteOrg,
    ),
    1,
  );
});
test("numbering settings reject a backwards sequence and missing uniqueness token", async () => {
  assert.equal(
    (
      await call(`orgs/${org}/numbering`, "PUT", {
        prefix: "TEST",
        pattern: "{{year}}",
        padding: 6,
        start: 1,
      })
    ).response.status,
    400,
  );
  await ok(`orgs/${org}/numbering`, "PUT", {
    prefix: "TEST",
    pattern: "{{prefix}}-{{year}}-{{seq}}",
    padding: 6,
    start: 1,
  });
});
test("recycle purge requires an unchanged admin preview and removes only previewed linked data", async () => {
  const recycleOrg = (
    await ok("orgs", "POST", { name: "Recycle test", code: "RECYCLE" })
  ).id;
  const base = `orgs/${recycleOrg}/`;
  const p = (
    await ok(base + "people", "POST", {
      name: "Purge example",
      external_id: "RECYCLE_1",
    })
  ).id;
  const survivor = (
    await ok(base + "people", "POST", {
      name: "Keep example",
      external_id: "RECYCLE_KEEP",
    })
  ).id;
  const doc = templateSchema.parse({
    schemaVersion: 1,
    width: 85.6,
    height: 54,
    front: [
      {
        id: randomUUID(),
        type: "text",
        x: 4,
        y: 4,
        width: 60,
        height: 10,
        text: "{{name}}",
      },
    ],
    back: [],
  });
  const t = (
    await ok(base + "templates", "POST", {
      name: "Recycle template",
      document: doc,
    })
  ).id;
  const first = await ok(base + "cards", "POST", {
    person_id: p,
    template_id: t,
  });
  const keep = await ok(base + "cards", "POST", {
    person_id: survivor,
    template_id: t,
  });
  const exp = await ok(base + "exports", "POST", {
    render_ids: [first.render_id, keep.render_id],
    options: { format: "png" },
    request_key: randomUUID(),
  });
  await runExport(recycleOrg, exp.id);
  await assert.rejects(
    transaction(
      (c) => c.query("DELETE FROM cards WHERE id=$1", [first.id]),
      recycleOrg,
    ),
    /immutable/,
  );
  await assert.rejects(
    transaction(
      (c) => c.query("DELETE FROM card_events WHERE card_id=$1", [first.id]),
      recycleOrg,
    ),
    /immutable/,
  );
  assert.equal(
    (
      await call(base + "recycle-bin", "POST", {
        action: "preview",
        kind: "people",
        ids: [p],
      })
    ).response.status,
    409,
  );
  await ok(base + "bulk-records", "POST", {
    kind: "people",
    action: "delete",
    ids: [p],
  });
  assert.equal((await ok(base + "recycle-bin")).total, 1);
  let preview = await ok(base + "recycle-bin", "POST", {
    action: "preview",
    kind: "people",
    ids: [p],
  });
  assert.equal(preview.summary.people, 1);
  assert.equal(preview.summary.cards, 1);
  assert.equal(preview.summary.exportJobs, 1);
  assert.equal(
    (
      await call(`orgs/${otherOrg}/recycle-bin`, "POST", {
        action: "preview",
        kind: "people",
        ids: [p],
      })
    ).response.status,
    409,
  );
  assert.equal(
    (
      await call(base + "recycle-bin", "POST", {
        action: "confirm",
        id: preview.id,
        confirmation: "yes",
      })
    ).response.status,
    400,
  );
  assert.equal(
    (
      await call(base + "retention", "POST", {
        action: "confirm",
        id: preview.id,
        confirmation: "PURGE",
      })
    ).response.status,
    409,
  );
  await ok(base + "recycle-bin", "POST", {
    action: "restore",
    kind: "people",
    ids: [p],
  });
  assert.equal(
    (
      await call(base + "recycle-bin", "POST", {
        action: "confirm",
        id: preview.id,
        confirmation: "PURGE",
      })
    ).response.status,
    409,
  );
  await ok(base + "bulk-records", "POST", {
    kind: "people",
    action: "delete",
    ids: [p],
  });
  preview = await ok(base + "recycle-bin", "POST", {
    action: "preview",
    kind: "people",
    all: true,
  });
  await transaction(
    (c) =>
      c.query(
        "UPDATE purge_requests SET expires_at=now()-interval '1 minute' WHERE id=$1",
        [preview.id],
      ),
    recycleOrg,
  );
  assert.equal(
    (
      await call(base + "recycle-bin", "POST", {
        action: "confirm",
        id: preview.id,
        confirmation: "PURGE",
      })
    ).response.status,
    409,
  );
  preview = await ok(base + "recycle-bin", "POST", {
    action: "preview",
    kind: "people",
    all: true,
  });
  const done = await ok(base + "recycle-bin", "POST", {
    action: "confirm",
    id: preview.id,
    confirmation: "PURGE",
  });
  assert.equal(done.completed, true);
  assert.equal((await ok(base + "recycle-bin")).total, 0);
  assert.equal((await ok(base + "people")).total, 1);
  assert.equal((await ok(base + "cards")).length, 1);
  assert.equal((await ok(base + "cards"))[0].id, keep.id);
  assert.equal(
    (await call(base + "renders/" + first.render_id)).response.status,
    404,
  );
  assert.equal(
    (await call(base + "renders/" + keep.render_id)).response.status,
    200,
  );
  assert.equal((await ok(base + "exports")).length, 0);
  assert.equal(
    (
      await ok(base + "recycle-bin", "POST", {
        action: "confirm",
        id: preview.id,
        confirmation: "PURGE",
      })
    ).completed,
    true,
  );
  await assert.rejects(
    transaction(
      (c) => c.query("DELETE FROM purge_requests WHERE id=$1", [preview.id]),
      recycleOrg,
    ),
    /immutable/,
  );
  await assert.rejects(
    transaction(
      (c) => c.query("DELETE FROM cards WHERE id=$1", [keep.id]),
      recycleOrg,
    ),
    /immutable/,
  );
});

test("photo recycle purge protects template references and queues unshared files for cleanup", async () => {
  const recycleOrg = (
    await ok("orgs", "POST", { name: "Photo purge", code: "RECYCLEPHOTOS" })
  ).id;
  const base = `orgs/${recycleOrg}/`;
  const bytes = await readFile("tests/fixtures/portrait.jpg");
  const photo = (
    await ok(base + "assets?filename=purge.jpg", "POST", bytes, true)
  ).id;
  const doc = templateSchema.parse({
    schemaVersion: 1,
    width: 85.6,
    height: 54,
    front: [
      {
        id: randomUUID(),
        type: "image",
        assetId: photo,
        x: 4,
        y: 4,
        width: 20,
        height: 25,
      },
    ],
    back: [],
  });
  await ok(base + "templates", "POST", {
    name: "Protected photo",
    document: doc,
  });
  await ok(base + "bulk-records", "POST", {
    kind: "photos",
    action: "delete",
    ids: [photo],
  });
  assert.equal(
    (
      await call(base + "recycle-bin", "POST", {
        action: "preview",
        kind: "photos",
        all: true,
      })
    ).response.status,
    409,
  );
  const free = (
    await ok(base + "assets?filename=unshared.jpg", "POST", bytes, true)
  ).id;
  await ok(base + "bulk-records", "POST", {
    kind: "photos",
    action: "delete",
    ids: [free],
  });
  const preview = await ok(base + "recycle-bin", "POST", {
    action: "preview",
    kind: "photos",
    ids: [free],
  });
  assert.equal(preview.summary.photos, 1);
  assert.equal(preview.summary.removedAssets, 1);
  await ok(base + "recycle-bin", "POST", {
    action: "confirm",
    id: preview.id,
    confirmation: "PURGE",
  });
  assert.equal((await ok(base + "assets?deleted=only")).length, 1);
  await cleanupPurgeFiles();
  assert.equal((await ok(base + "retention")).pendingFiles, 0);
});

test("bulk people and photo deletion validates every selected ID, detaches current photos and preserves historical renders", async () => {
  const bulkOrg = (
      await ok("orgs", "POST", { name: "Bulk deletion", code: "BULKDELETE" })
    ).id,
    base = `orgs/${bulkOrg}/`;
  const p1 = (
    await ok(base + "people", "POST", {
      name: "Bulk delete one",
      external_id: "BD1",
    })
  ).id;
  const p2 = (
    await ok(base + "people", "POST", {
      name: "Bulk delete two",
      external_id: "BD2",
    })
  ).id;
  const bytes = await readFile("tests/fixtures/portrait.jpg");
  const photo1 = (
    await ok(base + "assets?filename=BD1.jpg", "POST", bytes, true)
  ).id;
  const photo2 = (
    await ok(base + "assets?filename=BD2.jpg", "POST", bytes, true)
  ).id;
  const logo = (await ok(base + "assets?kind=LOGO", "POST", bytes, true)).id;
  assert.equal(
    (
      await call(base + "bulk-records", "POST", {
        kind: "photos",
        action: "delete",
        ids: [photo1, logo],
      })
    ).response.status,
    404,
  );
  assert.ok((await ok(base + "assets")).some((a: any) => a.id === photo1));
  assert.equal(
    (
      await call(`orgs/${otherOrg}/bulk-records`, "POST", {
        kind: "people",
        action: "delete",
        ids: [p1],
      })
    ).response.status,
    404,
  );
  assert.equal(
    (
      await ok(base + "bulk-records", "POST", {
        kind: "people",
        action: "delete",
        ids: [p1, p2, p2],
      })
    ).count,
    2,
  );
  assert.equal((await ok(base + "people")).total, 0);
  await ok(base + "bulk-records", "POST", {
    kind: "people",
    action: "restore",
    ids: [p1, p2],
  });
  const document = templateSchema.parse({
    schemaVersion: 1,
    width: 85.6,
    height: 54,
    front: [
      { id: randomUUID(), type: "photo", x: 4, y: 4, width: 20, height: 25 },
      {
        id: randomUUID(),
        type: "text",
        x: 28,
        y: 4,
        width: 50,
        height: 10,
        text: "{{name}}",
      },
    ],
    back: [],
  });
  const templateId = (
    await ok(base + "templates", "POST", {
      name: "Bulk photo history",
      document,
    })
  ).id;
  const generated = await ok(base + "cards", "POST", {
    person_id: p1,
    template_id: templateId,
  });
  assert.equal(
    (
      await ok(base + "bulk-records", "POST", {
        kind: "photos",
        action: "delete",
        ids: [photo1, photo2],
      })
    ).count,
    2,
  );
  assert.equal((await ok(base + "people/" + p1)).photo_asset_id, null);
  assert.equal(
    (await ok(base + "assets")).some((a: any) => a.id === photo1),
    false,
  );
  assert.equal((await ok(base + "assets?deleted=only")).length, 2);
  const historical = await transaction(
    (c) =>
      renderExport(c, bulkOrg, generated.render_id, "front", { format: "png" }),
    bulkOrg,
  );
  assert.ok(historical);
  assert.equal(
    (await call(base + "photos/" + p1, "PUT", { asset_id: photo1 })).response
      .status,
    404,
  );
  assert.equal((await ok(base + "photo-matches", "POST", {})).ready, 0);
  await ok(base + "bulk-records", "POST", {
    kind: "photos",
    action: "restore",
    ids: [photo1, photo2],
  });
  assert.equal((await ok(base + "assets?deleted=only")).length, 0);
  assert.equal((await ok(base + "photo-matches", "POST", {})).ready, 2);
});
test("template saves immutable versions; real card generation freezes historical image", async () => {
  const el = (v: Record<string, unknown>) =>
    elementSchema.parse({
      id: randomUUID(),
      x: 4,
      y: 4,
      width: 50,
      height: 12,
      ...v,
    });
  const doc = templateSchema.parse({
    schemaVersion: 1,
    width: 85.6,
    height: 53.98,
    front: [
      el({ type: "text", text: "{{name}}", fontSize: 4 }),
      el({ type: "text", y: 18, text: "{{card.number}}", fontSize: 3 }),
      el({
        type: "qr",
        x: 58,
        y: 28,
        width: 20,
        height: 20,
        text: "{{card.verify_url}}",
      }),
      el({ type: "photo", x: 4, y: 30, width: 14, height: 18 }),
    ],
    back: [
      el({ type: "text", text: "Return to Test Organization", fontSize: 3 }),
    ],
  });
  template = (
    await ok(`orgs/${org}/templates`, "POST", {
      name: "Staff CR80",
      document: doc,
    })
  ).id;
  const generated = await ok(`orgs/${org}/cards`, "POST", {
    person_id: person,
    template_id: template,
  });
  card = generated.id;
  render = generated.render_id;
  assert.match(generated.number, /^TEST-\d{4}-000001$/);
  const before = await ok(`orgs/${org}/renders/${render}`);
  assert.equal((await sharp(before).metadata()).width, 1011);
  await ok(`orgs/${org}/templates/${template}`, "PUT", {
    document: { ...doc, background: "#ddeecc" },
  });
  const current = await ok(`orgs/${org}/templates/${template}`);
  assert.equal(current.versions.length, 2);
  assert.deepEqual(await ok(`orgs/${org}/renders/${render}`), before);
  await assert.rejects(
    transaction(async (c) => {
      await c.query(
        "UPDATE template_versions SET document='{}' WHERE template_id=$1",
        [template],
      );
    }, org),
    /immutable/,
  );
  await writeFile(path.join(root, "sample-card.png"), before);
});
test(
  "worker starts pg-boss and publishes a live heartbeat",
  { timeout: 30000 },
  async () => {
    worker = spawn(process.execPath, ["dist/worker/main.js"], {
      env: process.env,
      stdio: "pipe",
    });
    let output = "";
    worker.stderr?.on("data", (b) => (output += b.toString()));
    for (let attempt = 0; attempt < 80; attempt++) {
      const q = await db().query(
        "SELECT 1 FROM worker_heartbeats WHERE name='main' AND seen_at>now()-interval '90 seconds'",
      );
      if (q.rowCount) {
        assert.equal((await call("health/ready")).response.status, 200);
        return;
      }
      if (worker.exitCode !== null) assert.fail("Worker exited: " + output);
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.fail("Worker heartbeat did not arrive: " + output);
  },
);

test("PNG/JPG exports use frozen snapshots, DPI and quality controls", async () => {
  const png = await ok(`orgs/${org}/cards/${card}/image?dpi=600`);
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, 2022);
  assert.equal(meta.density, 600);
  const jpg = await ok(
    `orgs/${org}/cards/${card}/image?format=jpg&dpi=300&quality=95`,
  );
  assert.equal((await sharp(jpg).metadata()).format, "jpeg");
  assert.equal(
    (await call(`orgs/${org}/cards/${card}/image?format=jpg&quality=70`))
      .response.status,
    422,
  );
  const image = await transaction(
    (c) => renderExport(c, org, render, "front", { format: "png" }),
    org,
  );
  assert.ok(image);
  // The template was changed to green after generation; this export stays white.
  const pixel = await sharp(image!)
    .extract({ left: 0, top: 0, width: 1, height: 1 })
    .raw()
    .toBuffer();
  assert.deepEqual([...pixel].slice(0, 3), [255, 255, 255]);
  const transparent = await transaction(
    (c) => renderExport(c, org, render, "front", { transparent: true }),
    org,
  );
  assert.equal((await sharp(transparent!).metadata()).hasAlpha, true);
  assert.equal(
    (await call(`orgs/${otherOrg}/cards/${card}/pdf`)).response.status,
    404,
  );
});

test("PDF sheets have exact paper size, crop marks and paired duplex pages", async () => {
  const key = await transaction(
    (c) =>
      createExport(c, org, [render], {
        format: "pdf",
        layout: "sheet",
        side: "both",
        cropMarks: true,
        bleed: 1,
      }),
    org,
  );
  const pdf = await readFile(storagePath(key));
  await writeFile(path.join(root, "print-sheet.pdf"), pdf);
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const parsed = await getDocument({
    data: new Uint8Array(pdf),
    useSystemFonts: true,
  }).promise;
  assert.equal(parsed.numPages, 2);
  const page = await parsed.getPage(1),
    viewport = page.getViewport({ scale: 1 });
  assert.ok(Math.abs(viewport.width - pt(210)) < 0.01);
  assert.ok(Math.abs(viewport.height - pt(297)) < 0.01);
  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(
    Math.ceil(viewport.width * 3),
    Math.ceil(viewport.height * 3),
  );
  await page.render({
    canvas: canvas as any,
    canvasContext: canvas.getContext("2d") as any,
    viewport: page.getViewport({ scale: 3 }),
  }).promise;
  const pixels = canvas
    .getContext("2d")
    .getImageData(0, 0, canvas.width, canvas.height);
  const jsQR = (await import("jsqr")).default;
  assert.match(
    jsQR(new Uint8ClampedArray(pixels.data), canvas.width, canvas.height)
      ?.data || "",
    /\/verify\/[a-zA-Z0-9_-]{43}$/,
  );
  await writeFile(
    path.join(root, "print-sheet.png"),
    canvas.toBuffer("image/png"),
  );
  await parsed.cleanup();
  const cardPdf = await ok(`orgs/${org}/cards/${card}/pdf`);
  const single = await getDocument({ data: new Uint8Array(cardPdf) }).promise;
  const size = (await single.getPage(1)).getViewport({ scale: 1 });
  assert.ok(Math.abs(size.width - pt(85.6)) < 0.01);
  await single.cleanup();
});

async function waitJob(resource: string, id: string, tenant = org) {
  for (let i = 0; i < 360; i++) {
    const data = await ok(`orgs/${tenant}/${resource}/${id}`),
      job = Array.isArray(data) ? data[0] : data;
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.fail("Background job timed out");
}
test(
  "bulk generation and ZIP exports finish in the real worker without duplicates",
  { timeout: 65000 },
  async () => {
    const request = {
      template_id: template,
      person_ids: [person],
      request_key: randomUUID(),
    };
    const job = await ok(`orgs/${org}/generation`, "POST", request);
    assert.equal(
      (await ok(`orgs/${org}/generation`, "POST", request)).id,
      job.id,
    );
    const completed = await waitJob("generation", job.id);
    assert.equal(completed.status, "COMPLETED", JSON.stringify(completed));
    assert.equal(completed.completed, 1);
    const before = await ok(`orgs/${org}/cards`);
    await ok(`orgs/${org}/generation/${job.id}/retry`, "POST", {});
    assert.equal((await ok(`orgs/${org}/cards`)).length, before.length);
    const requestExport = {
      render_ids: [render],
      options: { format: "zip", side: "both" },
      request_key: randomUUID(),
    };
    const zip = await ok(`orgs/${org}/exports`, "POST", requestExport);
    const done = await waitJob("exports", zip.id);
    assert.equal(done.status, "COMPLETED", JSON.stringify(done));
    assert.equal(done.completed, 1);
    const downloaded = await ok(`orgs/${org}/exports/${zip.id}/download`);
    assert.equal(downloaded.readUInt32LE(0), 0x04034b50);
    assert.equal(
      (await ok(`orgs/${org}/exports`, "POST", requestExport)).id,
      zip.id,
    );
    assert.equal(
      (await call(`orgs/${otherOrg}/exports/${zip.id}/download`)).response
        .status,
      404,
    );
  },
);
test("live public verification applies privacy, status, expiry and replacement history", async () => {
  const snapshot = await transaction(
    async (c) =>
      (await c.query("SELECT snapshot FROM card_renders WHERE id=$1", [render]))
        .rows[0].snapshot,
    org,
  );
  const token = snapshot["card.verify_url"].split("/").pop();
  await ok(`orgs/${org}/settings`, "PUT", {
    verification_fields: ["name", "grade"],
    location_enabled: false,
  });
  assert.equal(
    (
      await call(`orgs/${org}/settings`, "PUT", {
        verification_fields: ["email"],
        location_enabled: false,
      })
    ).response.status,
    422,
  );
  assert.equal((await ok(`verify/${token}`)).valid, false);
  await ok(`orgs/${org}/cards/${card}/state`, "POST", { status: "ACTIVE" });
  const active = await ok(`verify/${token}`);
  assert.equal(active.valid, true);
  assert.equal(active.fields.name, "Anita Rao");
  assert.equal(active.fields.email, undefined);
  await transaction(
    (c) =>
      c.query(
        "UPDATE cards SET expires_at=now()-interval '1 second' WHERE id=$1",
        [card],
      ),
    org,
  );
  assert.equal((await ok(`verify/${token}`)).status, "EXPIRED");
  await ok(`orgs/${org}/cards/${card}/state`, "POST", { status: "LOST" });
  assert.deepEqual((await ok(`verify/${token}`)).fields, {});
  await ok(`orgs/${org}/cards/${card}/extend`, "POST", {
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  });
  const replacementKey = randomUUID();
  const replacement = await ok(`orgs/${org}/cards/${card}/reissue`, "POST", {
    request_key: replacementKey,
  });
  assert.ok(replacement.id);
  await ok(`orgs/${org}/cards/${replacement.id}/state`, "POST", {
    status: "LOST",
  });
  assert.equal(
    (
      await ok(`orgs/${org}/cards/${card}/reissue`, "POST", {
        request_key: replacementKey,
      })
    ).id,
    replacement.id,
  );
  assert.equal(
    (await ok(`orgs/${org}/cards/${replacement.id}/history`)).card.status,
    "LOST",
  );
  assert.equal((await ok(`verify/${token}`)).status, "REPLACED");
  const history = await ok(`orgs/${org}/cards/${card}/history`);
  assert.ok(history.events.length >= 4);
  assert.equal(history.card.status, "REPLACED");
  assert.equal(
    (
      await call(`orgs/${org}/cards/${card}/state`, "POST", {
        status: "ACTIVE",
      })
    ).response.status,
    409,
  );
  await assert.rejects(
    transaction((c) => c.query("DELETE FROM cards WHERE id=$1", [card]), org),
    /delet|immutable/,
  );
  assert.equal((await call("verify/invalid")).response.status, 404);
});
test("optional locations, scoped tokens, dashboard and immutable audit work end to end", async () => {
  assert.equal((await call(`orgs/${org}/locations`)).response.status, 403);
  await ok(`orgs/${org}/settings`, "PUT", {
    verification_fields: [],
    location_enabled: true,
  });
  await ok(`orgs/${org}/locations`, "POST", {
    address: "Registered office",
    latitude: 12.97,
    longitude: 77.59,
    map_asset_id: photo,
  });
  assert.equal((await ok(`orgs/${org}/locations`)).length, 1);
  const mapDocument = templateSchema.parse({
    schemaVersion: 1,
    width: 85.6,
    height: 53.98,
    front: [
      elementSchema.parse({
        id: randomUUID(),
        type: "map",
        x: 4,
        y: 4,
        width: 50,
        height: 30,
      }),
    ],
    back: [],
  });
  const mapPreview = await ok(`orgs/${org}/preview`, "POST", {
    document: mapDocument,
    person_id: person,
    side: "front",
  });
  assert.equal((await sharp(mapPreview).metadata()).format, "png");
  await ok(`orgs/${org}/settings`, "PUT", {
    verification_fields: [],
    location_enabled: false,
  });
  assert.equal((await call(`orgs/${org}/locations`)).response.status, 403);
  assert.equal(
    (
      await call(`orgs/${org}/preview`, "POST", {
        document: mapDocument,
        person_id: person,
        side: "front",
      })
    ).response.status,
    422,
  );
  const issued = await ok(`orgs/${org}/tokens`, "POST", {
    name: "Read integration",
    scopes: ["read"],
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  });
  const bearer = async (route: string, method = "GET", body?: unknown) =>
    handle(
      new Request(origin + "/api/" + route, {
        method,
        headers: {
          authorization: "Bearer " + issued.token,
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      route.split("/"),
    );
  assert.equal((await bearer(`orgs/${org}/people`)).status, 200);
  assert.equal((await bearer(`orgs/${otherOrg}/people`)).status, 403);
  assert.equal((await bearer("fonts/sync", "POST", {})).status, 403);
  assert.equal(
    (
      await bearer(`orgs/${org}/people`, "POST", {
        name: "Forbidden",
        external_id: "NO",
      })
    ).status,
    403,
  );
  await ok(`orgs/${org}/tokens/${issued.id}`, "DELETE");
  assert.equal((await bearer(`orgs/${org}/people`)).status, 401);
  const report = await ok(`orgs/${org}/dashboard`);
  assert.ok(report.totals.total >= 2);
  assert.match((await ok(`orgs/${org}/reports`)).toString(), /Status,Count/);
  const audit = await ok(`orgs/${org}/audit`);
  assert.ok(JSON.stringify(audit).includes("token.create"));
  assert.ok(!JSON.stringify(audit).includes(issued.token));
  await assert.rejects(
    transaction(
      (c) =>
        c.query("DELETE FROM audit_events WHERE organization_id=$1", [org]),
      org,
    ),
    /immutable|append|delet/i,
  );
});
test("ten thousand records stay paginated and combined filters remain tenant scoped", async () => {
  await transaction(async (c) => {
    await c.query(
      "INSERT INTO people(id,organization_id,external_id,name,designation) SELECT gen_random_uuid(),$1,'LOAD'||i,'Load Person '||i,CASE WHEN i%2=0 THEN 'Engineering' ELSE 'Support' END FROM generate_series(1,10000) i",
      [otherOrg],
    );
  }, otherOrg);
  const listed = await ok(`orgs/${otherOrg}/people?page=200`);
  assert.equal(listed.total, 10000);
  assert.equal(listed.items.length, 50);
  const combined = await ok(
    `orgs/${otherOrg}/people?name=Load&designation=Engineering`,
  );
  assert.equal(combined.total, 5000);
  assert.equal(
    (await ok(`orgs/${org}/people?designation=Engineering`)).total,
    0,
  );
});
test(
  "web E2E: sign in, browse people, load designer and inspect saved card",
  { timeout: 120000, skip: process.env.IDCARD_SKIP_BROWSER === "1" },
  async () => {
    server = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        process.env.IDCARD_TEST_HTTP_PORT || "3107",
      ],
      { env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, stdio: "pipe" },
    );
    let output = "";
    server.stderr?.on("data", (b) => (output += b.toString()));
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        const r = await fetch(origin + "/api/health/live");
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(ready, "Next server did not start: " + output);
    const browser = await chromium.launch({
      headless: true,
      channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        timezoneId: "America/Los_Angeles",
      });
      await page.context().grantPermissions(["clipboard-read"]);
      // Reproduce HTTP LAN browsers where randomUUID is unavailable.
      await page.addInitScript(() => {
        (window as any).__testNativeClipboard = navigator.clipboard;
        Object.defineProperty(window.crypto, "randomUUID", {
          value: undefined,
          configurable: true,
        });
        Object.defineProperty(navigator, "clipboard", {
          value: undefined,
          configurable: true,
        });
      });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(origin);
      assert.equal(
        await page.evaluate(() => typeof crypto.randomUUID),
        "undefined",
      );
      await page.getByLabel("Email address").fill(adminEmail);
      await page.getByLabel("Password", { exact: true }).fill(adminPassword);
      await page.getByRole("button", { name: "Sign in →" }).click();
      try {
        await page
          .getByRole("heading", { name: "People & identity" })
          .waitFor();
      } catch (error) {
        await page.screenshot({
          path: path.join(root, "signin-failure.png"),
          fullPage: true,
        });
        throw new Error(
          "Sign-in failed: " +
            JSON.stringify({
              errors,
              alerts: await page.locator('[role="alert"]').allTextContents(),
              server: output,
            }),
        );
      }
      await page
        .getByRole("combobox", { name: "Organization", exact: true })
        .selectOption(org);
      await page.getByText("Anita Rao", { exact: true }).waitFor();
      await page.screenshot({
        path: path.join(root, "people.png"),
        fullPage: true,
      });
      await page.getByLabel("Find a menu", { exact: true }).fill("Manage");
      await page
        .getByRole("button", { name: "Manage data", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Manage your data", exact: true })
        .waitFor();
      await page.getByLabel("Find a task", { exact: true }).fill("photos");
      await page
        .getByRole("button", { name: "Open photos", exact: true })
        .waitFor();
      await page.getByLabel("Find a task", { exact: true }).fill("");
      await page.screenshot({
        path: path.join(root, "manage-data.png"),
        fullPage: true,
      });
      const recycleUiPerson = (
        await ok(`orgs/${org}/people`, "POST", {
          name: "Recycle UI example",
          external_id: "RECYCLE_UI",
        })
      ).id;
      await ok(`orgs/${org}/bulk-records`, "POST", {
        kind: "people",
        action: "delete",
        ids: [recycleUiPerson],
      });
      await page
        .getByRole("button", { name: "Recycle bin", exact: true })
        .click();
      await page
        .getByLabel("Select deleted Recycle UI example", { exact: true })
        .check();
      await page
        .getByRole("button", { name: "Preview permanent purge", exact: true })
        .click();
      await page
        .getByRole("heading", {
          name: "Review permanent deletion",
          exact: true,
        })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", {
            name: "Permanently purge previewed data",
            exact: true,
          })
          .isDisabled(),
        true,
      );
      await page
        .getByRole("button", { name: "Cancel purge", exact: true })
        .click();
      assert.equal(
        (await ok(`orgs/${org}/recycle-bin`)).items.some(
          (r: any) => r.id === recycleUiPerson,
        ),
        true,
      );
      await page
        .getByRole("button", { name: "Preview permanent purge", exact: true })
        .click();
      await page
        .getByLabel("Recycle bin purge confirmation", { exact: true })
        .fill("PURGE");
      await page.screenshot({
        path: path.join(root, "recycle-bin-preview.png"),
        fullPage: true,
      });
      await page
        .getByRole("button", {
          name: "Permanently purge previewed data",
          exact: true,
        })
        .click();
      await page.getByText(/Permanent purge completed/).waitFor();
      assert.equal(
        (await ok(`orgs/${org}/recycle-bin`)).items.some(
          (r: any) => r.id === recycleUiPerson,
        ),
        false,
      );
      await page.getByRole("button", { name: "People", exact: true }).click();
      const deleteUiPerson = (
        await ok(`orgs/${org}/people`, "POST", {
          name: "Delete UI example",
          external_id: "DELETE_UI",
        })
      ).id;
      await page.getByLabel("Search people", { exact: true }).fill("DELETE_UI");
      await ok(`orgs/${org}/people`, "POST", {
        name: "Delete UI second",
        external_id: "DELETE_UI_2",
      });
      await page.getByLabel("Search people", { exact: true }).fill("Delete UI");
      await page
        .getByLabel("Select person Delete UI second (DELETE_UI_2)", {
          exact: true,
        })
        .waitFor();
      await page
        .getByLabel("Select all people on this page", { exact: true })
        .check();
      await page
        .getByRole("button", { name: "Delete selected (2)", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "Delete selected people", exact: true })
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      assert.ok((await ok(`orgs/${org}/people/${deleteUiPerson}`)).id);
      await page
        .getByRole("button", { name: "Delete selected (2)", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "Delete selected people", exact: true })
        .getByRole("button", { name: "Delete selected", exact: true })
        .click();
      await page.getByText("2 people deleted.", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "Deleted people", exact: true })
        .click();
      await page
        .getByLabel("Select person Delete UI example (DELETE_UI)", {
          exact: true,
        })
        .waitFor();
      await page.screenshot({
        path: path.join(root, "deleted-people.png"),
        fullPage: true,
      });
      await page
        .getByLabel("Select all people on this page", { exact: true })
        .check();
      await page
        .getByRole("button", { name: "Restore selected (2)", exact: true })
        .click();
      await page.getByText("2 people restored.", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "Current people", exact: true })
        .click();
      await page.getByLabel("Search people", { exact: true }).fill("");
      await page.getByText("Anita Rao", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Photos", exact: true }).click();
      const deletePhotoBytes = await readFile("tests/fixtures/portrait.jpg");
      await ok(
        `orgs/${org}/assets?filename=UI_DELETE_A.jpg`,
        "POST",
        deletePhotoBytes,
        true,
      );
      await ok(
        `orgs/${org}/assets?filename=UI_DELETE_B.jpg`,
        "POST",
        deletePhotoBytes,
        true,
      );
      // Refresh the gallery after seeding two ordinary uploaded photos.
      await page
        .getByRole("button", { name: "Deleted photos", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Current photos", exact: true })
        .click();
      await page
        .getByLabel("Select photo UI_DELETE_A.jpg", { exact: true })
        .waitFor();
      await page
        .getByLabel("Select all loaded photos", { exact: true })
        .check();
      const selectedPhotosCount = await page
        .getByRole("checkbox", { name: /^Select photo / })
        .count();
      assert.ok(selectedPhotosCount >= 2);
      await page
        .getByLabel("Select all loaded photos", { exact: true })
        .uncheck();
      await page
        .getByLabel("Select photo UI_DELETE_A.jpg", { exact: true })
        .check();
      await page
        .getByLabel("Select photo UI_DELETE_B.jpg", { exact: true })
        .check();
      await page
        .getByRole("button", { name: "Delete selected (2)", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "Delete selected photos", exact: true })
        .getByRole("button", { name: "Delete selected", exact: true })
        .click();
      await page.getByText("2 photos deleted.", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "Deleted photos", exact: true })
        .click();
      await page
        .getByLabel("Select photo UI_DELETE_A.jpg", { exact: true })
        .waitFor();
      await page
        .getByLabel("Select all loaded photos", { exact: true })
        .check();
      await page.screenshot({
        path: path.join(root, "bulk-delete-photos.png"),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Restore selected (2)", exact: true })
        .click();
      await page.getByText("2 photos restored.", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "Current photos", exact: true })
        .click();
      const bulkUiPerson = (
        await ok(`orgs/${org}/people`, "POST", {
          name: "UI Bulk Match",
          external_id: "UI_MATCH_1",
        })
      ).id;
      await ok(
        `orgs/${org}/assets?filename=UI_MATCH_%201.jpg`,
        "POST",
        await readFile("tests/fixtures/portrait.jpg"),
        true,
      );
      await page
        .getByRole("button", { name: "Preview bulk matches", exact: true })
        .click();
      await page.getByText(/^1 ready to match;/).waitFor();
      await page
        .getByRole("button", { name: "Match 1 photos", exact: true })
        .click();
      await page
        .getByText(/^1 photos matched. Existing assignments were kept./)
        .waitFor();
      assert.ok(
        (await ok(`orgs/${org}/people/${bulkUiPerson}`)).photo_asset_id,
      );
      await page.screenshot({
        path: path.join(root, "bulk-photo-match.png"),
        fullPage: true,
      });
      const uploadZipButton = page.getByRole("button", {
        name: "Upload ZIP",
        exact: true,
      });
      const uploadImagesButton = page.getByRole("button", {
        name: "Upload images",
        exact: true,
      });
      assert.equal(await uploadZipButton.isDisabled(), true);
      assert.equal(await uploadImagesButton.isDisabled(), true);
      let zipUploadRequests = 0;
      let imageUploadRequests = 0;
      page.on("request", (request) => {
        if (request.method() !== "POST") return;
        if (request.url().includes(`/orgs/${org}/photos?`)) zipUploadRequests++;
        if (request.url().includes(`/orgs/${org}/assets?`))
          imageUploadRequests++;
      });
      const batchPhoto = await readFile("tests/fixtures/portrait.jpg");
      await page.getByLabel("Photo ZIP", { exact: true }).setInputFiles({
        name: "too-large.zip",
        mimeType: "application/zip",
        buffer: Buffer.alloc(25 * 1024 * 1024 + 1),
      });
      await uploadZipButton.click();
      await page
        .getByRole("alert")
        .filter({ hasText: "Photo ZIP exceeds 25 MB" })
        .waitFor();
      assert.equal(
        zipUploadRequests,
        0,
        "oversized ZIPs must be rejected before sending",
      );
      await page.getByLabel("Photo ZIP", { exact: true }).setInputFiles({
        name: "portraits.zip",
        mimeType: "application/zip",
        buffer: zipFile("EMP003.jpg", batchPhoto),
      });
      await page.getByText(/Ready to upload: portraits.zip/).waitFor();
      assert.equal(zipUploadRequests, 0, "choosing a ZIP must not upload it");
      assert.equal(await uploadZipButton.isEnabled(), true);
      await page.screenshot({
        path: path.join(root, "photo-zip-ready.png"),
        fullPage: true,
      });
      await uploadZipButton.click();
      await page
        .getByText("ZIP uploaded. 1 matched; 0 need attention.", {
          exact: true,
        })
        .waitFor();
      assert.equal(zipUploadRequests, 1);
      assert.equal(await uploadZipButton.isDisabled(), true);
      await page.getByLabel("Photo ZIP", { exact: true }).setInputFiles({
        name: "retry.zip",
        mimeType: "application/zip",
        buffer: zipFile("EMP003.jpg", batchPhoto),
      });
      const photoUploadPattern = "**/api/orgs/*/photos?*";
      await page.route(photoUploadPattern, (route) => route.abort("failed"));
      await uploadZipButton.click();
      await page
        .getByRole("alert")
        .filter({ hasText: "The photo upload connection was interrupted" })
        .waitFor();
      assert.equal(await uploadZipButton.isEnabled(), true);
      await page.getByText(/Ready to upload: retry.zip/).waitFor();
      await page.unroute(photoUploadPattern);
      await uploadZipButton.click();
      await page
        .getByText("ZIP uploaded. 1 matched; 0 need attention.", {
          exact: true,
        })
        .waitFor();
      await page.getByLabel("Multiple images", { exact: true }).setInputFiles([
        {
          name: "BATCH-UNMATCHED-1.jpg",
          mimeType: "image/jpeg",
          buffer: batchPhoto,
        },
        {
          name: "BATCH-UNMATCHED-2.jpg",
          mimeType: "image/jpeg",
          buffer: batchPhoto,
        },
      ]);
      await page.getByText(/2 images ready to upload:/).waitFor();
      assert.equal(
        imageUploadRequests,
        0,
        "choosing images must not upload them",
      );
      await uploadImagesButton.click();
      await page.getByText(/^2 images uploaded;/).waitFor();
      assert.equal(imageUploadRequests, 2);
      assert.equal(await uploadImagesButton.isDisabled(), true);
      await page
        .getByRole("button", { name: "Organization", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Time management", exact: true })
        .waitFor();
      await page
        .getByLabel("Organization time zone", { exact: true })
        .selectOption("Asia/Kolkata");
      await page
        .getByLabel("Organization time display", { exact: true })
        .selectOption("12");
      await page
        .getByRole("button", { name: "Save time settings", exact: true })
        .click();
      await page
        .getByText("Organization time settings saved.", { exact: true })
        .waitFor();
      assert.match(
        await page.getByLabel("Organization time", { exact: true }).innerText(),
        /Asia\/Kolkata/,
      );
      await page.screenshot({
        path: path.join(root, "organization-time.png"),
        fullPage: true,
      });
      await page.getByRole("button", { name: "Forms", exact: true }).click();
      await page
        .getByRole("heading", { name: "Data collection forms", exact: true })
        .waitFor();
      await page
        .getByLabel("Profession preset")
        .selectOption("Healthcare / practice");
      await page.getByRole("button", { name: "New form", exact: true }).click();
      await page
        .getByLabel("Form title", { exact: true })
        .fill("Clinic collection");
      await page
        .getByLabel("Profession / practice", { exact: true })
        .fill("Dental practice");
      await page.getByText("Add a custom question", { exact: true }).click();
      await page
        .getByLabel("Custom question label", { exact: true })
        .fill("Clinic branch");
      await page
        .getByRole("button", { name: "Add custom question", exact: true })
        .click();
      await page.getByLabel("Accept responses", { exact: true }).check();
      await page
        .getByLabel("Closing date (optional)", { exact: true })
        .fill("2000-01-01T02:50");
      await page
        .getByRole("button", { name: "Save form", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "The closing time has already passed" })
        .waitFor();
      await page
        .getByLabel("Closing date (optional)", { exact: true })
        .fill(`${new Date().getUTCFullYear() + 1}-10-20T14:50`);
      assert.match(
        await page
          .getByLabel("Closing time preview", { exact: true })
          .innerText(),
        /2:50\s*pm/i,
      );
      await page
        .getByRole("button", { name: "Save form", exact: true })
        .click();
      await page
        .getByText("Form saved. Copy the link to share it.", { exact: true })
        .waitFor();
      const formLink = await page
        .getByLabel("Share form link", { exact: true })
        .inputValue();
      // HTTP LAN has no Clipboard API: exercise the real selection-copy fallback.
      await page
        .getByRole("button", { name: "Copy link", exact: true })
        .click();
      await page.getByText("Form link copied.", { exact: true }).waitFor();
      assert.equal(
        await page.evaluate(() =>
          (window as any).__testNativeClipboard.readText(),
        ),
        formLink,
      );
      assert.equal(
        await page
          .getByLabel("Share form link", { exact: true })
          .evaluate((el: HTMLInputElement) =>
            el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0),
          ),
        formLink,
      );
      // If the browser blocks both methods, keep the exact URL selected for manual copy.
      await page.evaluate(() => {
        document.execCommand = () => false;
      });
      await page
        .getByRole("button", { name: "Copy link", exact: true })
        .click();
      await page
        .getByText(
          "The link is selected. Press Ctrl+C, or touch and hold it and choose Copy.",
          { exact: true },
        )
        .waitFor();
      assert.equal(
        await page
          .getByLabel("Share form link", { exact: true })
          .evaluate((el: HTMLInputElement) =>
            el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0),
          ),
        formLink,
      );
      await page.screenshot({
        path: path.join(root, "collection-builder.png"),
        fullPage: true,
      });
      const anonymous = await browser.newContext();
      try {
        const applicant = await anonymous.newPage();
        await applicant.goto(formLink);
        await applicant
          .getByRole("heading", { name: "Clinic collection", exact: true })
          .waitFor();
        assert.equal(
          await applicant
            .getByRole("button", { name: "Submit details", exact: true })
            .isDisabled(),
          true,
        );
        await applicant
          .getByLabel("Full name *", { exact: true })
          .fill("Clinic Applicant");
        await applicant
          .getByLabel("ID number *", { exact: true })
          .fill("CLINIC001");
        await applicant
          .getByLabel("Practice name", { exact: true })
          .fill("City Dental");
        await applicant
          .getByLabel("Clinic branch", { exact: true })
          .fill("Central");
        await applicant
          .locator('input[type="file"]')
          .first()
          .setInputFiles("tests/fixtures/portrait.jpg");
        await applicant.getByRole("checkbox", { name: /I agree that/ }).check();
        await applicant.setViewportSize({ width: 390, height: 844 });
        await applicant.screenshot({
          path: path.join(root, "collection-mobile.png"),
          fullPage: true,
        });
        await applicant
          .getByRole("button", { name: "Submit details", exact: true })
          .click();
        await applicant
          .getByRole("heading", { name: "Details submitted", exact: true })
          .waitFor();
      } finally {
        await anonymous.close();
      }
      await page
        .getByRole("button", { name: "Close editor", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Review responses", exact: true })
        .click();
      await page.getByRole("button", { name: "Review", exact: true }).click();
      await page
        .getByLabel("Full name *", { exact: true })
        .fill("Clinic Applicant Reviewed");
      await page.getByAltText("Submitted photo", { exact: true }).waitFor();
      await page.screenshot({
        path: path.join(root, "collection-review.png"),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Approve and add to People", exact: true })
        .click();
      await page
        .getByText(
          "Approved and added to People. Use the normal card generation and download workflow.",
          { exact: true },
        )
        .waitFor();
      await page.getByRole("button", { name: "People", exact: true }).click();
      await page
        .getByRole("button", { name: "Templates", exact: true })
        .click();
      await page.getByRole("button", { name: "Archive", exact: true }).click();
      await page
        .getByRole("button", { name: "Open designer", exact: true })
        .waitFor({ state: "hidden" });
      await page.getByRole("tab", { name: /^Archive/ }).click();
      await page
        .getByRole("button", { name: "Restore", exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Archive", exact: true })
          .count(),
        0,
      );
      await page.getByRole("button", { name: "Restore", exact: true }).click();
      await page
        .getByRole("heading", { name: "No archived templates" })
        .waitFor();
      await page.getByRole("tab", { name: /^General templates/ }).click();
      await page.getByRole("button", { name: "Open designer" }).click();
      await page
        .getByRole("heading", { name: "Elements", exact: true })
        .waitFor();
      await page
        .getByRole("combobox", { name: "Preview person" })
        .selectOption(person);
      await page.getByRole("button", { name: "Render front" }).click();
      await page.getByAltText("Server-rendered card preview").waitFor();
      await page.screenshot({
        path: path.join(root, "designer.png"),
        fullPage: true,
      });
      await page.getByRole("button", { name: "photo", exact: true }).click();
      assert.equal(
        await page.getByLabel("Automatically frame the face").isChecked(),
        true,
      );
      await page.getByLabel("Automatically frame the face").uncheck();
      assert.equal(
        await page.getByLabel("Automatically frame the face").isChecked(),
        false,
      );
      await page.getByLabel("Automatically frame the face").check();
      await page.getByLabel("height · mm", { exact: true }).fill("28");
      await page
        .getByRole("button", { name: "Square photo", exact: true })
        .click();
      assert.equal(
        await page.getByLabel("width · mm", { exact: true }).inputValue(),
        await page.getByLabel("height · mm", { exact: true }).inputValue(),
      );
      assert.equal(
        await page
          .getByRole("combobox", { name: "Image fitting", exact: true })
          .inputValue(),
        "cover",
      );
      await page.getByRole("button", { name: "Cards", exact: true }).click();
      await page.getByText("DRAFT", { exact: true }).first().waitFor();
      await page.getByLabel("Replacement template", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Imports", exact: true }).click();
      assert.equal(
        await page.locator('a[href*="upload-templates?kind=kit"]').count(),
        1,
      );
      await page.getByLabel("Choose a spreadsheet").setInputFiles({
        name: "mixed-headers.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("external_id,Full name\nMATCH001,Sample General\n"),
      });
      await page
        .getByRole("heading", { name: "Map your columns", exact: true })
        .waitFor();
      assert.deepEqual(
        await page
          .locator(".mapping select")
          .evaluateAll((nodes) =>
            nodes.map((n) => (n as HTMLSelectElement).value),
          ),
        ["external_id", "name"],
      );
      await page.screenshot({
        path: path.join(root, "universal-import.png"),
        fullPage: true,
      });
      for (const [tab, title] of [
        ["Dashboard", "Generated in the last 30 days"],
        ["Exports", "Download cards & prepare print sheets"],
        ["Jobs", "Generate cards in the background"],
        ["Privacy", "Public verification & location"],
        ["Audit", "Audit log"],
      ]) {
        await page.getByRole("button", { name: tab, exact: true }).click();
        await page.getByRole("heading", { name: title, exact: true }).waitFor();
        if (tab === "Audit" || tab === "Jobs") {
          assert.equal(
            await page
              .getByRole("button", { name: "Delete logs", exact: true })
              .count(),
            0,
          );
        }
        if (tab === "Dashboard") {
          await page.locator(".stats strong").first().waitFor();
          assert.ok(
            Number(await page.locator(".stats strong").first().textContent()) >
              0,
          );
        }
        await page.screenshot({
          path: path.join(root, tab.toLowerCase() + ".png"),
          fullPage: true,
        });
      }
      await page
        .getByRole("button", { name: "Organization", exact: true })
        .click();
      assert.equal(
        await page.locator("footer").innerText(),
        "IDcard Manager",
      );
      assert.ok((await page.locator("nav .nav-icon svg").count()) >= 10);
      await page
        .getByLabel("Primary print language", { exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByLabel("Primary print language", { exact: true })
          .inputValue(),
        "en",
      );
      assert.ok(
        (await page
          .getByLabel("Additional print language", { exact: true })
          .locator("option")
          .count()) > 20,
      );
      await page
        .getByRole("button", { name: "Sync fonts from PC", exact: true })
        .waitFor();
      await page.getByText("Purge data · Admin only", { exact: true }).click();
      await page
        .getByRole("button", { name: "Preview purge", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Purge preview", exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", {
            name: "Permanently purge previewed data",
            exact: true,
          })
          .isDisabled(),
        true,
      );
      await page
        .getByLabel("Purge confirmation", { exact: true })
        .fill("PURGE");
      assert.equal(
        await page
          .getByRole("button", {
            name: "Permanently purge previewed data",
            exact: true,
          })
          .isDisabled(),
        true,
      );
      await page.screenshot({
        path: path.join(root, "purge-preview.png"),
        fullPage: true,
      });
      await page
        .getByRole("heading", {
          name: "Card fields & mandatory rules",
          exact: true,
        })
        .waitFor();
      assert.equal(
        await page.getByLabel("Card type", { exact: true }).count(),
        0,
      );
      await page
        .getByRole("checkbox", {
          name: "Require Parent / guardian phone",
          exact: true,
        })
        .check();
      await page
        .getByRole("button", { name: "Save field choices", exact: true })
        .click();
      await page
        .getByText(
          "Field choices saved. Download a fresh upload kit to use these requirements.",
          { exact: true },
        )
        .waitFor();
      const downloadEvent = page.waitForEvent("download");
      await page
        .getByRole("link", {
          name: "Download General import kit",
          exact: true,
        })
        .click();
      const download = await downloadEvent;
      assert.equal(download.suggestedFilename(), "bulk-upload-kit.zip");
      assert.equal(await download.failure(), null);
      await page.screenshot({
        path: path.join(root, "card-fields.png"),
        fullPage: true,
      });
      await page
        .getByText("Application name & logo (all organizations)", {
          exact: true,
        })
        .click();
      const logo = await sharp({
        create: { width: 100, height: 60, channels: 3, background: "#713b83" },
      })
        .png()
        .toBuffer();
      await page
        .getByLabel("Upload application logo", { exact: true })
        .setInputFiles({
          name: "application-logo.png",
          mimeType: "image/png",
          buffer: logo,
        });
      await page
        .getByText(
          "Application logo uploaded. The sign-in page and sidebar now use it.",
          { exact: true },
        )
        .waitFor();
      await page.locator(".wordmark img").waitFor();
      await page
        .getByRole("button", { name: "Arrange menu", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Move Photos up", exact: true })
        .click();
      let order = await page
        .locator("nav .nav")
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")));
      assert.ok(order.indexOf("Photos") < order.indexOf("Imports"));
      await page
        .getByRole("button", { name: "Done arranging", exact: true })
        .click();
      await page.reload();
      await page
        .getByRole("combobox", { name: "Organization", exact: true })
        .selectOption(org);
      order = await page
        .locator("nav .nav")
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")));
      assert.ok(order.indexOf("Photos") < order.indexOf("Imports"));
      assert.equal(
        await page
          .getByRole("combobox", { name: "App theme", exact: true })
          .count(),
        0,
      );
      await page
        .getByRole("button", { name: "Arrange menu", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Reset menu", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Done arranging", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Organization", exact: true })
        .click();
      for (const [key, theme] of Object.entries(builtInThemes)) {
        await page
          .getByRole("combobox", { name: "App theme", exact: true })
          .selectOption(key);
        await page.waitForFunction(
          (k) => document.documentElement.dataset.theme === k,
          key,
        );
        const expected = `rgb(${[1, 3, 5].map((i) => parseInt(theme.paper.slice(i, i + 2), 16)).join(", ")})`;
        assert.equal(
          await page.evaluate(
            () => getComputedStyle(document.body).backgroundColor,
          ),
          expected,
        );
        const panel = `rgb(${[1, 3, 5].map((i) => parseInt(theme.surface.slice(i, i + 2), 16)).join(", ")})`;
        await page.waitForFunction(
          (background) =>
            getComputedStyle(document.querySelector(".nav:not(.active)")!)
              .backgroundColor === background,
          panel,
        );
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(root, `theme-${key}.png`) });
      }
      await page
        .getByRole("combobox", { name: "App theme", exact: true })
        .selectOption("carddesk");
      await page.reload();
      await page
        .getByRole("combobox", { name: "Organization", exact: true })
        .selectOption(org);
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === "carddesk",
      );
      await page
        .getByRole("button", { name: "Organization", exact: true })
        .click();
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .getByRole("button", { name: "Open menu", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Organization", exact: true })
        .click();
      assert.equal(
        await page
          .getByRole("button", { name: "Open menu", exact: true })
          .getAttribute("aria-expanded"),
        "false",
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        "CardDesk must fit mobile width",
      );
      await page.screenshot({
        path: path.join(root, "theme-carddesk-mobile.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page
        .getByRole("combobox", { name: "App theme", exact: true })
        .selectOption("night");
      await page.reload();
      await page
        .getByRole("combobox", { name: "Organization", exact: true })
        .selectOption(org);
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === "night",
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: path.join(root, "theme-night-mobile.png"),
        fullPage: true,
      });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        "Mobile theme must not overflow horizontally",
      );
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page
        .getByRole("button", { name: "Organization", exact: true })
        .click();
      await page
        .getByRole("combobox", { name: "App theme", exact: true })
        .selectOption("paper");
      assert.equal(
        await page
          .getByRole("combobox", { name: "Card layout", exact: true })
          .count(),
        0,
      );
      await page
        .getByRole("button", {
          name: "Create / update General template",
          exact: true,
        })
        .click();
      await page
        .getByText(
          "General template saved. Open Templates to edit or preview it.",
          { exact: true },
        )
        .waitFor();
      await page
        .getByRole("button", { name: "Templates", exact: true })
        .click();
      const sharedTile = page.locator(".template-tile").filter({
        has: page.getByRole("heading", {
          name: "General card template",
          exact: true,
        }),
      });
      await sharedTile
        .getByRole("button", { name: "Open designer", exact: true })
        .click();
      assert.equal(
        await page
          .getByRole("combobox", { name: "Editing card type", exact: true })
          .count(),
        0,
      );
      await page.getByText(/^Card type: General\./).waitFor();
      await page.getByLabel("Height · mm", { exact: true }).fill("120");
      await page
        .getByRole("button", { name: "Save version", exact: true })
        .click();
      await page.getByText("Saved as a new version", { exact: true }).waitFor();
      const sharedSaved = await transaction(
        async (c) =>
          (
            await c.query(
              "SELECT v.document FROM templates t JOIN LATERAL (SELECT document FROM template_versions WHERE template_id=t.id ORDER BY version DESC LIMIT 1) v ON true WHERE t.organization_id=$1 AND t.name='General card template'",
              [org],
            )
          ).rows[0].document,
        org,
      );
      assert.equal(sharedSaved.height, 120);
      assert.equal(sharedSaved.general, true);
      assert.equal(sharedSaved.variants, undefined);
      await page.screenshot({
        path: path.join(root, "shared-template-designer.png"),
        fullPage: true,
      });
      const policy = await page.evaluate(() =>
        fetch("/").then((r) => r.headers.get("content-security-policy")),
      );
      assert.match(policy!, /'nonce-/);
      assert.ok(!policy!.split("style-src")[0].includes("unsafe-inline"));
      assert.deepEqual(
        await page.locator('.error[role="alert"]').allTextContents(),
        [],
      );
      assert.deepEqual(errors, []);
      const snapshot = await transaction(
        async (c) =>
          (
            await c.query("SELECT snapshot FROM card_renders WHERE id=$1", [
              render,
            ])
          ).rows[0].snapshot,
        org,
      );
      const publicResponse = await fetch(snapshot["card.verify_url"]);
      assert.match(
        publicResponse.headers.get("cache-control") || "",
        /no-store/,
      );
      assert.match(await publicResponse.text(), /REPLACED/);
      const samplePerson = (await ok("orgs/" + org + "/people")).items[0];
      await ok("orgs/" + org + "/people/" + samplePerson.id, "PUT", {
        ...samplePerson,
        custom_fields: {
          ...samplePerson.custom_fields,
          guardian_phone: "1234567890",
        },
      });
      await page.getByRole("button", { name: "Setup", exact: true }).click();
      await page.getByRole("button", { name: "Use this organization" }).click();
      await page.getByRole("button", { name: "Continue without logo" }).click();
      await page
        .getByRole("button", {
          name: "Use existing template or create starter",
        })
        .click();
      await page
        .getByRole("button", { name: "Check people and continue" })
        .click();
      await page
        .getByRole("button", { name: "Check photos and continue" })
        .click();
      await page
        .getByRole("button", { name: "Generate sample card", exact: true })
        .click();
      await page.getByAltText("Saved setup sample front").waitFor();
      await page
        .getByRole("button", { name: "Sample checked — continue" })
        .click();
      await page
        .getByRole("button", { name: "Save print settings", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Finish setup", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Your first-card setup is complete" })
        .waitFor();
      await page.reload();
      await page
        .getByRole("combobox", { name: "Organization", exact: true })
        .selectOption(org);
      await page.getByRole("button", { name: "Setup", exact: true }).click();
      await page
        .getByRole("heading", { name: "Your first-card setup is complete" })
        .waitFor();
      await page.screenshot({
        path: path.join(root, "setup.png"),
        fullPage: true,
      });
      await page.goto(origin + "/admin/system/health");
      await page
        .getByRole("heading", { name: "System", exact: true })
        .waitFor();
      assert.deepEqual(errors, []);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: path.join(root, "mobile.png"),
        fullPage: true,
      });
    } finally {
      await browser.close();
    }
  },
);

test(
  "100-person XLSX + matched photos + generation survive worker restart and export 26 PDF pages",
  { timeout: 180000 },
  async () => {
    const acceptance = (
      await ok("orgs", "POST", { name: "Volume acceptance", code: "ACPT" })
    ).id;
    const base = `orgs/${acceptance}/`;
    const workbook = new ExcelJS.Workbook(),
      sheet = workbook.addWorksheet("Staff");
    sheet.addRow(["ID", "Name"]);
    for (let i = 1; i <= 100; i++)
      sheet.addRow([
        "ACPT" + String(i).padStart(4, "0"),
        "Acceptance Person " + i,
      ]);
    const upload = await ok(
      base + "imports?filename=acceptance.xlsx",
      "POST",
      Buffer.from(await workbook.xlsx.writeBuffer()),
      true,
    );
    const validation = await ok(
      base + `imports/${upload.id}/validate`,
      "POST",
      { mapping: { ID: "external_id", Name: "name" } },
    );
    assert.equal(validation.invalid, 0);
    assert.equal(
      (await ok(base + `imports/${upload.id}/commit`, "POST", {})).imported,
      100,
    );
    const image = await sharp({
      create: { width: 90, height: 120, channels: 3, background: "#8fb5b8" },
    })
      .png()
      .toBuffer();
    const zip = new ZipArchive(),
      parts: Buffer[] = [];
    zip.on("data", (b) => parts.push(b));
    const ended = once(zip, "end");
    for (let i = 1; i <= 100; i++)
      zip.append(image, { name: "ACPT" + String(i).padStart(4, "0") + ".png" });
    await zip.finalize();
    await ended;
    const photos = await ok(
      base + "photos?match=external_id",
      "POST",
      Buffer.concat(parts),
      true,
    );
    assert.equal(photos.results.filter((r: any) => r.matched).length, 100);
    const doc = (await ok(`orgs/${org}/templates/${template}`)).document;
    const target = (
      await ok(base + "templates", "POST", {
        name: "Acceptance two-sided CR80",
        document: doc,
      })
    ).id;
    const job = await ok(base + "generation", "POST", {
      template_id: target,
      filters: {},
      request_key: randomUUID(),
    });
    let restarted = false;
    for (let i = 0; i < 240; i++) {
      const progress = await ok(base + "generation/" + job.id);
      if (progress.completed > 0 && progress.completed < 100) {
        const stopped = once(worker, "exit");
        worker.kill();
        await stopped;
        worker = spawn(process.execPath, ["dist/worker/main.js"], {
          env: process.env,
          stdio: "pipe",
        });
        worker.stderr?.on("data", () => {});
        worker.stdout?.on("data", () => {});
        restarted = true;
        break;
      }
      if (progress.status === "FAILED") assert.fail(JSON.stringify(progress));
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(
      restarted,
      true,
      "Observe and interrupt an actual partially completed job",
    );
    const complete = await waitJob("generation", job.id, acceptance);
    assert.equal(complete.status, "COMPLETED", JSON.stringify(complete));
    assert.equal(complete.completed, 100);
    await transaction(async (c) => {
      const counts = (
        await c.query(
          "SELECT count(*)::int AS total,count(DISTINCT number)::int AS numbers FROM cards",
        )
      ).rows[0];
      assert.equal(counts.total, 100);
      assert.equal(counts.numbers, 100);
    }, acceptance);
    const exported = await ok(base + "exports", "POST", {
      filters: { batch_id: job.id },
      options: {
        format: "pdf",
        layout: "sheet",
        side: "both",
        columns: 2,
        rows: 4,
        cropMarks: true,
      },
      request_key: randomUUID(),
    });
    const finished = await waitJob("exports", exported.id, acceptance);
    assert.equal(finished.status, "COMPLETED", JSON.stringify(finished));
    const pdf = await ok(base + `exports/${exported.id}/download`);
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const parsed = await getDocument({ data: new Uint8Array(pdf) }).promise;
    assert.equal(parsed.numPages, 26);
    await parsed.cleanup();
    await writeFile(path.join(root, "100-card-print.pdf"), pdf);
  },
);

test(
  "branding, all card layouts, per-type defaults and frozen theme batches work end to end",
  { timeout: 120000 },
  async () => {
    const visualOrg = (
      await ok("orgs", "POST", { name: "Visual College", code: "VISUAL" })
    ).id;
    const base = `orgs/${visualOrg}/`,
      defaults: Record<string, string> = {};
    for (const kind of ["staff", "student", "visitor", "professional"])
      for (const layout of ["classic", "vertical", "modern"]) {
        const preset = await ok(base + "appearance", "POST", {
          kind,
          layout,
          theme: "forest",
        });
        const template = await ok(base + "templates/" + preset.id);
        assert.equal(template.document.cardType, kind);
        assert.equal(template.document.stylePreset, layout);
        assert.equal(
          template.document.front[0].fill,
          builtInThemes.forest.cardAccent,
        );
        assert.equal(
          template.document.back[0].fill,
          builtInThemes.forest.cardAccent,
        );
        for (const e of [...template.document.front, ...template.document.back])
          assert.ok(
            e.y + e.height <= template.document.height,
            `${kind} ${layout} fits`,
          );
        if (layout === (kind === "visitor" ? "vertical" : "classic"))
          defaults[kind] = preset.id;
      }
    let settings = appearanceSchema.parse({
      defaultTheme: "forest",
      locked: true,
      lockedTheme: "forest",
      defaults,
    });
    await ok(base + "appearance", "PUT", settings);
    assert.equal(
      (
        await call(base + "appearance", "PUT", {
          ...settings,
          defaults: { visitor: defaults.staff },
        })
      ).response.status,
      422,
    );
    assert.equal(
      (await call(`orgs/${otherOrg}/appearance`, "PUT", settings)).response
        .status,
      422,
    );
    const image = await sharp({
      create: { width: 100, height: 60, channels: 3, background: "#713b83" },
    })
      .png()
      .toBuffer();
    await ok(
      `branding?org=${visualOrg}&name=Visual%20College%20ID`,
      "POST",
      image,
      true,
    );
    const publicBrand = await handle(new Request(origin + "/api/branding"), [
      "branding",
    ]);
    const brand = await publicBrand.json();
    assert.equal(brand.name, "Visual College ID");
    assert.ok(brand.logo.startsWith("/api/branding/logo?v="));
    const publicLogo = await handle(new Request(origin + brand.logo), [
      "branding",
      "logo",
    ]);
    assert.equal(publicLogo.status, 200);
    assert.equal(
      (await sharp(Buffer.from(await publicLogo.arrayBuffer())).metadata())
        .width,
      100,
    );
    const people: string[] = [];
    for (let i = 0; i < 10; i++)
      people.push(
        (
          await ok(base + "people", "POST", {
            external_id: `VS${i}`,
            name: `Staff ${i}`,
            custom_fields: { card_type: "staff" },
          })
        ).id,
      );
    const job = await ok(base + "generation", "POST", {
      person_ids: people,
      filters: { card_type: "staff" },
      request_key: randomUUID(),
      theme_key: "plum",
    });
    const queued = await ok(base + "generation/" + job.id);
    assert.equal(queued.style_snapshot.key, "forest");
    settings = { ...settings, locked: false, defaultTheme: "plum" };
    await ok(base + "appearance", "PUT", settings);
    const policy = defaultCardPolicy("staff");
    policy.required.push("department");
    await ok(base + "card-profiles", "PUT", { kind: "staff", policy });
    const done = await waitJob("generation", job.id, visualOrg);
    assert.equal(done.status, "COMPLETED", JSON.stringify(done));
    const snapshots = await transaction(
      async (c) =>
        (
          await c.query(
            "SELECT r.id,r.snapshot FROM card_renders r JOIN generation_items i ON i.card_id=r.card_id WHERE i.job_id=$1",
            [job.id],
          )
        ).rows,
      visualOrg,
    );
    assert.equal(snapshots.length, 10);
    for (const row of snapshots) {
      assert.equal(row.snapshot._appearance.key, "forest");
      assert.equal(
        row.snapshot._document.front[0].fill,
        builtInThemes.forest.cardAccent,
      );
      assert.equal(
        row.snapshot._document.back[0].fill,
        builtInThemes.forest.cardAccent,
      );
    }
    const originalBytes = await ok(base + "renders/" + snapshots[0].id);
    const fresh = (
      await ok(base + "people", "POST", {
        external_id: "VSNEW",
        name: "New Staff",
        custom_fields: { card_type: "staff", department: "Science" },
      })
    ).id;
    const card = await ok(base + "cards", "POST", { person_id: fresh });
    const saved = await transaction(
      async (c) =>
        (
          await c.query("SELECT snapshot FROM card_renders WHERE id=$1", [
            card.render_id,
          ])
        ).rows[0].snapshot,
      visualOrg,
    );
    assert.equal(saved._appearance.key, "plum");
    assert.equal(saved._document.front[0].fill, builtInThemes.plum.cardAccent);
    assert.equal(saved._document.back[0].fill, builtInThemes.plum.cardAccent);
    assert.deepEqual(
      await ok(base + "renders/" + snapshots[0].id),
      originalBytes,
    );
    const campus = {
      ...structuredClone(builtInThemes.plum),
      name: "Campus Purple",
      font: "DejaVu Serif" as const,
      logoPosition: "left" as const,
      fields: { staff: ["name", "external_id", "department", "qr"] },
    };
    assert.equal(
      (
        await call(base + "appearance", "PUT", {
          ...settings,
          customThemes: { poor: { ...campus, cardText: "#ffffff" } },
        })
      ).response.status,
      422,
    );
    settings = {
      ...settings,
      customThemes: { campus },
      defaultTheme: "campus",
    };
    await ok(base + "appearance", "PUT", settings);
    const campusCard = await ok(base + "cards", "POST", { person_id: fresh });
    const campusSnapshot = await transaction(
      async (c) =>
        (
          await c.query("SELECT snapshot FROM card_renders WHERE id=$1", [
            campusCard.render_id,
          ])
        ).rows[0].snapshot,
      visualOrg,
    );
    assert.equal(
      campusSnapshot._document.front.find((e: any) => e.fieldKey === "name")
        .fontFamily,
      "DejaVu Serif",
    );
    assert.ok(
      !campusSnapshot._document.front.some((e: any) => e.fieldKey === "email"),
    );
    assert.ok(
      campusSnapshot._document.front.some(
        (e: any) => e.fieldKey === "department",
      ),
    );
    const visitorDefault = (
      await ok(base + "appearance", "POST", {
        kind: "visitor",
        layout: "modern",
        theme: "campus",
      })
    ).id;
    await ok(base + "templates/" + visitorDefault, "PUT", { is_default: true });
    assert.equal(
      (await ok(base + "appearance")).defaults.visitor,
      visitorDefault,
    );
    assert.equal(
      (await ok(base + "appearance")).defaults.staff,
      defaults.staff,
    );
    const designerPassword = randomBytes(20).toString("hex");
    await ok(base + "members", "POST", {
      email: "designer-themes@example.test",
      password: designerPassword,
      role: "DESIGNER",
    });
    await db().query(
      "UPDATE users SET must_change_password=false WHERE email=$1",
      ["designer-themes@example.test"],
    );
    const signed = await call("auth/login", "POST", {
      email: "designer-themes@example.test",
      password: designerPassword,
    });
    const session = {
      cookie: signed.response.headers.get("set-cookie")!.split(";")[0],
      csrf: signed.data.csrf,
    };
    assert.equal(
      (
        await call(
          base + "templates/" + visitorDefault,
          "PUT",
          { is_default: true },
          false,
          session,
        )
      ).response.status,
      403,
    );
    await ok(base + "templates/" + visitorDefault, "PUT", { archived: true });
    assert.equal((await ok(base + "appearance")).defaults.visitor, undefined);
    await ok(`branding?org=${visualOrg}`, "PUT", {
      name: "iD card",
      resetLogo: true,
    });
    assert.equal(
      (
        await handle(new Request(origin + "/api/branding/logo"), [
          "branding",
          "logo",
        ])
      ).status,
      404,
    );
  },
);

test(
  "admin purge previews, role checks, immutable receipts and durable render cleanup",
  { timeout: 90000 },
  async () => {
    const purgeOrg = (
        await ok("orgs", "POST", { name: "Purge College", code: "PURGECTRL" })
      ).id,
      base = `orgs/${purgeOrg}/`,
      route = base + "retention";
    const foreignOrg =
      otherOrg ||
      (
        await ok("orgs", "POST", {
          name: "Other purge tenant",
          code: "OTHERPURGE",
        })
      ).id;
    async function member(role: string) {
      const email = role.toLowerCase() + "-purge@example.test",
        password = randomBytes(24).toString("hex");
      await ok(base + "members", "POST", { email, password, role });
      await db().query(
        "UPDATE users SET must_change_password=false WHERE email=$1",
        [email],
      );
      const signed = await call("auth/login", "POST", { email, password });
      return {
        cookie: signed.response.headers.get("set-cookie")!.split(";")[0],
        csrf: signed.data.csrf,
      };
    }
    const admin = await member("ORG_ADMIN");
    for (const role of ["OPERATOR", "VIEWER", "DESIGNER"]) {
      const session = await member(role);
      assert.equal(
        (await call(route, "GET", undefined, false, session)).response.status,
        403,
      );
      assert.equal(
        (
          await call(
            route,
            "POST",
            {
              action: "preview",
              kind: "audit",
              before: new Date().toISOString(),
            },
            false,
            session,
          )
        ).response.status,
        403,
      );
    }
    assert.equal(
      (
        await call(
          `orgs/${foreignOrg}/retention`,
          "GET",
          undefined,
          false,
          admin,
        )
      ).response.status,
      403,
    );
    assert.equal(
      (
        await call(
          route,
          "POST",
          {
            action: "preview",
            kind: "audit",
            before: new Date().toISOString(),
          },
          false,
          { ...admin, csrf: "wrong" },
        )
      ).response.status,
      403,
    );
    assert.equal(
      (
        await call(
          route,
          "POST",
          {
            action: "preview",
            kind: "audit",
            before: new Date(Date.now() + 86400000).toISOString(),
          },
          false,
          admin,
        )
      ).response.status,
      422,
    );
    const doc = templateSchema.parse({
      schemaVersion: 1,
      width: 85.6,
      height: 53.98,
      front: [
        elementSchema.parse({
          id: randomUUID(),
          type: "text",
          x: 4,
          y: 4,
          width: 70,
          height: 15,
          text: "{{name}}",
        }),
      ],
      back: [
        elementSchema.parse({
          id: randomUUID(),
          type: "text",
          x: 4,
          y: 4,
          width: 70,
          height: 15,
          text: "Back side",
        }),
      ],
    });
    const t = (
      await ok(base + "templates", "POST", {
        name: "Purge test",
        document: doc,
      })
    ).id;
    const p = (
      await ok(base + "people", "POST", {
        name: "Purge test person",
        external_id: "PURGE001",
      })
    ).id;
    const first = await ok(base + "cards", "POST", {
      person_id: p,
      template_id: t,
    });
    const r = await transaction(
      async (c) =>
        (
          await c.query(
            "SELECT r.*,a.storage_key,a.thumbnail_key FROM card_renders r JOIN assets a ON a.id=r.front_asset_id WHERE r.id=$1",
            [first.render_id],
          )
        ).rows[0],
      purgeOrg,
    );
    await assert.rejects(
      transaction(
        (c) =>
          c.query("DELETE FROM card_renders WHERE id=$1", [first.render_id]),
        purgeOrg,
      ),
      /immutable/,
    );
    await assert.rejects(
      transaction(
        (c) =>
          c.query(
            "UPDATE card_renders SET renderer_version='changed' WHERE id=$1",
            [first.render_id],
          ),
        purgeOrg,
      ),
      /immutable/,
    );
    const image = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "#cccccc" },
    })
      .png()
      .toBuffer();
    const photoAsset = (
      await ok(base + "assets?kind=PHOTO", "POST", image, true)
    ).id;
    const exp = (
      await ok(base + "exports", "POST", {
        render_ids: [first.render_id],
        options: { format: "png" },
        request_key: randomUUID(),
      })
    ).id;
    await runExport(purgeOrg, exp);
    assert.equal((await waitJob("exports", exp, purgeOrg)).status, "COMPLETED");
    const before = new Date().toISOString();
    const previewResponse = await call(
      route,
      "POST",
      { action: "preview", kind: "renders", before },
      false,
      admin,
    );
    assert.equal(
      previewResponse.response.status,
      200,
      JSON.stringify(previewResponse.data),
    );
    let preview = previewResponse.data;
    assert.equal(preview.summary.renders, 1);
    assert.equal(preview.summary.exportJobs, 1);
    assert.equal(preview.summary.renderAssets, 2);
    assert.equal(
      (
        await call(
          route,
          "POST",
          { action: "confirm", id: preview.id, confirmation: "yes" },
          false,
          admin,
        )
      ).response.status,
      400,
    );
    assert.equal(
      (
        await call(route, "POST", {
          action: "confirm",
          id: preview.id,
          confirmation: "PURGE",
        })
      ).response.status,
      404,
    );
    const extraExport = await ok(base + "exports", "POST", {
      render_ids: [first.render_id],
      options: { format: "png" },
      request_key: randomUUID(),
    });
    await runExport(purgeOrg, extraExport.id);
    assert.equal(
      (await waitJob("exports", extraExport.id, purgeOrg)).status,
      "COMPLETED",
    );
    assert.equal(
      (
        await call(
          route,
          "POST",
          { action: "confirm", id: preview.id, confirmation: "PURGE" },
          false,
          admin,
        )
      ).response.status,
      409,
    );
    preview = (
      await call(
        route,
        "POST",
        { action: "preview", kind: "renders", before },
        false,
        admin,
      )
    ).data;
    assert.equal(preview.summary.exportJobs, 2);
    await transaction(
      (c) =>
        c.query(
          "UPDATE assets SET storage_key='generated/../outside.png' WHERE id=$1",
          [r.front_asset_id],
        ),
      purgeOrg,
    );
    assert.equal(
      (
        await call(
          route,
          "POST",
          { action: "confirm", id: preview.id, confirmation: "PURGE" },
          false,
          admin,
        )
      ).response.status,
      400,
    );
    assert.ok(await readFile(storagePath(r.storage_key)));
    assert.equal(
      Number(
        (
          await transaction(
            (c) =>
              c.query("SELECT count(*) FROM card_renders WHERE id=$1", [
                first.render_id,
              ]),
            purgeOrg,
          )
        ).rows[0].count,
      ),
      1,
    );
    await transaction(
      (c) =>
        c.query("UPDATE assets SET storage_key=$1 WHERE id=$2", [
          r.storage_key,
          r.front_asset_id,
        ]),
      purgeOrg,
    );
    const second = await ok(base + "cards", "POST", {
      person_id: p,
      template_id: t,
    });
    const purged = await call(
      route,
      "POST",
      { action: "confirm", id: preview.id, confirmation: "PURGE" },
      false,
      admin,
    );
    assert.equal(purged.response.status, 200, JSON.stringify(purged.data));
    assert.equal(
      (await call(base + "renders/" + first.render_id)).response.status,
      404,
    );
    assert.equal(
      (await call(base + "renders/" + second.render_id)).response.status,
      200,
    );
    assert.equal((await ok(base + "cards")).length, 2);
    assert.equal((await ok(base + "people")).total, 1);
    assert.ok(
      (await ok(base + "assets")).some(
        (a: { id: string }) => a.id === photoAsset,
      ),
    );
    assert.equal(
      (await call(base + "exports/" + exp + "/download")).response.status,
      404,
    );
    // Cleanup is asynchronous: the real worker may already hold these rows via SKIP LOCKED.
    for (let attempt = 0; attempt < 50; attempt++) {
      await cleanupPurgeFiles();
      const pending = await transaction(
        (c) =>
          c.query("SELECT count(*) FROM purge_files WHERE organization_id=$1", [
            purgeOrg,
          ]),
        purgeOrg,
      );
      if (Number(pending.rows[0].count) === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await assert.rejects(readFile(storagePath(r.storage_key)), /ENOENT/);
    await assert.rejects(readFile(storagePath(r.thumbnail_key)), /ENOENT/);
    const replay = await call(
      route,
      "POST",
      { action: "confirm", id: preview.id, confirmation: "PURGE" },
      false,
      admin,
    );
    assert.equal(replay.response.status, 200);
    await assert.rejects(
      transaction(
        (c) => c.query("DELETE FROM purge_requests WHERE id=$1", [preview.id]),
        purgeOrg,
      ),
      /immutable/,
    );
    const expired = await call(
      route,
      "POST",
      { action: "preview", kind: "audit", before: new Date().toISOString() },
      false,
      admin,
    );
    await transaction(
      (c) =>
        c.query(
          "UPDATE purge_requests SET expires_at=now()-interval '1 second' WHERE id=$1",
          [expired.data.id],
        ),
      purgeOrg,
    );
    assert.equal(
      (
        await call(
          route,
          "POST",
          { action: "confirm", id: expired.data.id, confirmation: "PURGE" },
          false,
          admin,
        )
      ).response.status,
      409,
    );
    const auditPreview = await call(
      route,
      "POST",
      { action: "preview", kind: "audit", before: new Date().toISOString() },
      false,
      admin,
    );
    assert.ok(auditPreview.data.summary.auditEntries > 0);
    assert.equal(
      (
        await call(
          route,
          "POST",
          {
            action: "confirm",
            id: auditPreview.data.id,
            confirmation: "PURGE",
          },
          false,
          admin,
        )
      ).response.status,
      200,
    );
    const events = await ok(base + "audit");
    assert.ok(
      events.every((e: { action: string }) => e.action === "retention.purge"),
    );
    assert.equal(events.length, 2);
    await assert.rejects(
      transaction(
        (c) =>
          c.query("DELETE FROM audit_events WHERE organization_id=$1", [
            purgeOrg,
          ]),
        purgeOrg,
      ),
      /immutable/,
    );
    const exportOnly = await ok(base + "exports", "POST", {
      render_ids: [second.render_id],
      options: { format: "png" },
      request_key: randomUUID(),
    });
    await runExport(purgeOrg, exportOnly.id);
    assert.equal(
      (await waitJob("exports", exportOnly.id, purgeOrg)).status,
      "COMPLETED",
    );
    const jobSelection = {
      action: "preview",
      kind: "jobs",
      before: new Date().toISOString(),
    };
    const jobPreviewA = (await call(route, "POST", jobSelection, false, admin))
      .data;
    const jobPreviewB = (await call(route, "POST", jobSelection, false, admin))
      .data;
    assert.equal(jobPreviewA.summary.generationJobs, 0);
    assert.equal(jobPreviewA.summary.exportJobs, 1);
    assert.equal(
      (
        await call(
          route,
          "POST",
          { action: "confirm", id: jobPreviewA.id, confirmation: "PURGE" },
          false,
          admin,
        )
      ).response.status,
      200,
    );
    assert.equal(
      (
        await call(
          route,
          "POST",
          { action: "confirm", id: jobPreviewB.id, confirmation: "PURGE" },
          false,
          admin,
        )
      ).response.status,
      409,
    );
    const generation = await ok(base + "generation", "POST", {
      person_ids: [p],
      template_id: t,
      request_key: randomUUID(),
    });
    assert.equal(
      (
        await call(
          route,
          "POST",
          {
            action: "preview",
            kind: "renders",
            before: new Date().toISOString(),
          },
          false,
          admin,
        )
      ).response.status,
      409,
    );
    await runGeneration(purgeOrg, generation.id);
    assert.equal(
      (await waitJob("generation", generation.id, purgeOrg)).status,
      "COMPLETED",
    );
    const jobsPreview = await call(
      route,
      "POST",
      { action: "preview", kind: "jobs", before: new Date().toISOString() },
      false,
      admin,
    );
    assert.equal(jobsPreview.data.summary.generationJobs, 1);
    assert.equal(
      (
        await call(
          route,
          "POST",
          { action: "confirm", id: jobsPreview.data.id, confirmation: "PURGE" },
          false,
          admin,
        )
      ).response.status,
      200,
    );
    assert.equal((await ok(base + "generation")).length, 0);
    assert.equal((await ok(base + "cards")).length, 3);
    assert.equal(
      (
        await call(base + `cards/${first.id}/reissue`, "POST", {
          request_key: randomUUID(),
        })
      ).response.status,
      422,
    );
    const replacement = await ok(base + `cards/${first.id}/reissue`, "POST", {
      request_key: randomUUID(),
      template_id: t,
    });
    assert.ok(replacement.render_id);
    assert.notEqual(replacement.id, first.id);
    await transaction(
      (c) =>
        c.query(
          "INSERT INTO audit_events(id,organization_id,action,created_at) SELECT gen_random_uuid(),$1,'retention.fixture','2000-01-01'::timestamptz FROM generate_series(1,1001)",
          [purgeOrg],
        ),
      purgeOrg,
    );
    const limited = await call(
      route,
      "POST",
      { action: "preview", kind: "audit", before: "2001-01-01T00:00:00.000Z" },
      false,
      admin,
    );
    assert.equal(limited.data.summary.auditEntries, 1000);
    assert.equal(limited.data.moreAvailable, true);
    assert.equal(
      (
        await call(
          route,
          "POST",
          { action: "confirm", id: limited.data.id, confirmation: "PURGE" },
          false,
          admin,
        )
      ).response.status,
      200,
    );
    const remaining = await call(
      route,
      "POST",
      { action: "preview", kind: "audit", before: "2001-01-01T00:00:00.000Z" },
      false,
      admin,
    );
    assert.equal(remaining.data.summary.auditEntries, 1);
    assert.equal(remaining.data.moreAvailable, false);
    const token = await ok(base + "tokens", "POST", {
      name: "Admin purge forbidden token",
      scopes: ["read"],
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });
    const tokenResponse = await handle(
      new Request(origin + "/api/" + route, {
        headers: { authorization: "Bearer " + token.token },
      }),
      route.split("/"),
    );
    assert.equal(tokenResponse.status, 403);
  },
);
