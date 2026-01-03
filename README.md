# Obsidian Share (ob-share)

A headless Obsidian instance running in Docker for seamless note synchronization across all your devices. Access your Obsidian vault remotely via VNC from anywhere, with a Next.js web portal for authentication and future vault management.

## Overview

This project provides a cloud-based, containerized Obsidian installation that:
- Runs headless in Docker with a virtual display
- Provides remote desktop access via VNC
- Enables Obsidian Sync across all your devices
- Deploys to Fly.io with automatic CI/CD
- Includes a Next.js web portal with GitHub authentication

## Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Base OS | Ubuntu 22.04 | Container foundation |
| Container | Docker & Docker Compose | Containerization |
| Deployment | Fly.io | Cloud hosting |
| Display | Xvfb (Virtual Framebuffer) | Headless X11 display |
| Window Manager | Openbox | Minimal window management |
| Remote Access | x11vnc | VNC server (port 5900) |
| Web Framework | Next.js 15 | Web portal (port 3000) |
| API | tRPC | Type-safe API layer |
| Authentication | Better Auth | GitHub OAuth |
| Database | SQLite + Drizzle ORM | User data and sessions |
| UI | shadcn/ui + Tailwind CSS | Component library |
| Process Manager | supervisord | Service orchestration |
| Application | Obsidian v1.7.7 | Note-taking app |

## Project Structure

```
ob-share/
├── Dockerfile              # Multi-stage container image
├── docker-compose.yml      # Docker Compose configuration
├── entrypoint.sh           # Container startup script
├── fly.toml                # Fly.io deployment config
├── supervisord.conf        # Process manager config
├── package.json            # Node.js dependencies
├── drizzle.config.ts       # Database configuration
├── .env.example            # Environment variables template
├── .gitignore              # Git ignore patterns
├── src/
│   ├── app/                # Next.js App Router pages
│   │   ├── page.tsx        # Landing page (logged out)
│   │   ├── account/        # Account page (logged in)
│   │   └── api/            # API routes (auth, tRPC)
│   ├── components/         # React components
│   │   └── ui/             # shadcn/ui components
│   ├── lib/                # Shared utilities
│   │   ├── auth.ts         # Better Auth configuration
│   │   ├── auth-client.ts  # Client-side auth
│   │   └── trpc/           # tRPC client/provider
│   └── server/
│       ├── db/             # Database schema and connection
│       └── trpc/           # tRPC routers
├── drizzle/                # Database migrations
├── public/                 # Static assets
└── .github/
    └── workflows/
        └── fly-deploy.yml  # CI/CD workflow
```

## Quick Start

### Prerequisites

- Docker and Docker Compose installed
- Node.js 20+ and pnpm installed
- A VNC viewer (e.g., TigerVNC, RealVNC, or any VNC client)
- A GitHub OAuth App (for authentication)
- (Optional) Obsidian Sync subscription for cloud sync

### GitHub OAuth Setup

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click "New OAuth App"
3. Fill in the details:
   - **Application name:** ob-share
   - **Homepage URL:** `http://localhost:3000` (local) or `https://ob-share.fly.dev` (production)
   - **Authorization callback URL:** `http://localhost:3000/api/auth/callback/github` (local) or `https://ob-share.fly.dev/api/auth/callback/github` (production)
4. Copy the Client ID and generate a Client Secret

### Local Setup

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd ob-share
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and fill in:
   - `BETTER_AUTH_SECRET` - Generate with: `openssl rand -base64 32`
   - `GITHUB_CLIENT_ID` - From GitHub OAuth App
   - `GITHUB_CLIENT_SECRET` - From GitHub OAuth App

4. **Build and start the container:**
   ```bash
   docker compose up -d
   ```

5. **Access the services:**
   - **Web Portal:** Open `http://localhost:3000` in your browser
   - **VNC Access:** Connect to `localhost:5900` with your VNC viewer

6. **Set up Obsidian:**
   - In the VNC session, open the vault at `/home/obsidian/Documents`
   - Log in with your Obsidian account
   - Enable Obsidian Sync to synchronize notes

### Development Mode

For local development without Docker:

```bash
# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env
# Edit .env with your values

# Generate database and run migrations
pnpm db:push

# Start development server
pnpm dev
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VNC_PASSWORD` | `obsidian` | Password for VNC remote access |
| `SCREEN_RESOLUTION` | `1280x720x24` | Virtual display resolution |
| `DATABASE_URL` | `./data/ob-share.db` | SQLite database path |
| `BETTER_AUTH_SECRET` | (required) | Secret for session encryption |
| `BETTER_AUTH_URL` | `http://localhost:3000` | Base URL for auth callbacks |
| `GITHUB_CLIENT_ID` | (required) | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | (required) | GitHub OAuth client secret |

### Volumes

#### Local Development (Docker Compose)

| Local Path | Container Path | Purpose |
|------------|----------------|---------|
| `./vault` | `/home/obsidian/vault` | Your Obsidian notes (synced) |
| `./data` | `/data` | SQLite database |
| `obsidian-config` (named volume) | `/home/obsidian/.config/obsidian` | Obsidian settings |

#### Fly.io Deployment (Persistent Volume)

On Fly.io, a persistent volume is mounted at `/data` with the following structure:

