import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { env } from "@/lib/env";

export function createLocalDatabase(path = env.DATABASE_PATH) {
  const sqlite = new Database(path);
  sqlite.pragma("foreign_keys = ON");

  return {
    client: sqlite,
    db: drizzle(sqlite),
  };
}
