import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

export function createDatabase(databaseUrl: string) {
  const client = neon(databaseUrl);
  return drizzle(client, { schema });
}

export type AppDatabase = ReturnType<typeof createDatabase>;
