# Obsidian Share (ob-share)

A headless Obsidian instance running in Docker for seamless note synchronization across all your devices. Access your Obsidian vault remotely via VNC from anywhere.

## Overview

This project provides a cloud-based, containerized Obsidian installation that:
- Runs headless in Docker with a virtual display
- Provides remote desktop access via VNC
- Enables Obsidian Sync across all your devices
- Deploys to Fly.io with automatic CI/CD
- Includes a landing page for easy access

## Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Base OS | Ubuntu 22.04 | Container foundation |
| Container | Docker & Docker Compose | Containerization |
| Deployment | Fly.io | Cloud hosting |
| Display | Xvfb (Virtual Framebuffer) | Headless X11 display |
| Window Manager | Openbox | Minimal window management |
| Remote Access | x11vnc | VNC server (port 5900) |
| Web Server | Nginx | Landing page (port 80) |
| Process Manager | supervisord | Service orchestration |
| Application | Obsidian v1.7.7 | Note-taking app |

## Project Structure

```
ob-share/
├── Dockerfile              # Container image definition
├── docker-compose.yml      # Docker Compose configuration
├── entrypoint.sh           # Container startup script
├── fly.toml                # Fly.io deployment config
├── supervisord.conf        # Process manager config
├── nginx.conf              # Web server config
├── .env.example            # Environment variables template
├── .gitignore              # Git ignore patterns
├── public/
│   └── index.html          # Landing page
└── .github/
    └── workflows/
        └── fly-deploy.yml  # CI/CD workflow
```

## Quick Start

### Prerequisites

- Docker and Docker Compose installed
- A VNC viewer (e.g., TigerVNC, RealVNC, or any VNC client)
- (Optional) Obsidian Sync subscription for cloud sync

### Local Setup

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd ob-share
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env to customize settings
   ```

3. **Build and start the container:**
   ```bash
   docker compose up -d
   ```

4. **Access the services:**
   - **Landing Page:** Open `http://localhost` in your browser
   - **VNC Access:** Connect to `localhost:5900` with your VNC viewer

5. **Set up Obsidian:**
   - In the VNC session, open the vault at `/home/obsidian/vault`
   - Log in with your Obsidian account
   - Enable Obsidian Sync to synchronize notes

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VNC_PASSWORD` | `obsidian` | Password for VNC remote access |
| `SCREEN_RESOLUTION` | `1280x720x24` | Virtual display resolution (width x height x color depth) |

### Volumes

#### Local Development (Docker Compose)

| Local Path | Container Path | Purpose |
|------------|----------------|---------|
| `./vault` | `/home/obsidian/vault` | Your Obsidian notes (synced) |
| `obsidian-config` (named volume) | `/home/obsidian/.config/obsidian` | Obsidian settings and sync data |

#### Fly.io Deployment (Persistent Volume)

On Fly.io, a persistent volume is mounted at `/data` with the following structure:

| Volume Path | Symlinked To | Purpose |
|-------------|--------------|---------|
| `/data/Documents` | `/home/obsidian/Documents` | Persistent document storage |
| `/data/obsidian-config` | `/home/obsidian/.config/obsidian` | Obsidian settings and sync data |

The volume is automatically configured during deployment. Data persists across container restarts and redeployments.

### Port Mappings

| Port | Service | Protocol |
|------|---------|----------|
| 5900 | x11vnc (VNC) | TCP |
| 80 | Nginx (HTTP) | TCP |

## Architecture

### Process Management

The container uses supervisord to manage all services with automatic restart capabilities:

| Priority | Service | Description |
|----------|---------|-------------|
| 50 | nginx | Web server for landing page |
| 100 | xvfb | Virtual X11 framebuffer (display :5) |
| 200 | openbox | Minimal window manager |
| 300 | x11vnc | VNC server with password authentication |
| 400 | obsidian | Obsidian application (runs last) |

### Startup Flow

1. `entrypoint.sh` initializes VNC password and environment
2. supervisord launches services in priority order
3. Xvfb creates virtual display
4. Openbox provides window management
5. x11vnc exposes display over VNC
6. Obsidian starts in the virtual display
7. Nginx serves the landing page

## Deployment

### Fly.io Deployment

The project is configured for Fly.io deployment with the following specifications:

| Setting | Value |
|---------|-------|
| App Name | `ob-share` |
| Region | `arn` (Dublin, Ireland) |
| CPU | 1 shared core |
| Memory | 1 GB |
| Volume | 1 GB persistent storage |
| Auto-scaling | Enabled (auto-stop/start) |

#### Automatic Deployment (CI/CD)

Pushes to the `main` branch trigger automatic deployment via GitHub Actions.

**Setup:**
1. Create a Fly.io account and install `flyctl`
2. Run `flyctl auth token` to get your API token
3. Add `FLY_API_TOKEN` as a secret in your GitHub repository settings
4. Push to `main` to trigger deployment

#### Manual Deployment

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Authenticate
flyctl auth login

# Create the persistent volume (first time only)
flyctl volumes create obsidian_data --region arn --size 1

# Deploy
flyctl deploy --remote-only --ha=false
```

**Note:** The volume must be created before the first deployment. Subsequent deployments will reuse the existing volume.

### Docker Hub / Custom Registry

Build and push to your own registry:

```bash
docker build -t your-registry/ob-share:latest .
docker push your-registry/ob-share:latest
```

## Updating Obsidian

To update the Obsidian version:

```bash
# Rebuild with a specific version
docker compose build --build-arg OBSIDIAN_VERSION=1.8.0

# Restart the container
docker compose up -d
```

## Troubleshooting

### VNC Connection Issues

- **Connection refused:** Ensure the container is running (`docker compose ps`)
- **Authentication failed:** Check your `VNC_PASSWORD` in `.env`
- **Black screen:** Wait a few seconds for Obsidian to fully start

### Display Issues

- **Resolution problems:** Adjust `SCREEN_RESOLUTION` in `.env`
- **Format:** `WIDTHxHEIGHTxCOLOR_DEPTH` (e.g., `1920x1080x24`)

### Container Logs

```bash
# View all logs
docker compose logs -f

# View specific service logs
docker compose logs obsidian
```

### Restart Services

```bash
# Restart the container
docker compose restart

# Rebuild and restart
docker compose up -d --build
```

## Security Considerations

- **VNC Password:** Change the default password in production
- **Network Exposure:** Consider using VPN or SSH tunnel for remote access
- **Fly.io:** HTTPS is enforced automatically
- **Container Security:** Runs with `seccomp:unconfined` for Obsidian compatibility

## Use Cases

- **Always-on sync node:** Keep Obsidian Sync running 24/7 for instant sync across devices
- **Remote access:** Access your notes from any device with a VNC client
- **Backup solution:** Maintain a cloud-based copy of your vault
- **Shared workspace:** Multiple users can connect via VNC (shared mode enabled)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

This project is open source. See the repository for license details.

---

**Note:** Obsidian is a product of Obsidian MD. This project is not affiliated with or endorsed by Obsidian MD.
