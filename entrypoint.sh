#!/bin/bash
set -e

# Set up persistent volume (Fly.io)
# When /data is a mounted volume, set up directory structure and symlinks
if mountpoint -q /data 2>/dev/null; then
    echo "Fly.io volume detected at /data, setting up persistent storage..."

    # Create subdirectories in the volume
    mkdir -p /data/Documents
    mkdir -p /data/obsidian-config
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

    chown -h obsidian:obsidian /home/obsidian/Documents
    chown -h obsidian:obsidian /home/obsidian/.config/obsidian
fi

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
echo "[MIGRATION] Running database migrations and seeding..."
cd /app

# Run migrations using the TypeScript migration script via tsx
npx tsx scripts/migrate.ts 2>&1 || {
    echo "[MIGRATION] Migration script failed, attempting drizzle-kit fallback..."
    npx drizzle-kit migrate 2>&1 || echo "[MIGRATION] Drizzle-kit migrate also failed"
}

echo "[MIGRATION] Database setup complete!"

echo "Starting headless Obsidian environment with Next.js..."
echo "Next.js available at port 3000"
echo "VNC available at port 5900"
echo "Screen resolution: ${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH}"

# Start supervisord to manage all processes
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
