import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./packages/db/drizzle",
  schema: "./packages/db/src/schema.ts",
  dialect: "postgresql",
});
