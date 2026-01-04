#!/bin/bash
# Run database migrations and seeding after Next.js has started
# This runs as a supervisor program to avoid blocking the startup

# Ensure Node.js and corepack binaries are in PATH
export PATH="/usr/bin:/usr/local/bin:$PATH"

echo "[MIGRATION] Waiting for Next.js to be ready..."
sleep 2

echo "[MIGRATION] Running database migrations..."
cd /app

# Run drizzle-kit migrate directly via npx to avoid pnpm PATH issues
npx drizzle-kit migrate 2>&1 || echo "[MIGRATION] Migration failed or no migrations to run"

echo "[MIGRATION] Drizzle-kit migration complete, waiting for connection release..."
# Give drizzle-kit time to fully close its connection
sleep 2

echo "[MIGRATION] Running seeding..."

# Seed the database with initial allow list
node -e "
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DATABASE_URL || '/data/ob-share.db';
const dbDir = path.dirname(dbPath);

console.log('[MIGRATION] Seeding database at:', dbPath);

if (!fs.existsSync(dbDir)) {
    console.log('[MIGRATION] Creating database directory:', dbDir);
    fs.mkdirSync(dbDir, { recursive: true });
}

console.log('[MIGRATION] Opening database connection for seeding...');
const db = new Database(dbPath);

console.log('[MIGRATION] Setting pragmas...');
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 30000'); // Wait up to 30s for locks

// Create allow_list table if not exists
console.log('[MIGRATION] Creating allow_list table if needed...');
db.exec(\`
    CREATE TABLE IF NOT EXISTS allow_list (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        github_username TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
    )
\`);

// Insert initial user if not exists
console.log('[MIGRATION] Inserting initial user...');
const stmt = db.prepare('INSERT OR IGNORE INTO allow_list (github_username, created_at) VALUES (?, ?)');
stmt.run('tomsjansons', Date.now());

// Force WAL checkpoint to ensure all changes are written to main database
console.log('[MIGRATION] Running WAL checkpoint...');
db.pragma('wal_checkpoint(TRUNCATE)');

console.log('[MIGRATION] Closing database connection...');
db.close();

console.log('[MIGRATION] Database seeded successfully');
" || echo "[MIGRATION] Seeding completed (or already seeded)"

echo "[MIGRATION] Database setup complete!"

# Explicitly exit to ensure supervisord knows the process is done
exit 0
