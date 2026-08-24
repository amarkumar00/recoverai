const drizzleConfig = {
  dialect: "sqlite",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_PATH ?? "./data/recoverai.db",
  },
} as const;

export default drizzleConfig;
