import { randomBytes } from "node:crypto";

console.log(`FIELD_ENCRYPTION_KEY=${randomBytes(32).toString("base64url")}`);
