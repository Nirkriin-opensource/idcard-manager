import { framePortrait } from "./face-framing.ts";
import { bulkRecords } from "./bulk-records.ts";
import { photoMatches } from "./photo-matching.ts";
import { timeSettingsRoute, getTimeSettings } from "./time-settings.ts";
import { toWallTime } from "./organization-time.ts";
import {
  collectionAdminRoute,
  collectionPublicRoute,
} from "./collection-forms.ts";
import { createSharedTemplate } from "./appearance.ts";
import { templateForPerson, customFieldBindings } from "./template.ts";
import { locationFields } from "./locations.ts";
import { retentionRoute } from "./retention.ts";
import { recycleBinRoute } from "./recycle-bin.ts";
import { retentionLock } from "./retention-lock.ts";
import { advancedRoute } from "./workflows-api.ts";
import { APP_VERSION } from "./version.ts";
import { verifyCard, rateLimit } from "./verification.ts";
import { generateCard } from "./cards.ts";
import { randomUUID, randomBytes } from "node:crypto";
import argon2 from "argon2";
import { z } from "zod";
import type pg from "pg";
import { actor, tenant, login, audit, digest } from "./auth.ts";
import { db, transaction } from "./db.ts";
import { config } from "./config.ts";
import { AppError, failure } from "./errors.ts";
import { personSchema, validateFields } from "./people.ts";
import { templateSchema } from "./template.ts";
import { assetBytes, storeImage, storageHealthy } from "./storage.ts";
import { renderSide, RENDERER_VERSION } from "./render.ts";
import { stageImport, validateImport, csvCell, zipEntries } from "./imports.ts";
import ExcelJS from "exceljs";
import { uploadTemplate } from "./upload-templates.ts";
import {
  cardTypeSchema,
  profileSettings,
  parsePolicy,
  saveProfile,
  profileTemplate,
  validateProfilePerson,
  useGeneralCardType,
  cardProfileValues,
} from "./card-profiles.ts";
import { numberingSchema, cardNumber } from "./numbering.ts";
import {
  getAppearance,
  saveAppearance,
  createStylePreset,
  resolveStyle,
  defaultTemplate,
} from "./appearance.ts";
import { applyCardTheme } from "./themes.ts";
import {
  publicFontCatalog,
  syncPcFonts,
  importFont,
  fontById,
} from "./font-library.ts";
import { readFile as readFontFile } from "node:fs/promises";

