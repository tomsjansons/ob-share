#!/bin/bash
set -e

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
chown -R obsidian:obsidian /home/obsidian/.config/obsidian

# Parse screen resolution
SCREEN_WIDTH=$(echo $SCREEN_RESOLUTION | cut -d'x' -f1)
SCREEN_HEIGHT=$(echo $SCREEN_RESOLUTION | cut -d'x' -f2)
SCREEN_DEPTH=$(echo $SCREEN_RESOLUTION | cut -d'x' -f3)

# Export for supervisord
export SCREEN_WIDTH SCREEN_HEIGHT SCREEN_DEPTH

echo "Starting headless Obsidian environment..."
echo "VNC available at port 5900"
echo "Screen resolution: ${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH}"

# Start supervisord to manage all processes
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
