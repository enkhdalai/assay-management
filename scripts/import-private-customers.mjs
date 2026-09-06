import { randomUUID, createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";

import { neon } from "@neondatabase/serverless";

const inputPath = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

if (!inputPath) throw new Error("Usage: node scripts/import-private-customers.mjs <customers.csv> [--dry-run]");

const environment = Object.fromEntries((await readFile(".dev.vars", "utf8"))
  .split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"))
  .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
if (!environment.DATABASE_URL || !environment.FIELD_ENCRYPTION_KEY) throw new Error("DATABASE_URL and FIELD_ENCRYPTION_KEY are required in .dev.vars.");

const rows = parseCsv(await readFile(inputPath, "utf8"));
const [headers, ...sourceRows] = rows;
const records = sourceRows.map((values) => Object.fromEntries(headers.map((header, index) => [header.replace(/^\uFEFF/, ""), values[index] ?? ""])));
const sql = neon(environment.DATABASE_URL);
const centers = await sql`
  SELECT o.id, o.code, o.name,
    (SELECT u.id FROM users u WHERE u.organization_id = o.id AND u.status = 'active'
      ORDER BY CASE u.role WHEN 'lab_manager' THEN 0 WHEN 'assay_admin' THEN 1 ELSE 2 END, u.created_at LIMIT 1) AS "createdByUserId"
  FROM organizations o
  WHERE o.type = 'private_assay_center' AND o.status = 'active'
  ORDER BY o.created_at, o.id
`;
if (centers.length !== 1 || !centers[0].createdByUserId) {
  throw new Error("Exactly one active private assay center with an active user is required for this import.");
}
const center = centers[0];
let imported = 0, skipped = 0, corrected = 0, invalid = 0;

for (const source of records) {
  const registrationNumber = clean(source["Регистер"]);
  const displayName = cleanName(source["Байгууллагын нэр"], registrationNumber);
  if (!registrationNumber || !displayName) { invalid++; continue; }
  const customerType = isIndividualRegistration(registrationNumber) ? "individual" : "legal_entity";
  const registrationHash = hash(registrationNumber);
  const existing = await sql`
    SELECT c.id, c.type FROM customers c JOIN users creator ON creator.id = c.created_by_user_id
    WHERE creator.organization_id = ${center.id}::uuid AND c.registration_number_hash = ${registrationHash}
    LIMIT 1
  `;
  if (existing.length) {
    skipped++;
    if (existing[0].type !== customerType) {
      corrected++;
      if (!dryRun) await sql`UPDATE customers SET type = ${customerType}, updated_at = now() WHERE id = ${existing[0].id}::uuid`;
    }
    continue;
  }
  if (dryRun) { imported++; continue; }

  const customerId = randomUUID();
  const phone = clean(source["Холбоо барих утас"]);
  const email = clean(source["Цахим хаяг"]);
  const address = clean(source["Хаяг"]);
  await sql`
    INSERT INTO customers (
      id, type, display_name, registration_number_encrypted, registration_number_hash,
      phone_encrypted, phone_hash, email_encrypted, address_encrypted, created_by_user_id
    ) VALUES (
      ${customerId}::uuid, ${customerType}, ${displayName}, ${await encrypt(registrationNumber, environment.FIELD_ENCRYPTION_KEY)}, ${registrationHash},
      ${phone ? await encrypt(phone, environment.FIELD_ENCRYPTION_KEY) : null}, ${phone ? hash(phone) : null},
      ${email ? await encrypt(email, environment.FIELD_ENCRYPTION_KEY) : null}, ${address ? await encrypt(address, environment.FIELD_ENCRYPTION_KEY) : null},
      ${center.createdByUserId}::uuid
    )
  `;
  const contactPhone = clean(source["Харилцах албан хаагчийн утас"]);
  await sql`
    INSERT INTO customer_organization_profiles (
      customer_id, deposit_name, organization_kind, bank_name, bank_account_encrypted,
      province, district, bag, mine_initial_number, contact_name, contact_phone_encrypted
    ) VALUES (
      ${customerId}::uuid, ${clean(source["Ордны нэр"])}, ${clean(source["Байгууллагын төрөл"])}, ${clean(source["Банкны нэр"])},
      ${clean(source["Данс дугаар"]) ? await encrypt(clean(source["Данс дугаар"]), environment.FIELD_ENCRYPTION_KEY) : null},
      ${clean(source["Аймаг/Хот"])}, ${clean(source["Сум/дүүрэг"])}, ${clean(source["Баг/хороо"])},
      ${clean(source["Гулдмайн эхний дугаар"])}, ${clean(source["Харилцах албан хаагч"])},
      ${contactPhone ? await encrypt(contactPhone, environment.FIELD_ENCRYPTION_KEY) : null}
    )
  `;
  imported++;
}

console.log(`${dryRun ? "Dry run" : "Import"} for ${center.name} (${center.code}): ${imported} ready/imported, ${skipped} already present, ${corrected} customer types corrected, ${invalid} invalid.`);

function clean(value) {
  const normalized = String(value ?? "").trim();
  return !normalized || /^(0+|[.,]+|-|n\/a)$/i.test(normalized) ? null : normalized;
}

function cleanName(value, registrationNumber) {
  const normalized = clean(value);
  if (!normalized || !registrationNumber) return null;
  const escapedRegistration = registrationNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return normalized.replaceAll('"', "").replace(new RegExp(`\\s*\\/?${escapedRegistration}\\/?\\s*$`), "").replace(/\s{2,}/g, " ").trim();
}

function hash(value) {
  return createHash("sha256").update(value).digest("base64url");
}

function isIndividualRegistration(value) {
  return /^[A-Za-zА-ЯӨҮөү]{2}(?:\d|\*)/.test(value);
}

async function encrypt(value, encodedKey) {
  const key = await webcrypto.subtle.importKey("raw", Buffer.from(encodedKey, "base64url"), { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return `v1.${Buffer.from(iv).toString("base64url")}.${Buffer.from(ciphertext).toString("base64url")}`;
}

function parseCsv(source) {
  const values = [], rows = [];
  let value = "", quoted = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { values.push(value); value = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index++;
      values.push(value); if (values.some((entry) => entry.length)) rows.push(values.splice(0)); value = "";
    } else value += character;
  }
  values.push(value); if (values.some((entry) => entry.length)) rows.push(values);
  return rows;
}