const uuid = z.uuid();
export async function limitedBody(req: Request, max = 1024 * 1024) {
  if (Number(req.headers.get("content-length") || 0) > max)
    throw new AppError(
      413,
      "Upload exceeds the request limit.",
      "Split the upload into smaller batches.",
    );
  const reader = req.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  let size = 0;
  const chunks: Buffer[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new AppError(
        413,
        "Upload exceeds the request limit.",
        "Split the upload into smaller batches.",
      );
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
const json = async (req: Request) =>
  JSON.parse((await limitedBody(req)).toString("utf8"));
const result = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const missing = () => {
  throw new AppError(
    404,
    "Record or endpoint not found.",
    "Refresh the list and choose an existing record.",
  );
};
async function one(c: pg.PoolClient, sql: string, args: unknown[]) {
  const q = await c.query(sql, args);
  if (!q.rowCount) missing();
  return q.rows[0];
}
async function units(c: pg.PoolClient, org: string, id: string, ids: string[]) {
  await c.query(
    "DELETE FROM person_units WHERE person_id=$1 AND organization_id=$2",
    [id, org],
  );
  for (const unit of ids)
    await c.query(
      "INSERT INTO person_units(organization_id,person_id,unit_id) VALUES($1,$2,$3)",
      [org, id, unit],
    );
}
export async function handle(req: Request, segments: string[]) {
  try {
    return await dispatch(req, segments);
  } catch (e) {
    if (e instanceof SyntaxError)
      return result(
        {
          error: "Request contains invalid JSON.",
          fix: "Send a valid JSON object.",
        },
        400,
      );
    const f = failure(e);
    return result(f.body, f.status);
  }
}
async function dispatch(req: Request, p: string[]): Promise<Response> {
  const url = new URL(req.url),
    method = req.method;
  if (p.join("/") === "health/ready" && method === "GET") {
    try {
      const check = await db().query(
        "SELECT EXISTS(SELECT 1 FROM worker_heartbeats WHERE name='main' AND seen_at>now()-interval '90 seconds') AND EXISTS(SELECT 1 FROM schema_migrations WHERE name='010_recycle_purge.sql') AND to_regclass('pgboss.job') IS NOT NULL AND to_regclass('app_branding') IS NOT NULL AS ready",
      );
      if (check.rows[0].ready) return result({ status: "ready" });
    } catch {}
    return result(
      {
        status: "not-ready",
        fix: "Wait for startup; run idcardctl doctor if readiness does not recover.",
      },
      503,
    );
  }
  if (p.join("/") === "health/live" && method === "GET")
    return result({ application: "running", version: APP_VERSION });
  if (p.join("/") === "auth/login" && method === "POST") {
    if (req.headers.get("origin") !== config().origin)
      throw new AppError(
        403,
        "Sign-in origin is invalid.",
        "Use the configured application URL.",
      );
    await rateLimit(
      "login-ip:" +
        (req.headers.get("x-forwarded-for")?.split(",")[0] || "local"),
      30,
      300,
    );
    const data = z
      .object({ email: z.email(), password: z.string().min(1).max(256) })
      .parse(await json(req));
    // Caddy overwrites this header; never expose Next.js directly on a public interface.
    const s = await login(
      data.email,
      data.password,
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local",
    );
    return Response.json(
      { csrf: s.csrf },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": `idcard_session=${s.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${config().secure ? "; Secure" : ""}`,
        },
      },
    );
  }
  if (p[0] === "verify" && method === "GET") {
    await rateLimit(
      "verify:" +
        (req.headers.get("x-forwarded-for")?.split(",")[0] || "local"),
      60,
      60,
    );
    return result(await verifyCard(p[1] || ""));
  }
  if (p[0] === "branding" && method === "GET") {
    const branding = (
      await db().query("SELECT * FROM app_branding WHERE singleton=true")
    ).rows[0];
    if (p[1] === "logo") {
      if (!branding.logo_asset_id) return missing();
      const bytes = await transaction(
        (c) => assetBytes(c, branding.organization_id, branding.logo_asset_id),
        branding.organization_id,
      );
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    return result({
      name: branding.name,
      logo: branding.logo_asset_id
        ? "/api/branding/logo?v=" + new Date(branding.updated_at).getTime()
        : null,
    });
  }
  const publicForm = await collectionPublicRoute(req, p, async () =>
    JSON.parse((await limitedBody(req, 12 * 1024 * 1024)).toString("utf8")),
  );
  if (publicForm) return publicForm;
  const a = await actor(req);
  await rateLimit("api:" + a.id, 600, 60);
  if (p.join("/") === "auth/me" && method === "GET") return result(a);
  if (p.join("/") === "auth/logout" && method === "POST") {
    const cookie =
      (req.headers.get("cookie") || "")
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("idcard_session="))
        ?.slice(15) || "";
    await db().query("DELETE FROM sessions WHERE token_hash=$1", [
      digest(cookie),
    ]);
    return Response.json(
      { ok: true },
      {
        headers: {
          "Set-Cookie":
            "idcard_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
        },
      },
    );
  }
  if (p.join("/") === "auth/password" && method === "POST") {
    const data = z
      .object({
        current: z.string().max(256),
        password: z.string().min(14).max(256),
      })
      .parse(await json(req));
    const user = (
      await db().query("SELECT password_hash FROM users WHERE id=$1", [a.id])
    ).rows[0];
    if (!(await argon2.verify(user.password_hash, data.current)))
      throw new AppError(
        403,
        "Current password is incorrect.",
        "Enter the password used to sign in.",
      );
    await transaction(async (c) => {
      await c.query(
        "UPDATE users SET password_hash=$1,must_change_password=false WHERE id=$2",
        [await argon2.hash(data.password, { type: argon2.argon2id }), a.id],
      );
      await c.query("DELETE FROM sessions WHERE user_id=$1", [a.id]);
    });
    return result({ ok: true, signInAgain: true });
  }
  if (a.must_change_password)
    throw new AppError(
      403,
      "Change your temporary password first.",
      "Use the password change form.",
    );
  if (p[0] === "fonts") {
    if (method === "GET" && p[1] === "file") {
      const font = await fontById(p[2]);
      return new Response(new Uint8Array(await readFontFile(font.file)), {
        headers: {
          "Content-Type": font.file.endsWith(".ttc")
            ? "font/collection"
            : font.file.endsWith(".otf")
              ? "font/otf"
              : "font/ttf",
          "Cache-Control": "private, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (method === "GET") return result(await publicFontCatalog());
    if (!a.super_admin || a.tokenOrg)
      throw new AppError(
        403,
        "Font changes require a signed-in Super Admin.",
        "Ask the application administrator.",
      );
    if (method !== "POST")
      throw new AppError(405, "Method not supported.", "Use GET or POST.");
    const org = uuid.parse(url.searchParams.get("org"));
    return tenant(a, org, "admin", async (c) => {
      const output =
        p[1] === "sync"
          ? await syncPcFonts()
          : await importFont(
              await limitedBody(req, 40 * 1024 * 1024),
              url.searchParams.get("filename") || "font.ttf",
            );
      await audit(c, a, org, p[1] === "sync" ? "fonts.sync" : "fonts.upload");
      return result(output);
    });
  }
  if (p[0] === "branding") {
    if (!a.super_admin || a.tokenOrg)
      throw new AppError(
        403,
        "Application branding requires a signed-in Super Admin.",
        "Ask the application administrator.",
      );
    const org = uuid.parse(url.searchParams.get("org"));
    return tenant(a, org, "admin", async (c) => {
      if (method === "POST") {
        const name = z
          .string()
          .trim()
          .min(1)
          .max(60)
          .parse(url.searchParams.get("name") || "iD card");
        const logo = await storeImage(
          c,
          org,
          await limitedBody(req, 12 * 1024 * 1024),
          "LOGO",
        );
        await c.query(
          "UPDATE app_branding SET name=$1,organization_id=$2,logo_asset_id=$3,updated_at=now() WHERE singleton=true",
          [name, org, logo.id],
        );
      } else if (method === "PUT") {
        const d = z
          .object({
            name: z.string().trim().min(1).max(60),
            resetLogo: z.boolean().default(false),
          })
          .parse(await json(req));
        await c.query(
          "UPDATE app_branding SET name=$1,organization_id=CASE WHEN $2 THEN NULL ELSE organization_id END,logo_asset_id=CASE WHEN $2 THEN NULL ELSE logo_asset_id END,updated_at=now() WHERE singleton=true",
          [d.name, d.resetLogo],
        );
      } else
        throw new AppError(
          405,
          "Method not supported.",
          "Use GET, POST or PUT.",
        );
      await audit(c, a, org, "application.branding");
      return result({ ok: true });
    });
  }
  if (p.join("/") === "system/health" && method === "GET") {
    if (!a.super_admin)
      throw new AppError(
        403,
        "System health requires Super Admin.",
        "Ask your server administrator.",
      );
    const checks: Record<string, unknown> = {
      Application: { ok: true, version: APP_VERSION },
    };
    try {
      await db().query("SELECT 1");
      checks.Database = { ok: true };
    } catch {
      checks.Database = {
        ok: false,
        fix: "Check PostgreSQL and DATABASE_URL.",
      };
    }
    try {
      await storageHealthy();
      checks.Storage = { ok: true };
    } catch {
      checks.Storage = {
        ok: false,
        fix: "Check STORAGE_ROOT ownership and free disk space.",
      };
    }
    const h = await db().query(
      "SELECT seen_at,seen_at>now()-interval '90 seconds' AS healthy FROM worker_heartbeats WHERE name='main'",
    );
    checks.Worker = {
      ok: h.rows[0]?.healthy || false,
      lastSeen: h.rows[0]?.seen_at,
      fix: "Restart idcard-worker and inspect its journal if stale.",
    };
    const m = await db().query(
      "SELECT name,applied_at FROM schema_migrations ORDER BY name",
    );
    checks.Migrations = {
      ok: m.rows.some((r) => r.name === "010_recycle_purge.sql"),
      applied: m.rows,
    };
    try {
      const q = await db().query(
        "SELECT to_regclass('pgboss.job') IS NOT NULL AS exists",
      );
      checks.Queue = { ok: q.rows[0].exists };
    } catch {
      checks.Queue = {
        ok: false,
        fix: "Start the worker to initialize pg-boss.",
      };
    }
    return result(checks);
  }
  if (p[0] === "orgs" && p[2] === "retention" && p.length === 3)
    return retentionRoute(req, a, uuid.parse(p[1]), () => json(req));
  if (p[0] === "orgs" && p[2] === "recycle-bin" && p.length === 3)
    return recycleBinRoute(req, a, uuid.parse(p[1]), () => json(req));
  const organizationTime = await timeSettingsRoute(req, p, a, () => json(req));
  if (organizationTime) return organizationTime;
  const form = await collectionAdminRoute(req, p, a, () => json(req));
  if (form) return form;
  const advanced = await advancedRoute(req, p, a, () => json(req));
  if (advanced) return advanced;
  if (p[0] !== "orgs") return missing();
  if (p.length === 1) {
    if (method === "GET")
      return result(
        a.super_admin
          ? (await db().query("SELECT * FROM organizations ORDER BY name")).rows
          : (
              await db().query(
                "SELECT o.*,m.role FROM organizations o JOIN memberships m ON m.organization_id=o.id WHERE m.user_id=$1 ORDER BY o.name",
                [a.id],
              )
            ).rows,
      );
    if (method === "POST") {
      if (!a.super_admin)
        throw new AppError(
          403,
          "Creating organizations requires Super Admin.",
          "Ask a Super Admin to create the organization.",
        );
      const data = z
          .object({
            name: z.string().trim().min(1).max(200),
            code: z.string().regex(/^[A-Z0-9_-]{1,20}$/),
          })
          .parse(await json(req)),
        id = randomUUID();
      await transaction(async (c) => {
        await c.query(
          "INSERT INTO organizations(id,name,code) VALUES($1,$2,$3)",
          [id, data.name, data.code],
        );
        await c.query("SELECT set_config('app.org_id',$1,true)", [id]);
        await c.query(
          "INSERT INTO number_sequences(organization_id,prefix) VALUES($1,$2)",
          [id, data.code],
        );
        await audit(c, a, id, "organization.create", id);
      });
      return result({ id }, 201);
    }
  }
  const org = uuid.parse(p[1]),
    resource = p[2],
    id = p[3] ? uuid.parse(p[3]) : undefined;
  const permission =
    resource === "bulk-records" ||
    (resource === "assets" && url.searchParams.get("deleted") === "only")
      ? "admin"
      : resource === "people" &&
          (method === "DELETE" ||
            p[4] === "restore" ||
            url.searchParams.get("deleted") === "only")
        ? "admin"
        : resource === "upload-templates"
          ? "people"
          : method === "GET"
            ? "read"
            : ["templates", "codes", "preview"].includes(resource)
              ? "design"
              : [
                    "members",
                    "fields",
                    "units",
                    "numbering",
                    "card-profiles",
                    "appearance",
                  ].includes(resource)
                ? "admin"
                : resource === "cards"
                  ? "generate"
                  : resource === "assets"
                    ? "asset"
                    : "people";
  return tenant(a, org, permission, async (c) => {
    if (method !== "GET") await retentionLock(c, org);
    if (resource === "bulk-records" && method === "POST" && !id)
      return result(await bulkRecords(c, org, a, await json(req)));
    if (resource === "appearance") {
      if (method === "GET") return result(await getAppearance(c, org));
      if (method === "PUT") {
        const saved = await saveAppearance(c, org, await json(req));
        await audit(c, a, org, "appearance.update");
        return result(saved);
      }
      if (method === "POST") {
        const d = z
          .object({
            shared: z.boolean().optional(),
            general: z.boolean().optional(),
            kind: cardTypeSchema.optional(),
            layout: z.enum(["classic", "vertical", "modern"]).optional(),
            theme: z.string().max(40).optional(),
          })
          .parse(await json(req));
        if (d.shared) {
          const preset = await createSharedTemplate(c, org, d.theme, d.general);
          await audit(c, a, org, "appearance.shared-template", preset.id);
          return result(preset, 201);
        }
        const preset = await createStylePreset(
          c,
          org,
          cardTypeSchema.parse(d.kind),
          z.enum(["classic", "vertical", "modern"]).parse(d.layout),
          d.theme,
        );
        await audit(c, a, org, "appearance.preset", preset.id);
        return result(preset, 201);
      }
      throw new AppError(405, "Method not supported.", "Use GET, PUT or POST.");
    }
    if (resource === "card-profiles") {
      if (method === "GET") return result(await profileSettings(c, org));
      if (!["PUT", "POST"].includes(method))
        throw new AppError(
          405,
          "Method not supported.",
          "Use GET, PUT or POST.",
        );
      const d = await json(req),
        kind = cardTypeSchema.parse(d.kind),
        policy = parsePolicy(kind, d.policy);
      await saveProfile(c, org, kind, policy);
      if (method === "POST") {
        const tid = randomUUID(),
          document = profileTemplate(kind, policy);
        await c.query(
          "INSERT INTO templates(id,organization_id,name) VALUES($1,$2,$3)",
          [tid, org, `${kind} — full field preset`],
        );
        await c.query(
          "INSERT INTO template_versions(id,organization_id,template_id,version,document) VALUES($1,$2,$3,1,$4)",
          [randomUUID(), org, tid, JSON.stringify(document)],
        );
        await audit(c, a, org, "card-profile.template", tid);
        return result({ id: tid }, 201);
      }
      await audit(c, a, org, "card-profile.configure");
      return result({ ok: true });
    }
    if (resource === "upload-templates" && method === "GET") {
      const kind = z
        .enum(["people", "photos", "kit", "requirements"])
        .parse(new URL(req.url).searchParams.get("kind") || "people");
      const profile = new URL(req.url).searchParams.get("profile");
      return uploadTemplate(
        c,
        org,
        kind,
        profile ? cardTypeSchema.parse(profile) : undefined,
        new URL(req.url).searchParams.get("template_id")
          ? uuid.parse(new URL(req.url).searchParams.get("template_id"))
          : undefined,
        new URL(req.url).searchParams.get("general") === "1",
      );
    }
    if (resource === "numbering") {
      if (method === "GET")
        return result(
          await one(
            c,
            "SELECT prefix,pattern,padding,next_value FROM number_sequences WHERE organization_id=$1",
            [org],
          ),
        );
      if (method === "PUT") {
        const d = numberingSchema.parse(await json(req));
        const old = await one(
          c,
          "SELECT next_value FROM number_sequences WHERE organization_id=$1 FOR UPDATE",
          [org],
        );
        if (BigInt(d.start) < BigInt(old.next_value))
          throw new AppError(
            409,
            "Sequence cannot move backwards.",
            "Choose a start value at least equal to the current next value.",
          );
        await c.query(
          "UPDATE number_sequences SET prefix=$1,pattern=$2,padding=$3,next_value=$4 WHERE organization_id=$5",
          [d.prefix, d.pattern, d.padding, d.start, org],
        );
        await audit(c, a, org, "numbering.update");
        return result({ ok: true });
      }
    }
    if (resource === "members") {
      if (method === "GET") {
        if (!a.super_admin) {
          const own = await c.query(
            "SELECT 1 FROM memberships WHERE user_id=$1 AND organization_id=$2 AND role='ORG_ADMIN'",
            [a.id, org],
          );
          if (!own.rowCount)
            throw new AppError(
              403,
              "Member list requires Org Admin.",
              "Ask an administrator.",
            );
        }
        return result(
          (
            await c.query(
              "SELECT u.id,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE organization_id=$1",
              [org],
            )
          ).rows,
        );
      }
      if (method === "POST") {
        const data = z
          .object({
            email: z.email(),
            role: z.enum(["ORG_ADMIN", "DESIGNER", "OPERATOR", "VIEWER"]),
            password: z.string().min(14).max(256).optional(),
          })
          .parse(await json(req));
        let user = (
          await c.query("SELECT id FROM users WHERE email=$1", [
            data.email.toLowerCase(),
          ])
        ).rows[0];
        if (!user) {
          if (!data.password)
            throw new AppError(
              400,
              "A password is required for a new user.",
              "Enter a temporary password of at least 14 characters.",
            );
          user = { id: randomUUID() };
          await c.query(
            "INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)",
            [
              user.id,
              data.email.toLowerCase(),
              await argon2.hash(data.password),
            ],
          );
        }
        await c.query(
          "INSERT INTO memberships(user_id,organization_id,role) VALUES($1,$2,$3) ON CONFLICT(user_id,organization_id) DO UPDATE SET role=excluded.role",
          [user.id, org, data.role],
        );
        await audit(c, a, org, "membership.assign", user.id);
        return result({ id: user.id });
      }
    }
    if (resource === "units") {
      if (method === "GET")
        return result(
          (
            await c.query(
              "SELECT * FROM org_units WHERE organization_id=$1 ORDER BY kind,name",
              [org],
            )
          ).rows,
        );
      if (method === "POST") {
        const d = z
          .object({
            name: z.string().min(1).max(200),
            code: z.string().min(1).max(40),
            kind: z.enum(["BRANCH", "DEPARTMENT", "CLASS", "SECTION"]),
            parent_id: z.uuid().nullable().default(null),
          })
          .parse(await json(req));
        const newId = randomUUID();
        await c.query(
          "INSERT INTO org_units(id,organization_id,parent_id,kind,name,code) VALUES($1,$2,$3,$4,$5,$6)",
          [newId, org, d.parent_id, d.kind, d.name, d.code],
        );
        return result({ id: newId }, 201);
      }
    }
    if (resource === "fields") {
      if (method === "GET")
        return result(
          (
            await c.query(
              "SELECT * FROM field_definitions WHERE organization_id=$1 ORDER BY label",
              [org],
            )
          ).rows,
        );
      if (method === "POST") {
        const d = z
          .object({
            key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
            label: z.string().min(1).max(100),
            type: z.enum(["text", "number", "date", "boolean"]),
            required: z.boolean().default(false),
            private: z.boolean().default(true),
          })
          .parse(await json(req));
        const fid = randomUUID();
        await c.query(
          "INSERT INTO field_definitions(id,organization_id,key,label,type,required,private) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [fid, org, d.key, d.label, d.type, d.required, d.private],
        );
        return result({ id: fid }, 201);
      }
    }
    if (resource === "people") {
      if (
        id &&
        ((method === "DELETE" && p.length === 4) ||
          (method === "POST" && p[4] === "restore" && p.length === 5))
      ) {
        await one(
          c,
          "SELECT id FROM people WHERE organization_id=$1 AND id=$2 FOR UPDATE",
          [org, id],
        );
        const deleting = method === "DELETE";
        await c.query(
          "UPDATE people SET deleted_at=CASE WHEN $3 THEN COALESCE(deleted_at,now()) ELSE NULL END,updated_at=now() WHERE organization_id=$1 AND id=$2",
          [org, id, deleting],
        );
        await audit(
          c,
          a,
          org,
          deleting ? "person.delete" : "person.restore",
          id,
        );
        return result({ ok: true });
      }
      if (method === "GET") {
        if (id)
          return result(
            await one(
              c,
              "SELECT p.*,COALESCE((SELECT jsonb_agg(unit_id) FROM person_units pu WHERE pu.person_id=p.id),'[]') unit_ids,(SELECT asset_id FROM person_assets pa WHERE pa.person_id=p.id AND slot='photo') photo_asset_id FROM people p WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL",
              [org, id],
            ),
          );
        const values: unknown[] = [org];
        const where = [
          "p.organization_id=$1",
          url.searchParams.get("deleted") === "only"
            ? "p.deleted_at IS NOT NULL"
            : "p.deleted_at IS NULL",
        ];
        for (const key of [
          "name",
          "external_id",
          "phone",
          "email",
          "designation",
          "status",
        ])
          if (url.searchParams.get(key)) {
            values.push(url.searchParams.get(key));
            where.push(
              key === "status"
                ? `p.${key}=$${values.length}`
                : `p.${key} ILIKE '%' || $${values.length} || '%'`,
            );
          }
        if (url.searchParams.get("q")) {
          values.push(url.searchParams.get("q"));
          const n = values.length;
          where.push(
            `(p.name ILIKE '%'||$${n}||'%' OR p.external_id ILIKE '%'||$${n}||'%')`,
          );
        }
        for (const kind of ["BRANCH", "DEPARTMENT", "CLASS", "SECTION"])
          if (url.searchParams.get(kind.toLowerCase())) {
            values.push(url.searchParams.get(kind.toLowerCase()));
            where.push(
              `EXISTS(SELECT 1 FROM person_units pu JOIN org_units u ON pu.unit_id=u.id WHERE pu.person_id=p.id AND u.kind='${kind}' AND u.id::text=$${values.length})`,
            );
          }
        if (url.searchParams.get("card_number")) {
          values.push(url.searchParams.get("card_number"));
          where.push(
            `EXISTS(SELECT 1 FROM cards ca WHERE ca.person_id=p.id AND ca.number ILIKE '%'||$${values.length}||'%')`,
          );
        }
        const page = z.coerce
            .number()
            .int()
            .min(1)
            .max(100000)
            .parse(url.searchParams.get("page") || 1),
          limit = 50;
        const total = (
          await c.query(
            `SELECT count(*) FROM people p WHERE ${where.join(" AND ")}`,
            values,
          )
        ).rows[0].count;
        const rows = await c.query(
          `SELECT p.*,(SELECT asset_id FROM person_assets pa WHERE pa.person_id=p.id AND slot='photo') photo_asset_id FROM people p WHERE ${where.join(" AND ")} ORDER BY p.name,p.id LIMIT 50 OFFSET $${values.length + 1}`,
          [...values, (page - 1) * limit],
        );
        return result({ items: rows.rows, total: Number(total), page, limit });
      }
      if (method === "POST" || method === "PUT") {
        const d = personSchema.parse(await json(req));
        await useGeneralCardType(c, org, d);
        await validateFields(c, org, d.custom_fields);
        await validateProfilePerson(c, org, d, !id);
        const pid = id || randomUUID();
        if (method === "PUT") {
          await one(
            c,
            "SELECT id FROM people WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL",
            [org, pid],
          );
          await c.query(
            "UPDATE people SET external_id=$1,name=$2,email=$3,phone=$4,designation=$5,status=$6,custom_fields=$7,updated_at=now() WHERE organization_id=$8 AND id=$9",
            [
              d.external_id,
              d.name,
              d.email,
              d.phone,
              d.designation,
              d.status,
              JSON.stringify(d.custom_fields),
              org,
              pid,
            ],
          );
        } else
          await c.query(
            "INSERT INTO people(id,organization_id,external_id,name,email,phone,designation,status,custom_fields) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [
              pid,
              org,
              d.external_id,
              d.name,
              d.email,
              d.phone,
              d.designation,
              d.status,
              JSON.stringify(d.custom_fields),
            ],
          );
        await units(c, org, pid, d.unit_ids);
        await audit(
          c,
          a,
          org,
          method === "POST" ? "person.create" : "person.update",
          pid,
        );
        return result({ id: pid }, method === "POST" ? 201 : 200);
      }
    }
    if (resource === "assets") {
      if (method === "GET" && id && url.searchParams.get("face") === "1") {
        const w = z.coerce
            .number()
            .int()
            .min(1)
            .max(600)
            .parse(url.searchParams.get("w")),
          h = z.coerce
            .number()
            .int()
            .min(1)
            .max(600)
            .parse(url.searchParams.get("h"));
        return new Response(
          new Uint8Array(
            await framePortrait(await assetBytes(c, org, id), w, h),
          ),
          {
            headers: {
              "Content-Type": "image/png",
              "Cache-Control": "private, no-store",
            },
          },
        );
      }
      if (method === "GET" && id)
        return new Response(
          new Uint8Array(
            await assetBytes(c, org, id, url.searchParams.get("thumb") === "1"),
          ),
          {
            headers: {
              "Content-Type":
                url.searchParams.get("thumb") === "1"
                  ? "image/jpeg"
                  : "image/png",
              "Cache-Control": "private, no-store",
            },
          },
        );
      if (method === "GET") {
        const offset = z.coerce
          .number()
          .int()
          .min(0)
          .max(1000000)
          .parse(url.searchParams.get("offset") || 0);
        return result(
          (
            await c.query(
              "SELECT id,kind,original_name,width,height,created_at,collection_private,deleted_at FROM assets WHERE organization_id=$1 AND kind<>$2 AND CASE WHEN $4 THEN deleted_at IS NOT NULL AND kind='PHOTO' AND NOT collection_private ELSE deleted_at IS NULL END ORDER BY created_at DESC,id LIMIT 100 OFFSET $3",
              [
                org,
                "RENDER",
                offset,
                url.searchParams.get("deleted") === "only",
              ],
            )
          ).rows,
        );
      }
      if (method === "POST" && id && p[4] === "crop") {
        const crop = z
          .object({
            left: z.number().int().nonnegative(),
            top: z.number().int().nonnegative(),
            width: z.number().int().positive(),
            height: z.number().int().positive(),
          })
          .parse(await json(req));
        const source = await one(
          c,
          "SELECT kind,original_name FROM assets WHERE organization_id=$1 AND id=$2 AND kind<>'RENDER' AND deleted_at IS NULL",
          [org, id],
        );
        const saved = await storeImage(
          c,
          org,
          await assetBytes(c, org, id),
          source.kind,
          crop,
        );
        await c.query("UPDATE assets SET original_name=$1 WHERE id=$2", [
          source.original_name,
          saved.id,
        ]);
        await audit(c, a, org, "asset.crop", saved.id);
        return result(saved, 201);
      }
      if (method === "POST") {
        const kind = z
          .enum(["PHOTO", "IMAGE", "LOGO", "SIGNATURE", "STAMP"])
          .parse(url.searchParams.get("kind") || "PHOTO");
        const crop = url.searchParams.get("crop")
          ? z
              .object({
                left: z.number().int().nonnegative(),
                top: z.number().int().nonnegative(),
                width: z.number().int().positive(),
                height: z.number().int().positive(),
              })
              .parse(JSON.parse(url.searchParams.get("crop")!))
          : undefined;
        const saved = await storeImage(
          c,
          org,
          await limitedBody(req, 12 * 1024 * 1024),
          kind,
          crop,
        );
        const filename = z
          .string()
          .max(200)
          .parse(url.searchParams.get("filename") || "");
        await c.query("UPDATE assets SET original_name=$1 WHERE id=$2", [
          filename,
          saved.id,
        ]);
        let matched = false;
        if (kind === "PHOTO" && filename) {
          const match = url.searchParams.get("match") || "external_id",
            value = filename.replace(/\.[^.]+$/, "");
          const candidates =
            match === "external_id"
              ? await c.query(
                  "SELECT id FROM people WHERE organization_id=$1 AND deleted_at IS NULL AND external_id=$2",
                  [org, value],
                )
              : await c.query(
                  "SELECT id FROM people WHERE organization_id=$1 AND deleted_at IS NULL AND custom_fields->>$2=$3",
                  [org, match, value],
                );
          if (candidates.rowCount === 1) {
            await c.query(
              "INSERT INTO person_assets(organization_id,person_id,slot,asset_id) VALUES($1,$2,'photo',$3) ON CONFLICT(person_id,slot) DO UPDATE SET asset_id=excluded.asset_id",
              [org, candidates.rows[0].id, saved.id],
            );
            matched = true;
          }
        }
        await audit(c, a, org, "asset.upload", saved.id);
        return result({ ...saved, matched }, 201);
      }
    }
    if (resource === "photo-matches" && method === "POST" && !id)
      return result(await photoMatches(c, org, a, await json(req)));
    if (resource === "photos") {
      if (method === "POST" && !id) {
        const filename = url.searchParams.get("filename") || "",
          match = url.searchParams.get("match") || "external_id";
        const zip = await limitedBody(req, 25 * 1024 * 1024),
          results: unknown[] = [];
        await zipEntries(zip, async (name, data) => {
          if (!/\.(png|jpe?g|webp)$/i.test(name)) {
            results.push({
              filename: name,
              error: "Only JPEG, PNG and WebP files are accepted.",
            });
            return;
          }
          const value = name
            .split("/")
            .pop()!
            .replace(/\.[^.]+$/, "");
          const candidates =
            match === "external_id"
              ? await c.query(
                  "SELECT id FROM people WHERE organization_id=$1 AND deleted_at IS NULL AND external_id=$2",
                  [org, value],
                )
              : await c.query(
                  "SELECT id FROM people WHERE organization_id=$1 AND deleted_at IS NULL AND custom_fields->>$2=$3",
                  [org, match, value],
                );
          const saved = await storeImage(c, org, data);
          await c.query("UPDATE assets SET original_name=$1 WHERE id=$2", [
            name.split("/").pop(),
            saved.id,
          ]);
          if (candidates.rowCount === 1)
            await c.query(
              "INSERT INTO person_assets(organization_id,person_id,slot,asset_id) VALUES($1,$2,'photo',$3) ON CONFLICT(person_id,slot) DO UPDATE SET asset_id=excluded.asset_id",
              [org, candidates.rows[0].id, saved.id],
            );
          results.push({
            filename: name,
            asset_id: saved.id,
            matched: candidates.rowCount === 1,
            person_id: candidates.rowCount === 1 ? candidates.rows[0].id : null,
          });
        });
        await audit(c, a, org, "photos.zip");
        return result({ filename, results });
      }
      if (id && method === "PUT") {
        const d = z
          .object({
            asset_id: z.uuid().nullable(),
            slot: z.enum(["photo", "signature"]).default("photo"),
          })
          .parse(await json(req));
        await one(
          c,
          "SELECT id FROM people WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL",
          [org, id],
        );
        if (d.asset_id)
          await one(
            c,
            "SELECT id FROM assets WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL",
            [org, d.asset_id],
          );
        if (d.asset_id)
          await c.query(
            "INSERT INTO person_assets(organization_id,person_id,slot,asset_id) VALUES($1,$2,$3,$4) ON CONFLICT(person_id,slot) DO UPDATE SET asset_id=excluded.asset_id",
            [org, id, d.slot, d.asset_id],
          );
        else
          await c.query(
            "DELETE FROM person_assets WHERE organization_id=$1 AND person_id=$2 AND slot=$3",
            [org, id, d.slot],
          );
        await audit(c, a, org, "photo.match", id);
        return result({ ok: true });
      }
    }
    if (
      resource === "imports" &&
      id &&
      method === "GET" &&
      url.searchParams.get("report") === "xlsx"
    ) {
      await one(
        c,
        "SELECT id FROM import_batches WHERE organization_id=$1 AND id=$2",
        [org, id],
      );
      const rows = (
        await c.query(
          "SELECT row_number,errors FROM import_rows WHERE batch_id=$1 AND errors<>'[]'::jsonb ORDER BY row_number",
          [id],
        )
      ).rows;
      const workbook = new ExcelJS.Workbook(),
        sheet = workbook.addWorksheet("Errors");
      sheet.columns = [
        { header: "Row", key: "row", width: 8 },
        { header: "Field", key: "field", width: 24 },
        { header: "Error", key: "error", width: 60 },
        { header: "Suggested fix", key: "fix", width: 65 },
      ];
      for (const row of rows)
        for (const e of row.errors) sheet.addRow({ row: row.row_number, ...e });
      const bytes = await workbook.xlsx.writeBuffer();
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": 'attachment; filename="import-errors.xlsx"',
        },
      });
    }
    if (resource === "imports") {
      if (method === "POST" && !id)
        return result(
          await stageImport(
            c,
            org,
            await limitedBody(req, 15 * 1024 * 1024),
            z
              .string()
              .max(200)
              .parse(url.searchParams.get("filename") || "import.csv"),
          ),
          201,
        );
      if (method === "GET" && !id)
        return result(
          (
            await c.query(
              "SELECT * FROM import_batches WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 50",
              [org],
            )
          ).rows,
        );
      if (method === "GET" && id) {
        await one(
          c,
          "SELECT id FROM import_batches WHERE organization_id=$1 AND id=$2",
          [org, id],
        );
        if (url.searchParams.get("report") === "csv") {
          const rows = (
            await c.query(
              "SELECT row_number,errors FROM import_rows WHERE batch_id=$1 AND errors<>'[]'::jsonb ORDER BY row_number",
              [id],
            )
          ).rows;
          return new Response(
            "\uFEFFrow,field,error,suggested_fix\r\n" +
              rows
                .flatMap((row) =>
                  row.errors.map(
                    (e: { field: string; error: string; fix: string }) =>
                      [row.row_number, e.field, e.error, e.fix]
                        .map(csvCell)
                        .join(","),
                  ),
                )
                .join("\r\n"),
            {
              headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition":
                  'attachment; filename="import-errors.csv"',
              },
            },
          );
        }
        const offset = z.coerce
          .number()
          .int()
          .min(0)
          .parse(url.searchParams.get("offset") || 0);
        return result(
          (
            await c.query(
              "SELECT row_number,raw,normalized,errors,imported FROM import_rows WHERE batch_id=$1 ORDER BY row_number LIMIT 100 OFFSET $2",
              [id, offset],
            )
          ).rows,
        );
      }
      if (method === "POST" && id && p[4] === "validate") {
        const d = z
          .object({
            mapping: z.record(
              z.string(),
              z
                .string()
                .regex(
                  /^(external_id|name|email|phone|designation|status|custom\.[a-z][a-z0-9_]*)$/,
                ),
            ),
          })
          .parse(await json(req));
        return result(await validateImport(c, org, id, d.mapping));
      }
      if (method === "POST" && id && p[4] === "commit") {
        const batch = await one(
          c,
          "SELECT * FROM import_batches WHERE organization_id=$1 AND id=$2 FOR UPDATE",
          [org, id],
        );
        if (batch.status !== "VALIDATED")
          throw new AppError(
            409,
            "Import is not ready or was already imported.",
            "Validate the mapping before importing.",
          );
        const errors = (
          await c.query(
            "SELECT count(*) FROM import_rows WHERE batch_id=$1 AND errors<>'[]'::jsonb",
            [id],
          )
        ).rows[0].count;
        if (Number(errors))
          throw new AppError(
            409,
            "Import contains validation errors.",
            "Download the report, correct the file and upload it again.",
          );
        const candidates = (
          await c.query(
            "SELECT normalized FROM import_rows WHERE batch_id=$1 ORDER BY row_number",
            [id],
          )
        ).rows;
        for (const row of candidates) {
          await validateFields(c, org, row.normalized.custom_fields);
          await useGeneralCardType(c, org, row.normalized);
          await validateProfilePerson(c, org, row.normalized, true);
        }
        const inserted = await c.query(
          "INSERT INTO people(id,organization_id,external_id,name,email,phone,designation,status,custom_fields) SELECT gen_random_uuid(),organization_id,normalized->>'external_id',normalized->>'name',normalized->>'email',normalized->>'phone',normalized->>'designation',normalized->>'status',normalized->'custom_fields' FROM import_rows WHERE batch_id=$1",
          [id],
        );
        await c.query(
          "UPDATE import_rows SET imported=true WHERE batch_id=$1",
          [id],
        );
        await c.query(
          "UPDATE import_batches SET status='IMPORTED' WHERE id=$1",
          [id],
        );
        await audit(c, a, org, "import.commit", id);
        return result({ imported: inserted.rowCount });
      }
    }
    if (resource === "templates") {
      if (method === "GET" && !id)
        return result(
          (
            await c.query(
              "SELECT t.*,(SELECT max(version) FROM template_versions v WHERE v.template_id=t.id) version,(SELECT CASE WHEN document->>'general'='true' THEN 'general' WHEN document ? 'variants' THEN 'shared' ELSE document->>'cardType' END FROM template_versions v WHERE v.template_id=t.id ORDER BY version DESC LIMIT 1) card_type FROM templates t WHERE organization_id=$1 ORDER BY created_at DESC",
              [org],
            )
          ).rows,
        );
      if (method === "GET" && id) {
        const t = await one(
          c,
          "SELECT * FROM templates WHERE organization_id=$1 AND id=$2",
          [org, id],
        );
        const v = await one(
          c,
          "SELECT * FROM template_versions WHERE template_id=$1 ORDER BY version DESC LIMIT 1",
          [id],
        );
        return result({
          ...t,
          ...v,
          id: t.id,
          version_id: v.id,
          versions: (
            await c.query(
              "SELECT id,version,created_at FROM template_versions WHERE template_id=$1 ORDER BY version DESC",
              [id],
            )
          ).rows,
        });
      }
      if (method === "POST" && !id) {
        const d = z
          .object({
            name: z.string().min(1).max(200),
            document: templateSchema,
          })
          .parse(await json(req));
        const tid = randomUUID();
        await c.query(
          "INSERT INTO templates(id,organization_id,name) VALUES($1,$2,$3)",
          [tid, org, d.name],
        );
        await c.query(
          "INSERT INTO template_versions(id,organization_id,template_id,version,document) VALUES($1,$2,$3,1,$4)",
          [randomUUID(), org, tid, JSON.stringify(d.document)],
        );
        await audit(c, a, org, "template.create", tid);
        return result({ id: tid }, 201);
      }
      if (method === "POST" && id && p[4] === "duplicate") {
        const t = await one(
          c,
          "SELECT * FROM templates WHERE organization_id=$1 AND id=$2",
          [org, id],
        );
        const v = await one(
          c,
          "SELECT document FROM template_versions WHERE template_id=$1 ORDER BY version DESC LIMIT 1",
          [id],
        );
        const tid = randomUUID();
        await c.query(
          "INSERT INTO templates(id,organization_id,name) VALUES($1,$2,$3)",
          [tid, org, t.name + " (copy)"],
        );
        await c.query(
          "INSERT INTO template_versions(id,organization_id,template_id,version,document) VALUES($1,$2,$3,1,$4)",
          [randomUUID(), org, tid, JSON.stringify(v.document)],
        );
        return result({ id: tid }, 201);
      }
      if (method === "PUT" && id) {
        const raw = await json(req),
          d = z
            .object({
              name: z.string().min(1).max(200).optional(),
              document: templateSchema.optional(),
              archived: z.boolean().optional(),
              is_default: z.boolean().optional(),
              restore_version_id: z.uuid().optional(),
            })
            .parse(raw);
        await one(
          c,
          "SELECT id FROM templates WHERE organization_id=$1 AND id=$2 FOR UPDATE",
          [org, id],
        );
        if (
          d.is_default &&
          ((a.tokenOrg && !a.tokenScopes?.includes("admin")) ||
            (!a.super_admin &&
              !(
                await c.query(
                  "SELECT 1 FROM memberships WHERE organization_id=$1 AND user_id=$2 AND role='ORG_ADMIN'",
                  [org, a.id],
                )
              ).rowCount))
        )
          throw new AppError(
            403,
            "Default templates require an organization administrator.",
            "Ask an administrator to set the default.",
          );
        if (d.is_default)
          await c.query(
            "UPDATE templates SET is_default=false WHERE organization_id=$1",
            [org],
          );
        await c.query(
          "UPDATE templates SET name=COALESCE($1,name),archived=COALESCE($2,archived),is_default=CASE WHEN $2=true THEN false ELSE COALESCE($3,is_default) END WHERE id=$4",
          [d.name, d.archived, d.is_default, id],
        );
        let doc = d.document;
        if (d.restore_version_id)
          doc = (
            await one(
              c,
              "SELECT document FROM template_versions WHERE template_id=$1 AND id=$2",
              [id, d.restore_version_id],
            )
          ).document;
        if (doc) {
          const version = (
            await c.query(
              "SELECT COALESCE(max(version),0)+1 n FROM template_versions WHERE template_id=$1",
              [id],
            )
          ).rows[0].n;
          await c.query(
            "INSERT INTO template_versions(id,organization_id,template_id,version,document) VALUES($1,$2,$3,$4,$5)",
            [randomUUID(), org, id, version, JSON.stringify(doc)],
          );
        }
        if (d.is_default || d.archived || doc) {
          const appearance = await getAppearance(c, org),
            updated = { ...appearance, defaults: { ...appearance.defaults } };
          const finalDoc =
            doc ||
            (
              await one(
                c,
                "SELECT document FROM template_versions WHERE template_id=$1 ORDER BY version DESC LIMIT 1",
                [id],
              )
            ).document;
          for (const [kind, template] of Object.entries(updated.defaults))
            if (
              template === id &&
              (d.archived ||
                (!finalDoc.general &&
                  !finalDoc.variants &&
                  finalDoc.cardType !== kind))
            )
              delete updated.defaults[kind as keyof typeof updated.defaults];
          if (
            d.is_default &&
            !d.archived &&
            (finalDoc.variants || finalDoc.general)
          )
            for (const kind of Object.keys(
              finalDoc.variants || {
                staff: true,
                student: true,
                visitor: true,
                professional: true,
              },
            ))
              updated.defaults[kind as keyof typeof updated.defaults] = id;
          if (d.is_default && !d.archived && finalDoc.cardType)
            updated.defaults[
              finalDoc.cardType as keyof typeof updated.defaults
            ] = id;
          await saveAppearance(c, org, updated);
        }
        await audit(c, a, org, "template.update", id);
        return result({ id });
      }
    }
    if (resource === "preview" && method === "POST") {
      const d = z
        .object({
          document: templateSchema,
          person_id: z.uuid(),
          side: z.enum(["front", "back"]).default("front"),
          theme_key: z.string().max(40).optional(),
        })
        .parse(await json(req));
      const person = await one(
        c,
        "SELECT p.*,(SELECT asset_id FROM person_assets pa WHERE pa.person_id=p.id AND slot='photo') photo_asset_id FROM people p WHERE organization_id=$1 AND id=$2",
        [org, d.person_id],
      );
      const previewStyle = await resolveStyle(c, org, d.theme_key);
      const preserveLayout = !d.document.cardType && !d.document.variants;
      d.document = templateForPerson(
        d.document,
        person,
        !!previewStyle.profiles.profiles.staff?.general,
      );
      if (d.document.cardType)
        d.document.requiredFields = [
          ...new Set([
            ...(d.document.requiredFields || []),
            ...(previewStyle.profiles.profiles[d.document.cardType]?.required ||
              []),
          ]),
        ];
      const previewDoc = applyCardTheme(
        d.document,
        previewStyle.theme,
        false,
        preserveLayout,
      );
      previewDoc.fontFiles = previewStyle.fontFiles;
      const profileValues = await cardProfileValues(
        c,
        org,
        person,
        previewDoc,
        false,
        previewStyle.profiles,
      );
      const fields = {
        ...(await locationFields(c, org, person.id)),
        ...person.custom_fields,
        ...person,
        ...profileValues,
        ...customFieldBindings(person.custom_fields, profileValues),
        "card.number": "PREVIEW",
        "card.verify_url": config().origin + "/verify/preview",
        "card.date": toWallTime(
          Date.now(),
          (await getTimeSettings(c, org)).timeZone,
        ).slice(0, 10),
      };
      return new Response(
        new Uint8Array(
          await renderSide(previewDoc, d.side, fields, (aid) =>
            assetBytes(c, org, aid),
          ),
        ),
        {
          headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
        },
      );
    }
    if (resource === "cards") {
      if (method === "GET")
        return result(
          (
            await c.query(
              "SELECT ca.*,p.name,p.external_id,(SELECT id FROM card_renders r WHERE r.card_id=ca.id ORDER BY created_at DESC LIMIT 1) render_id FROM cards ca JOIN people p ON p.id=ca.person_id WHERE ca.organization_id=$1 ORDER BY ca.created_at DESC LIMIT 100",
              [org],
            )
          ).rows,
        );
      if (method === "POST" && !id) {
        const d = z
          .object({
            person_id: z.uuid(),
            template_id: z.uuid().optional(),
            theme_key: z.string().max(40).optional(),
            expires_at: z.iso.datetime().optional(),
          })
          .parse(await json(req));
        const template =
          d.template_id ||
          (await defaultTemplate(
            c,
            org,
            (
              await one(
                c,
                "SELECT custom_fields FROM people WHERE organization_id=$1 AND id=$2",
                [org, d.person_id],
              )
            ).custom_fields.card_type,
          ));
        return result(
          await generateCard(
            c,
            org,
            a.id,
            { ...d, template_id: template },
            {
              requestKey: z
                .string()
                .min(8)
                .max(100)
                .optional()
                .parse(req.headers.get("idempotency-key") || undefined),
            },
          ),
          201,
        );
      }
    }
    if (resource === "renders" && id && method === "GET") {
      const r = await one(
        c,
        "SELECT * FROM card_renders WHERE organization_id=$1 AND id=$2",
        [org, id],
      );
      const aid =
        url.searchParams.get("side") === "back"
          ? r.back_asset_id
          : r.front_asset_id;
      if (!aid)
        throw new AppError(
          404,
          "This card has no back image.",
          "Add a back side to the template and generate another card.",
        );
      return new Response(new Uint8Array(await assetBytes(c, org, aid)), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "private, no-store",
        },
      });
    }
    return missing();
  });
}