| Volume Path | Purpose |
|-------------|---------|
| `/data/Documents` | Persistent document storage |
| `/data/obsidian-config` | Obsidian settings and sync data |
| `/data/ob-share.db` | SQLite database |

### Port Mappings

| Port | Service | Protocol |
|------|---------|----------|
| 5900 | x11vnc (VNC) | TCP |
| 3000 | Next.js (HTTP) | TCP |

### Allow List

The application uses a GitHub username allow list to restrict access. Initial users are seeded in the database during container startup. Currently, the allow list contains:
- `tomsjansons`

To add more users, you can directly insert into the `allow_list` table in the SQLite database.

## Architecture

### Process Management

The container uses supervisord to manage all services with automatic restart capabilities:

| Priority | Service | Description |
|----------|---------|-------------|
| 50 | nextjs | Next.js web portal |
| 100 | xvfb | Virtual X11 framebuffer (display :5) |
| 200 | openbox | Minimal window manager |
| 300 | x11vnc | VNC server with password authentication |
| 400 | obsidian | Obsidian application (runs last) |

### Startup Flow

1. `entrypoint.sh` initializes persistent volume and VNC password
2. Database migrations run automatically
3. Database is seeded with initial allow list
4. supervisord launches services in priority order
5. Next.js starts and serves the web portal
6. Xvfb creates virtual display
7. Openbox provides window management
8. x11vnc exposes display over VNC
9. Obsidian starts in the virtual display

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

#### Setting Secrets

Before deploying, set the required secrets:

```bash
flyctl secrets set BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
flyctl secrets set GITHUB_CLIENT_ID="your-client-id"
flyctl secrets set GITHUB_CLIENT_SECRET="your-client-secret"
```

#### Automatic Deployment (CI/CD)

Pushes to the `main` branch trigger automatic deployment via GitHub Actions.

**Setup:**
1. Create a Fly.io account and install `flyctl`
2. Run `flyctl auth token` to get your API token
3. Add `FLY_API_TOKEN` as a secret in your GitHub repository settings
4. Push to `main` to trigger deployment

#### Manual Deployment

1. **Install Fly CLI:**
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Authenticate:**
   ```bash
   flyctl auth login
   ```

3. **Create the persistent volume (first time only):**
   ```bash
   flyctl volumes create obsidian_data --region arn --size 1
   ```

4. **Deploy the application:**
   ```bash
   flyctl deploy --remote-only --ha=false
   ```

#### Connecting via VNC

Since VNC (port 5900) is not exposed publicly, use `fly proxy` to create a secure tunnel:

1. **Start the proxy:**
   ```bash
   fly proxy 5900:5900 -a ob-share
   ```

2. **Connect with your VNC client:**
   - Open your VNC viewer (TigerVNC, RealVNC, etc.)
   - Connect to `localhost:5900`
   - Enter the VNC password (default: `obsidian`)

3. **Set up Obsidian (first time):**
   - Once connected, Obsidian will be running in the virtual display
   - Click "Open folder as vault" and select `/home/obsidian/Documents`
   - Log in with your Obsidian account (if using Obsidian Sync)
   - Enable Obsidian Sync to synchronize your notes across devices

## Database Management

### Running Migrations

Migrations run automatically on container startup. For manual migration:

```bash
# Generate migration from schema changes
pnpm db:generate

# Apply migrations
pnpm db:migrate

# Push schema directly (development only)
pnpm db:push

# Open Drizzle Studio (database GUI)
pnpm db:studio
```

## Troubleshooting

### VNC Connection Issues

- **Connection refused:** Ensure the container is running (`docker compose ps`)
- **Authentication failed:** Check your `VNC_PASSWORD` in `.env`
- **Black screen:** Wait a few seconds for Obsidian to fully start

### Authentication Issues

- **Access denied:** Your GitHub username is not on the allow list
- **OAuth error:** Check that callback URLs match in GitHub OAuth settings

### Display Issues

- **Resolution problems:** Adjust `SCREEN_RESOLUTION` in `.env`
- **Format:** `WIDTHxHEIGHTxCOLOR_DEPTH` (e.g., `1920x1080x24`)

### Container Logs

```bash
# View all logs
docker compose logs -f

# View specific service logs
docker compose logs obsidian

# View Next.js logs in container
docker compose exec obsidian cat /var/log/supervisor/nextjs.log
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
- **Network Exposure:** VNC is not exposed publicly on Fly.io
- **Authentication:** GitHub OAuth with allow list restricts access
- **Secrets:** Never commit `.env` files or secrets to version control
- **HTTPS:** Enforced automatically on Fly.io
- **Container Security:** Runs with `seccomp:unconfined` for Obsidian compatibility

## Use Cases

- **Always-on sync node:** Keep Obsidian Sync running 24/7 for instant sync across devices
- **Remote access:** Access your notes from any device with a VNC client
- **Backup solution:** Maintain a cloud-based copy of your vault
- **Shared workspace:** Multiple users can connect via VNC (shared mode enabled)
- **Future:** AI-powered content sharing and processing through the web portal

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

This project is open source. See the repository for license details.

---

**Note:** Obsidian is a product of Obsidian MD. This project is not affiliated with or endorsed by Obsidian MD.
