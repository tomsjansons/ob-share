import { defineConfig } from "drizzle-kit";

// Use absolute path in production, relative in development
const isProduction = process.env.NODE_ENV === "production";
const defaultDbPath = isProduction ? "/data/ob-share.db" : "./data/ob-share.db";

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL || defaultDbPath,
  },
});
