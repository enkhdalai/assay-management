import { createHash, randomUUID, webcrypto } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { neon } from "@neondatabase/serverless";

const [inputPath] = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const assayCenterCode = readOption("--assay-center-code");
const apply = process.argv.includes("--apply");

if (!inputPath || !assayCenterCode) {
  throw new Error("Usage: node scripts/import-state-center-customers.mjs <legacy-export.html> --assay-center-code <code> [--apply]");
}

const environment = Object.fromEntries((await readFile(".dev.vars", "utf8"))
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
if (!environment.DATABASE_URL || !environment.FIELD_ENCRYPTION_KEY) {
  throw new Error("DATABASE_URL and FIELD_ENCRYPTION_KEY are required in .dev.vars.");
}

const sql = neon(environment.DATABASE_URL);
const [center] = await sql`
  SELECT o.id, o.code, o.name,
    (SELECT u.id FROM users u WHERE u.organization_id = o.id AND u.status = 'active'
      ORDER BY CASE u.role WHEN 'lab_manager' THEN 0 WHEN 'assay_admin' THEN 1 WHEN 'intake_officer' THEN 2 ELSE 3 END, u.created_at
      LIMIT 1) AS "createdByUserId"
  FROM organizations o
  WHERE o.type = 'government_assay_center' AND o.status = 'active' AND o.code = ${assayCenterCode}
`;
if (!center?.createdByUserId) {
  throw new Error(`An active government assay center and import owner were not found for code ${assayCenterCode}.`);
}

const sourceRows = await loadSourceRows(inputPath);
const candidates = sourceRows.map(mapLegacyRow).filter((record) => record.displayName);
const existing = await sql`
  SELECT lower(display_name) AS "displayName", type, registration_number_hash AS "registrationHash"
  FROM customers
  WHERE assay_center_id = ${center.id}::uuid
`;
const existingRegistrations = new Set(existing.map((record) => record.registrationHash).filter(Boolean));
const existingNames = new Set(existing.map((record) => `${record.type}:${record.displayName}`));
const seenRegistrations = new Set();
const seenNames = new Set();
const ready = [];
let skipped = 0;

for (const record of candidates) {
  const registrationHash = record.registrationNumber ? hash(record.registrationNumber) : null;
  const nameKey = `${record.type}:${record.displayName.toLocaleLowerCase("mn")}`;
  if ((registrationHash && (existingRegistrations.has(registrationHash) || seenRegistrations.has(registrationHash)))
    || (!registrationHash && (existingNames.has(nameKey) || seenNames.has(nameKey)))) {
    skipped++;
    continue;
  }
  if (registrationHash) seenRegistrations.add(registrationHash);
  seenNames.add(nameKey);
  ready.push({ ...record, id: randomUUID(), registrationHash });
}

if (!apply) {
  console.log(`Dry run for ${center.name} (${center.code}): ${ready.length} ready, ${skipped} already present or duplicate, ${sourceRows.length - candidates.length} empty rows.`);
  process.exit(0);
}

let imported = 0;
for (let offset = 0; offset < ready.length; offset += 8) {
  await Promise.all(ready.slice(offset, offset + 8).map(async (record) => {
    const [registrationNumberEncrypted, phoneEncrypted, addressEncrypted, bankAccountEncrypted, postalAddressEncrypted, contactPhoneEncrypted] = await Promise.all([
      encrypt(record.registrationNumber), encrypt(record.phone), encrypt(record.address), encrypt(record.bankAccount),
      encrypt(record.postalAddress), encrypt(record.contactPhone),
    ]);
    await sql`
      INSERT INTO customers (
        id, type, display_name, registration_number_encrypted, registration_number_hash,
        phone_encrypted, phone_hash, address_encrypted, assay_center_id, created_by_user_id
      ) VALUES (
        ${record.id}::uuid, ${record.type}, ${record.displayName}, ${registrationNumberEncrypted}, ${record.registrationHash},
        ${phoneEncrypted}, ${record.phone ? hash(record.phone) : null}, ${addressEncrypted}, ${center.id}::uuid, ${center.createdByUserId}::uuid
      )
    `;
    await sql`
      INSERT INTO customer_organization_profiles (
        customer_id, deposit_name, organization_kind, bank_name, bank_account_encrypted, postal_address_encrypted,
        english_name, legacy_type_code, province, district, contact_name, contact_phone_encrypted
      ) VALUES (
        ${record.id}::uuid, ${record.depositName}, ${record.organizationKind}, ${record.bankName}, ${bankAccountEncrypted}, ${postalAddressEncrypted},
        ${record.englishName}, ${record.legacyTypeCode}, ${record.province}, ${record.district}, ${record.contactName}, ${contactPhoneEncrypted}
      )
    `;
    imported++;
  }));
}

console.log(`Imported ${imported} state-center customers into ${center.name} (${center.code}); ${skipped} were already present or duplicate.`);

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function parseLegacyHtml(source) {
  return [...source.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((match) => [...match[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => decodeHtml(cell[1])))
    .filter((cells) => cells.length >= 15)
    .slice(1);
}

async function loadSourceRows(path) {
  if (/\.xlsx$/i.test(path)) return parseReadableWorkbook(path);
  return parseLegacyHtml(await readFile(path, "utf8"));
}

async function parseReadableWorkbook(path) {
  const unzip = promisify(execFile);
  const [{ stdout: stringsXml }, { stdout: sheetXml }] = await Promise.all([
    unzip("unzip", ["-p", path, "xl/sharedStrings.xml"], { maxBuffer: 8 * 1024 * 1024 }),
    unzip("unzip", ["-p", path, "xl/worksheets/sheet1.xml"], { maxBuffer: 16 * 1024 * 1024 }),
  ]);
  const strings = [...stringsXml.matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((match) => decodeXml(match[1]).replace(/<[^>]+>/g, ""));
  return [...sheetXml.matchAll(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)]
    .map((row) => [...row[1].matchAll(/<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/g)].map((cell) => {
      const isSharedString = /\bt="s"/.test(cell[1]);
      const value = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(cell[2])?.[1] ?? "";
      return isSharedString ? strings[Number(value)] ?? "" : decodeXml(value);
    }))
    .filter((cells) => cells.length === 15)
    .slice(1);
}

function mapLegacyRow(cells) {
  // The source header has an email column, but its data rows omit it. Values after postal address are therefore shifted left.
  const hasEmailCell = cells.length >= 16;
  const offset = hasEmailCell ? 1 : 0;
  const registrationNumber = clean(cells[1]);
  return {
    displayName: cleanName(cells[0], registrationNumber),
    registrationNumber,
    type: clean(cells[14 + offset]) === "Иргэн" ? "individual" : "legal_entity",
    legacyTypeCode: clean(cells[2]),
    bankName: clean(cells[3]),
    bankAccount: clean(cells[4]),
    depositName: clean(cells[5]),
    postalAddress: clean(cells[6]),
    contactName: clean(cells[7 + offset]),
    contactPhone: clean(cells[8 + offset]),
    address: clean(cells[9 + offset]),
    phone: clean(cells[10 + offset]),
    englishName: clean(cells[11 + offset]),
    province: clean(cells[12 + offset]),
    district: clean(cells[13 + offset]),
    organizationKind: clean(cells[14 + offset]),
  };
}

function decodeHtml(value) {
  return value.replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ").trim();
}

function decodeXml(value) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function clean(value) {
  const normalized = String(value ?? "").trim();
  return !normalized || /^(?:\*+|[xхh]+|0+|[.,]+|-|n\/?a)$/i.test(normalized) ? null : normalized;
}

function cleanName(value, registrationNumber) {
  const normalized = clean(value);
  if (!normalized) return null;
  if (!registrationNumber) return normalized;
  const escaped = registrationNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return normalized.replace(new RegExp(`\\s*\\/?${escaped}\\/?\\s*$`), "").replace(/\s{2,}/g, " ").trim() || null;
}

function hash(value) {
  return createHash("sha256").update(value).digest("base64url");
}

async function encrypt(value) {
  if (!value) return null;
  const key = await webcrypto.subtle.importKey("raw", Buffer.from(environment.FIELD_ENCRYPTION_KEY, "base64url"), { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const encrypted = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return `v1.${Buffer.from(iv).toString("base64url")}.${Buffer.from(encrypted).toString("base64url")}`;
}
