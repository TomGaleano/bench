import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

export type DbClient = ReturnType<typeof createDb>;

export function createDb(connectionString: string) {
  const sql = postgres(connectionString);

  return drizzle(sql, { schema });
}
