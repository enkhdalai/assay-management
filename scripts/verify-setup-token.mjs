import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const envVars = readDevVars();
const token = process.env.SETUP_TOKEN?.trim();
const configuredHash = process.env.AUTH_SETUP_TOKEN_HASH || envVars.AUTH_SETUP_TOKEN_HASH;

if (!token) {
  console.error("SETUP_TOKEN is missing. Run with: SETUP_TOKEN='your-token' npm run setup:verify");
  process.exit(1);
}

if (!configuredHash) {
  console.error("AUTH_SETUP_TOKEN_HASH is missing from the environment and .dev.vars.");
  process.exit(1);
}

const tokenHash = createHash("sha256").update(token).digest("base64url");

if (tokenHash === configuredHash.trim()) {
  console.log("Setup token matches AUTH_SETUP_TOKEN_HASH.");
} else {
  console.error("Setup token does not match AUTH_SETUP_TOKEN_HASH.");
  console.error("Generate one fresh pair with npm run setup:token, then paste the hash into .dev.vars and the token into /setup.");
  process.exit(1);
}

function readDevVars() {
  try {
    const file = readFileSync(".dev.vars", "utf8");
    return Object.fromEntries(
      file
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
          const separator = line.indexOf("=");
          if (separator === -1) return [line, ""];

          const key = line.slice(0, separator).trim();
          const value = unwrap(line.slice(separator + 1).trim());
          return [key, value];
        }),
    );
  } catch {
    return {};
  }
}

function unwrap(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
