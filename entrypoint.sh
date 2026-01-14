#!/bin/bash
set -e

echo "[ENTRYPOINT] Starting entrypoint script..."
echo "[ENTRYPOINT] Checking /data mount status..."

# Set up persistent volume (Railway)
# When /data is a mounted volume, set up directory structure and symlinks
if mountpoint -q /data 2>/dev/null; then
    echo "[ENTRYPOINT] /data IS a mountpoint - setting up persistent storage..."

    # Create subdirectories in the volume
    mkdir -p /data/Documents
    mkdir -p /data/obsidian-config
    mkdir -p /data/chromium-profile
    chown -R obsidian:obsidian /data

    # Set up Documents symlink
    if [ -d /home/obsidian/Documents ] && [ ! -L /home/obsidian/Documents ]; then
        # Move any existing content to volume
        if [ "$(ls -A /home/obsidian/Documents 2>/dev/null)" ]; then
            cp -rn /home/obsidian/Documents/* /data/Documents/ 2>/dev/null || true
        fi
        rm -rf /home/obsidian/Documents
    fi
    if [ ! -L /home/obsidian/Documents ]; then
        ln -s /data/Documents /home/obsidian/Documents
        echo "Linked /home/obsidian/Documents -> /data/Documents"
    fi

    # Set up Obsidian config symlink
    if [ -d /home/obsidian/.config/obsidian ] && [ ! -L /home/obsidian/.config/obsidian ]; then
        # Move any existing content to volume
        if [ "$(ls -A /home/obsidian/.config/obsidian 2>/dev/null)" ]; then
            cp -rn /home/obsidian/.config/obsidian/* /data/obsidian-config/ 2>/dev/null || true
        fi
        rm -rf /home/obsidian/.config/obsidian
    fi
    if [ ! -L /home/obsidian/.config/obsidian ]; then
        ln -s /data/obsidian-config /home/obsidian/.config/obsidian
        echo "Linked /home/obsidian/.config/obsidian -> /data/obsidian-config"
    fi

    # Set up Chrome profile symlink (for shared cookies/sessions)
    if [ -d /home/obsidian/.config/google-chrome ] && [ ! -L /home/obsidian/.config/google-chrome ]; then
        # Move any existing content to volume
        if [ "$(ls -A /home/obsidian/.config/google-chrome 2>/dev/null)" ]; then
            cp -rn /home/obsidian/.config/google-chrome/* /data/chromium-profile/ 2>/dev/null || true
        fi
        rm -rf /home/obsidian/.config/google-chrome
    fi
    if [ ! -L /home/obsidian/.config/google-chrome ]; then
        ln -s /data/chromium-profile /home/obsidian/.config/google-chrome
        echo "Linked /home/obsidian/.config/google-chrome -> /data/chromium-profile"
    fi

    chown -h obsidian:obsidian /home/obsidian/Documents
    chown -h obsidian:obsidian /home/obsidian/.config/obsidian
    chown -h obsidian:obsidian /home/obsidian/.config/google-chrome

    # Clean Chrome lock files (prevents "profile locked by another hostname" error after redeployment)
    echo "[ENTRYPOINT] Cleaning Chrome lock files..."
    rm -f /data/chromium-profile/SingletonLock 2>/dev/null || true
    rm -f /data/chromium-profile/SingletonSocket 2>/dev/null || true
    rm -f /data/chromium-profile/SingletonCookie 2>/dev/null || true
else
    echo "[ENTRYPOINT] /data is NOT a mountpoint - creating directory for database..."
    mkdir -p /data
    chown obsidian:obsidian /data
    ls -la /data 2>&1 || echo "[ENTRYPOINT] Failed to create /data"
fi

echo "[ENTRYPOINT] Volume setup complete, setting up VNC..."

# Set up VNC password
if [ ! -f /home/obsidian/.vnc/passwd ]; then
    echo "Setting up VNC password..."
    x11vnc -storepasswd "${VNC_PASSWORD}" /home/obsidian/.vnc/passwd
    chmod 600 /home/obsidian/.vnc/passwd
    chown obsidian:obsidian /home/obsidian/.vnc/passwd
fi

# Ensure proper ownership of directories
chown -R obsidian:obsidian /home/obsidian/.vnc
chown -R obsidian:obsidian /home/obsidian/vault
if [ ! -L /home/obsidian/.config/obsidian ]; then
    chown -R obsidian:obsidian /home/obsidian/.config/obsidian
fi

# Parse screen resolution
SCREEN_WIDTH=$(echo $SCREEN_RESOLUTION | cut -d'x' -f1)
SCREEN_HEIGHT=$(echo $SCREEN_RESOLUTION | cut -d'x' -f2)
SCREEN_DEPTH=$(echo $SCREEN_RESOLUTION | cut -d'x' -f3)

# Export for supervisord
export SCREEN_WIDTH SCREEN_HEIGHT SCREEN_DEPTH

# Run database migrations and seeding before starting services
echo "[ENTRYPOINT] Starting database migrations..."
echo "[MIGRATION] Running database migrations and seeding..."
cd /app
echo "[MIGRATION] Working directory: $(pwd)"
echo "[MIGRATION] Node version: $(node --version)"
echo "[MIGRATION] DATABASE_URL env: ${DATABASE_URL:-not set}"
echo "[MIGRATION] Files in /data before migration:"
ls -la /data/ 2>&1 || echo "[MIGRATION] /data directory does not exist"
echo "[MIGRATION] Checking for stale database at /app/data/:"
ls -la /app/data/ 2>&1 || echo "[MIGRATION] /app/data/ does not exist (good)"

# Run migrations using the TypeScript migration script via tsx
npx tsx scripts/migrate.ts 2>&1 || {
    echo "[MIGRATION] Migration script failed!"
    echo "[MIGRATION] Check logs above for details"
}

echo "[MIGRATION] Files in /data after migration:"
ls -la /data/ 2>&1 || echo "[MIGRATION] /data directory does not exist"

# Debug: Check if database exists and list tables
if [ -f /data/ob-share.db ]; then
    echo "[MIGRATION] Database exists at /data/ob-share.db"
    echo "[MIGRATION] Tables in database:"
    sqlite3 /data/ob-share.db ".tables" 2>&1 || echo "[MIGRATION] Could not list tables"
else
    echo "[MIGRATION] WARNING: Database file /data/ob-share.db does not exist!"
fi

echo "[MIGRATION] Database setup complete!"

echo "Starting headless Obsidian environment with Next.js..."
echo "Next.js available at port 3000"
echo "VNC available at port 5900"
echo "Screen resolution: ${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH}"

# Start supervisord to manage all processes
echo "[ENTRYPOINT] Starting supervisord..."
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
