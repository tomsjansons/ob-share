import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";
import fs from "fs";
import { logger as baseLogger } from "@/lib/logger";

const logger = baseLogger.child({ module: "database" });

logger.info({ event: "db.module.loading" }, "Database module loading");

console.log("[DB] Database module loading...");

// Ensure data directory exists
const dataDir = process.env.DATABASE_URL
  ? path.dirname(process.env.DATABASE_URL)
  : "./data";

logger.debug({ event: "db.config", dataDir }, "Database data directory");

if (!fs.existsSync(dataDir)) {
  logger.info({ event: "db.dir.creating", dataDir }, "Creating data directory");
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DATABASE_URL || "./data/ob-share.db";
logger.info({ event: "db.connection.opening", dbPath }, "Opening database connection");

const sqlite = new Database(dbPath);
logger.debug({ event: "db.connection.opened" }, "Database connection opened");

// Enable WAL mode for better performance
logger.debug({ event: "db.wal.setting" }, "Setting WAL mode");
sqlite.pragma("journal_mode = WAL");
logger.debug({ event: "db.wal.set" }, "WAL mode set");

logger.debug({ event: "db.drizzle.creating" }, "Creating drizzle instance");
export const db = drizzle(sqlite, { schema });
logger.info({ event: "db.ready" }, "Database ready");

export type Database = typeof db;
