import { createHash, randomBytes } from "node:crypto";

const providedToken = process.env.SETUP_TOKEN?.trim();
const setupToken = providedToken || randomBytes(32).toString("base64url");
const setupTokenHash = createHash("sha256").update(setupToken).digest("base64url");

if (!providedToken) {
  console.log("Generated setup token. Store this token somewhere private, then use it once at /setup.");
  console.log(`SETUP_TOKEN=${setupToken}`);
}

console.log(`AUTH_SETUP_TOKEN_HASH=${setupTokenHash}`);
