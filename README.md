# Obsidian Sync Docker

A headless Obsidian instance running in Docker for seamless sync across all your devices.

## Quick Start

1. Clone this repository
2. Copy `.env.example` to `.env` and configure:
   ```bash
   cp .env.example .env
   ```

3. Start the container:
   ```bash
   docker compose up -d
   ```

4. Connect via VNC viewer (e.g., TigerVNC) to `localhost:5900`

5. In Obsidian:
   - Open the vault at `/home/obsidian/vault`
   - Log in with your Obsidian account
   - Enable Obsidian Sync

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `VNC_PASSWORD` | `obsidian` | Password for VNC access |
| `SCREEN_RESOLUTION` | `1280x720x24` | Virtual display resolution |

## Volumes

- `./vault` - Your Obsidian vault (synced notes)
- `obsidian-config` - Obsidian configuration and sync data

## Architecture

The container runs:
- **Xvfb** - Virtual framebuffer for headless display
- **Openbox** - Minimal window manager
- **x11vnc** - VNC server for remote access
- **Obsidian** - The note-taking application

All processes are managed by supervisord for automatic restart on failure.

## Updating Obsidian

To update Obsidian version, rebuild with:
```bash
docker compose build --build-arg OBSIDIAN_VERSION=1.7.7
docker compose up -d
```
