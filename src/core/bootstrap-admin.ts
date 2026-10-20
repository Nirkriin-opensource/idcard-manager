import { randomUUID, randomBytes } from "node:crypto";
import argon2 from "argon2";
import { z } from "zod";
import type pg from "pg";
import { transaction } from "./db.ts";

export const initialAdminEmail = "admin@idcard.local";

/** Local operator setup only. Never expose this function through a public route. */
export async function bootstrapAdmin(email = initialAdminEmail) {
  return transaction((c) => bootstrapAdminInTransaction(c, email));
}

export async function bootstrapAdminInTransaction(
  c: pg.PoolClient,
  email = initialAdminEmail,
) {
  email = z.email().parse(email.trim().toLowerCase());
  // Serialize first-run setup so parallel installers cannot create multiple initial admins.
  await c.query("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE");
  if ((await c.query("SELECT 1 FROM users LIMIT 1")).rowCount)
    return { created: false as const };
  const password = randomBytes(20).toString("base64url");
  await c.query(
    "INSERT INTO users(id,email,password_hash,super_admin,must_change_password) VALUES($1,$2,$3,true,true)",
    [randomUUID(), email, await argon2.hash(password)],
  );
  return { created: true as const, email, password };
}
