import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { recoverAiSchema } from "@/lib/db/schema";
import { env } from "@/lib/env";

function prepareDatabaseDirectory(path: string) {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
}

export function createLocalDatabase(path = env.DATABASE_PATH) {
  prepareDatabaseDirectory(path);

  const sqlite = new Database(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  if (path !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
  }

  return {
    client: sqlite,
    db: drizzle(sqlite, { schema: recoverAiSchema }),
  };
}

export type LocalDatabase = ReturnType<typeof createLocalDatabase>;
