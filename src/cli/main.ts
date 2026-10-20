import { operations } from "../core/operations.ts";
import { syncPcFonts } from "../core/font-library.ts";
import { randomUUID, randomBytes } from "node:crypto";
import argon2 from "argon2";
import { db, closeDb } from "../core/db.ts";
import { migrate } from "../core/migrate.ts";
import { doctor } from "../core/doctor.ts";
import { demo } from "../core/demo.ts";
import { bootstrapAdmin } from "../core/bootstrap-admin.ts";
async function main() {
  const command = process.argv[2];
  if (command === "sync-fonts")
    console.log(JSON.stringify(await syncPcFonts()));
  else if (command === "ops") await operations(process.argv.slice(3));
  else if (command === "migrate") await migrate();
  else if (command === "doctor") await doctor();
  else if (command === "demo") await demo();
  else if (command === "bootstrap-admin") {
    const result = await bootstrapAdmin(process.argv[3]);
    if (!result.created)
      console.log(
        "First-admin setup skipped: user accounts already exist. Existing credentials were not changed.",
      );
    else
      console.log(
        `Administrator: ${result.email}\nTemporary password (shown once): ${result.password}\nChange it on first sign-in.`,
      );
  } else if (command === "admin") {
    const email = process.argv[3]?.toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email))
      throw new Error(
        "Provide a valid admin email: npm run admin -- admin@example.org",
      );
    const existing = await db().query("SELECT id FROM users WHERE email=$1", [
      email,
    ]);
    if (existing.rowCount) {
      console.log("User already exists; password was not changed.");
      return;
    }
    const password = randomBytes(20).toString("base64url");
    await db().query(
      "INSERT INTO users(id,email,password_hash,super_admin) VALUES($1,$2,$3,true)",
      [randomUUID(), email, await argon2.hash(password)],
    );
    console.log(
      `Administrator: ${email}\nTemporary password (shown once): ${password}\nChange it on first sign-in.`,
    );
  } else
    throw new Error(
      "Unknown command. Use migrate, bootstrap-admin [email], admin <email>, doctor or demo.",
    );
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
