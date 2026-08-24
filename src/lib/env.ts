import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_MODE: z.enum(["demo", "disabled"]).default("demo"),
  DATABASE_PATH: z.string().trim().min(1).default("./data/recoverai.db"),
});

export const env = envSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  APP_MODE: process.env.APP_MODE,
  DATABASE_PATH: process.env.DATABASE_PATH,
});
