import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const devVarsPath = ".dev.vars";
const setupToken = randomBytes(32).toString("base64url");
const setupTokenHash = createHash("sha256").update(setupToken).digest("base64url");

const currentContent = existsSync(devVarsPath) ? readFileSync(devVarsPath, "utf8") : "";
const nextContent = upsertEnvValue(
  currentContent,
  "AUTH_SETUP_TOKEN_HASH",
  setupTokenHash,
);

writeFileSync(devVarsPath, nextContent);

console.log("Rotated AUTH_SETUP_TOKEN_HASH in .dev.vars.");
console.log("Restart the dev server, then paste this setup token into /setup:");
console.log(`SETUP_TOKEN=${setupToken}`);

function upsertEnvValue(content, key, value) {
  const lines = content.split(/\r?\n/);
  let replaced = false;
  const nextLines = lines.map((line) => {
    if (line.trimStart().startsWith(`${key}=`)) {
      replaced = true;
      return `${key}=${value}`;
    }

    return line;
  });

  if (!replaced) {
    if (nextLines.length > 0 && nextLines.at(-1) !== "") nextLines.push("");
    nextLines.push(`${key}=${value}`);
  }

  return nextLines.join("\n").replace(/\n*$/, "\n");
}
