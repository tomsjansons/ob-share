import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple logging for migration script
function log(level: "info" | "error", message: string, data?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ` ${JSON.stringify(data)}` : "";
  console.log(`[${timestamp}] [MIGRATION] [${level.toUpperCase()}] ${message}${dataStr}`);
}

async function runMigrations() {
  const dbPath = process.env.DATABASE_URL || "/data/ob-share.db";
  const migrationsFolder = path.resolve(__dirname, "../drizzle");

  log("info", "Starting database migrations", { dbPath, migrationsFolder });

  // Ensure data directory exists
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    log("info", "Creating database directory", { dbDir });
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // Open database connection
  log("info", "Opening database connection");
  const sqlite = new Database(dbPath);

  // Set pragmas for reliability
  log("info", "Setting database pragmas");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 30000"); // Wait up to 30s for locks

  // Create drizzle instance
  const db = drizzle(sqlite);

  // Run drizzle migrations
  log("info", "Running drizzle migrations");
  try {
    migrate(db, { migrationsFolder });
    log("info", "Drizzle migrations completed successfully");
  } catch (error) {
    if (error instanceof Error && error.message.includes("already been applied")) {
      log("info", "All migrations already applied");
    } else {
      throw error;
    }
  }

  // Run seeding
  log("info", "Running database seeding");
  await runSeeding(sqlite);

  // Force WAL checkpoint to ensure all changes are written
  log("info", "Running WAL checkpoint");
  sqlite.pragma("wal_checkpoint(TRUNCATE)");

  // Close connection
  log("info", "Closing database connection");
  sqlite.close();

  log("info", "Database migration and seeding complete!");
}

async function runSeeding(sqlite: Database.Database) {
  // Seed allow_list with initial users
  const initialAllowList = ["tomsjansons"];

  log("info", "Seeding allow_list table");
  const insertStmt = sqlite.prepare(
    "INSERT OR IGNORE INTO allow_list (github_username, created_at) VALUES (?, ?)"
  );

  for (const username of initialAllowList) {
    insertStmt.run(username, Date.now());
    log("info", "Added user to allow list", { username });
  }

  // Create settings records for existing users who don't have them
  log("info", "Creating settings for existing users without settings");
  const usersWithoutSettings = sqlite
    .prepare(
      `SELECT u.id, u.email FROM user u
       LEFT JOIN user_settings us ON u.id = us.user_id
       WHERE us.id IS NULL`
    )
    .all() as Array<{ id: string; email: string }>;

  if (usersWithoutSettings.length > 0) {
    const insertSettingsStmt = sqlite.prepare(
      `INSERT INTO user_settings (user_id, vault_name, incoming_folder, created_at, updated_at)
       VALUES (?, NULL, NULL, ?, ?)`
    );

    for (const user of usersWithoutSettings) {
      const now = Date.now();
      insertSettingsStmt.run(user.id, now, now);
      log("info", "Created settings for user", { email: user.email });
    }
  } else {
    log("info", "All users already have settings");
  }
}

// Run migrations
runMigrations().catch((error) => {
  log("error", "Migration failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
