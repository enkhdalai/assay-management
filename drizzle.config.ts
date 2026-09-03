import { defineConfig } from "drizzle-kit";
import { readFileSync } from "node:fs";

const databaseUrl = process.env.DATABASE_URL ?? readLocalDatabaseUrl();

function readLocalDatabaseUrl(): string | undefined {
  try {
    const line = readFileSync(".dev.vars", "utf8")
      .split(/\r?\n/)
      .find((entry) => entry.startsWith("DATABASE_URL="));
    if (!line) return undefined;

    const value = line.slice("DATABASE_URL=".length).trim();
    if (!value) return undefined;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    return value;
  } catch {
    return undefined;
  }
}

export default defineConfig({
  out: "./packages/db/drizzle",
  schema: "./packages/db/src/schema.ts",
  dialect: "postgresql",
  ...(databaseUrl
    ? {
        dbCredentials: {
          url: databaseUrl,
        },
      }
    : {}),
});
