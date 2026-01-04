import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

console.log("[DB] Database module loading...");

// Ensure data directory exists
const dataDir = process.env.DATABASE_URL
  ? path.dirname(process.env.DATABASE_URL)
  : "./data";

console.log("[DB] Data directory:", dataDir);

if (!fs.existsSync(dataDir)) {
  console.log("[DB] Creating data directory...");
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DATABASE_URL || "./data/ob-share.db";
console.log("[DB] Database path:", dbPath);
console.log("[DB] Opening database connection...");

const sqlite = new Database(dbPath);
console.log("[DB] Database connection opened");

// Enable WAL mode for better performance
console.log("[DB] Setting WAL mode...");
sqlite.pragma("journal_mode = WAL");
console.log("[DB] WAL mode set");

console.log("[DB] Creating drizzle instance...");
export const db = drizzle(sqlite, { schema });
console.log("[DB] Drizzle instance created");

export type Database = typeof db;
