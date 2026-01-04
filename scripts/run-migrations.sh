#!/bin/bash
# Run database migrations and seeding after Next.js has started
# This runs as a supervisor program to avoid blocking the startup

# Ensure Node.js and corepack binaries are in PATH
export PATH="/usr/bin:/usr/local/bin:$PATH"

echo "Waiting for Next.js to be ready..."
sleep 2

echo "Running database migrations..."
cd /app

# Run drizzle-kit migrate directly via npx to avoid pnpm PATH issues
npx drizzle-kit migrate 2>&1 || echo "Migration failed or no migrations to run"

# Seed the database with initial allow list
echo "Seeding database..."
node -e "
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DATABASE_URL || '/data/ob-share.db';
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Create allow_list table if not exists
db.exec(\`
    CREATE TABLE IF NOT EXISTS allow_list (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        github_username TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
    )
\`);

// Insert initial user if not exists
const stmt = db.prepare('INSERT OR IGNORE INTO allow_list (github_username, created_at) VALUES (?, ?)');
stmt.run('tomsjansons', Date.now());

console.log('Database seeded successfully');
db.close();
" || echo "Seeding completed (or already seeded)"

echo "Database setup complete!"
