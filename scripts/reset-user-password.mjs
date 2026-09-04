import { pbkdf2, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

import { neon } from "@neondatabase/serverless";

const pbkdf2Async = promisify(pbkdf2);
const ITERATIONS = 100_000;
const emailArgument = process.argv.find((argument) => argument.startsWith("--email="));
const email = emailArgument?.slice("--email=".length).trim().toLowerCase();
const password = process.env.ASSAY_RESET_PASSWORD;

if (!email) {
  throw new Error("Usage: npm run auth:reset-password -- --email=admin@example.mn");
}

if (!password) {
  throw new Error("ASSAY_RESET_PASSWORD is required and must not be placed in a file.");
}

assertAcceptablePassword(password);

const env = readEnvironmentFile(".dev.vars");
if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing from .dev.vars.");
}

const salt = randomBytes(16).toString("base64url");
const derived = await pbkdf2Async(password, Buffer.from(salt, "base64url"), ITERATIONS, 32, "sha256");
const passwordHash = `pbkdf2_sha256$${ITERATIONS}$${salt}$${derived.toString("base64url")}`;
const sql = neon(env.DATABASE_URL);
const rows = await sql.query(
  `UPDATE users
   SET password_hash = $1, password_updated_at = now(), failed_login_count = 0,
       status = 'active', locked_until = null, updated_at = now()
   WHERE lower(email) = $2
   RETURNING id`,
  [passwordHash, email],
);

if (!rows.length) {
  throw new Error("No user was found for that email address.");
}

await sql.query(
  `UPDATE user_sessions
   SET status = 'revoked', revoked_at = now()
   WHERE user_id = $1 AND status = 'active'`,
  [rows[0].id],
);

console.log(`Password reset for ${email}. No password value was logged.`);

function assertAcceptablePassword(value) {
  if (value.length < 12) {
    throw new Error("Password must be at least 12 characters long.");
  }

  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/[0-9]/.test(value)) {
    throw new Error("Password must include uppercase, lowercase, and number characters.");
  }
}

function readEnvironmentFile(path) {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}
