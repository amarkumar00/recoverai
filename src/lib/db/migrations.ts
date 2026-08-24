import { resolve } from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type { LocalDatabase } from "@/lib/db/client";

export const DEFAULT_MIGRATIONS_FOLDER = resolve(process.cwd(), "drizzle");

export function runDatabaseMigrations(
  database: Pick<LocalDatabase, "db">,
  migrationsFolder = DEFAULT_MIGRATIONS_FOLDER,
) {
  migrate(database.db, { migrationsFolder });
}
