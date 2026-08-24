import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const databasePath = process.env.DATABASE_PATH ?? "./data/recoverai.db";
mkdirSync(dirname(databasePath), { recursive: true });

const sqlite = new Database(databasePath);

try {
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("journal_mode = WAL");
  migrate(drizzle(sqlite), {
    migrationsFolder: resolve(process.cwd(), "drizzle"),
  });
  console.log(`Applied committed migrations to ${databasePath}.`);
} finally {
  sqlite.close();
}
