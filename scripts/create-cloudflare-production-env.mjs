import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const devVarsPath = ".dev.vars";
const outputPath = "cloudflare.production.env";
const devVars = readEnvFile(devVarsPath);

if (!devVars.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing from .dev.vars. Add the Neon production URL first.");
}

const existingOutput = existsSync(outputPath) ? readEnvFile(outputPath) : {};
const fieldEncryptionKey = existingOutput.FIELD_ENCRYPTION_KEY
  ?? devVars.FIELD_ENCRYPTION_KEY
  ?? randomBytes(32).toString("base64url");

const values = {
  APP_ENV: "production",
  AUTH_DEV_LOGIN_ENABLED: "false",
  RATE_LIMITING_ENABLED: "true",
  DATABASE_URL: devVars.DATABASE_URL,
  FIELD_ENCRYPTION_KEY: fieldEncryptionKey,
  ...(devVars.AUTH_SETUP_TOKEN_HASH ? { AUTH_SETUP_TOKEN_HASH: devVars.AUTH_SETUP_TOKEN_HASH } : {}),
};

writeFileSync(outputPath, formatEnv(values), { mode: 0o600 });
if (!devVars.FIELD_ENCRYPTION_KEY) {
  writeFileSync(devVarsPath, formatEnv({ ...devVars, FIELD_ENCRYPTION_KEY: fieldEncryptionKey }), { mode: 0o600 });
}

console.log(`Created ${outputPath}. Import it in Cloudflare as runtime variables and secrets.`);
console.log("The file is ignored by Git. Do not upload it anywhere except your Cloudflare account.");

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function formatEnv(values) {
  return `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}
