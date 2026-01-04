import Database from "better-sqlite3";
import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";
import fs from "fs";
import { logger as baseLogger, getElapsedMs } from "@/lib/logger";

const logger = baseLogger.child({ module: "database" });

logger.info({ event: "db.module.loading", elapsedMs: getElapsedMs() }, "Database module loading");

// Database connection is initialized lazily to allow the server to start
// even if the database isn't immediately available (e.g., volume mounting)
let _db: BetterSQLite3Database<typeof schema> | null = null;
let _sqlite: Database.Database | null = null;

function initializeDatabase(): BetterSQLite3Database<typeof schema> {
  if (_db) return _db;

  const initStart = Date.now();
  try {
    const dataDir = process.env.DATABASE_URL
      ? path.dirname(process.env.DATABASE_URL)
      : "./data";

    logger.info({ event: "db.config", dataDir, elapsedMs: getElapsedMs() }, "Database data directory");

    if (!fs.existsSync(dataDir)) {
      logger.info(
        { event: "db.dir.creating", dataDir },
        "Creating data directory"
      );
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const dbPath = process.env.DATABASE_URL || "./data/ob-share.db";
    logger.info(
      { event: "db.connection.opening", dbPath },
      "Opening database connection"
    );

    _sqlite = new Database(dbPath);
    logger.info({ event: "db.connection.opened" }, "Database connection opened");

    // Enable WAL mode for better performance
    logger.info({ event: "db.wal.setting" }, "Setting WAL mode");
    _sqlite.pragma("journal_mode = WAL");
    logger.info({ event: "db.wal.set" }, "WAL mode set");

    // Set busy timeout to wait for locks instead of failing immediately
    // This is critical when migrations may be running concurrently
    logger.info({ event: "db.busy_timeout.setting" }, "Setting busy timeout");
    _sqlite.pragma("busy_timeout = 30000"); // Wait up to 30 seconds for locks
    logger.info({ event: "db.busy_timeout.set" }, "Busy timeout set to 30s");

    logger.info({ event: "db.drizzle.creating", elapsedMs: getElapsedMs() }, "Creating drizzle instance");
    _db = drizzle(_sqlite, { schema });
    const initDuration = Date.now() - initStart;
    logger.info({ event: "db.ready", elapsedMs: getElapsedMs(), initDurationMs: initDuration }, "Database ready");

    return _db;
  } catch (error) {
    logger.error(
      {
        event: "db.init.error",
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to initialize database"
    );
    // Don't cache errors - allow retry on next access
    throw error;
  }
}

// Proxy that lazily initializes the database on first access
export const db = new Proxy({} as BetterSQLite3Database<typeof schema>, {
  get(_target, prop) {
    const realDb = initializeDatabase();
    const value = realDb[prop as keyof typeof realDb];
    if (typeof value === "function") {
      return value.bind(realDb);
    }
    return value;
  },
});

// Export a function to check if DB is ready without throwing
export function isDatabaseReady(): boolean {
  try {
    initializeDatabase();
    return true;
  } catch {
    return false;
  }
}

// Export a function to reset the database state (useful for retrying after errors)
export function resetDatabaseState(): void {
  _db = null;
  _sqlite = null;
  logger.info({ event: "db.state.reset" }, "Database state reset");
}

export type DatabaseType = typeof db;

logger.info({ event: "db.module.loaded", elapsedMs: getElapsedMs() }, "Database module loaded (lazy init)");
