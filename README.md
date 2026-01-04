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
| PWA | @ducanh2912/next-pwa | Progressive Web App support |
| API | tRPC | Type-safe API layer |
| Authentication | Better Auth | GitHub OAuth |
| Database | SQLite + Drizzle ORM | User data and sessions |
| UI | shadcn/ui + Tailwind CSS | Component library |
| Process Manager | supervisord | Service orchestration |
| Logging | Pino | Structured JSON logging |
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
├── scripts/
│   └── run-migrations.sh   # Database migration script (runs via supervisor)
├── src/
│   ├── app/                # Next.js App Router pages
│   │   ├── page.tsx        # Landing page (logged out)
│   │   ├── account/        # Account page (logged in)
│   │   ├── settings/       # Vault settings configuration
│   │   │   └── page.tsx    # Settings page
│   │   ├── share/          # Web Share Target display
│   │   │   └── page.tsx    # Share page (displays & saves content)
│   │   └── api/            # API routes
│   │       ├── auth/       # Authentication endpoints
│   │       ├── share/      # Share target POST handler
│   │       └── trpc/       # tRPC API endpoints
│   ├── components/         # React components
│   │   ├── share-page.tsx  # Share target authenticated view
│   │   ├── share-login.tsx # Share target login prompt
│   │   ├── settings-page.tsx # Vault settings configuration
│   │   └── ui/             # shadcn/ui components
│   ├── lib/                # Shared utilities
│   │   ├── auth.ts         # Better Auth configuration
│   │   ├── auth-client.ts  # Client-side auth
│   │   ├── share-store.ts  # Temporary storage for shared files
│   │   ├── vault.ts        # Obsidian vault file operations
│   │   └── trpc/           # tRPC client/provider
│   └── server/
│       ├── db/             # Database schema and connection
│       └── trpc/           # tRPC routers (user, vault, settings)
├── drizzle/                # Database migrations
├── public/
│   ├── manifest.json       # PWA manifest with share target
│   ├── icon-192.svg        # PWA icon (192x192)
│   └── icon-512.svg        # PWA icon (512x512)
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
| `LOG_LEVEL` | `debug` (dev) / `info` (prod) | Logging level (trace, debug, info, warn, error, fatal) |

**Note:** Vault path configuration has moved to in-app settings. See [Vault Settings](#vault-settings) below.

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

### Health Check Endpoint

The application exposes a health check endpoint at `/health` for container orchestration and monitoring:

| Endpoint | Method | Response |
|----------|--------|----------|
| `/health` | GET | `{"status": "ok"}` (200 OK) |

This endpoint is used by Fly.io for health checks with a 30-second grace period to allow time for database migrations and service startup.

### Allow List

The application uses a GitHub username allow list to restrict access. Initial users are seeded in the database during container startup. Currently, the allow list contains:
- `tomsjansons`

To add more users, you can directly insert into the `allow_list` table in the SQLite database.

### Vault Settings

Each user must configure their vault settings before sharing content. Access the settings page from the Account page.

| Setting | Description | Example |
|---------|-------------|---------|
| Vault Name | Name of your Obsidian vault folder | `my-vault` |
| Incoming Folder | Folder inside vault for shared content | `incoming` or `inbox/shared` |

**Destination Path:** Files are saved to `/data/Documents/{vault-name}/{incoming-folder}/`

For example, with vault name `my-notes` and incoming folder `inbox`:
- Shared content saves to `/data/Documents/my-notes/inbox/`

**Important:**
- Both settings are required before sharing works
- Do not include leading or trailing slashes
- The app shows an "Incomplete Setup" warning until configured
- Settings are stored per-user in the database

## Architecture

### Process Management

The container uses supervisord to manage all services with automatic restart capabilities:

| Priority | Service | Description |
|----------|---------|-------------|
| 10 | nextjs | Next.js web portal (starts first for fast health checks) |
| 20 | migrations | Database migrations and seeding (runs once) |
| 100 | xvfb | Virtual X11 framebuffer (display :5) |
| 200 | openbox | Minimal window manager |
| 300 | x11vnc | VNC server with password authentication |
| 400 | obsidian | Obsidian application (runs last) |

### Startup Flow

1. `entrypoint.sh` initializes persistent volume and VNC password
2. supervisord launches services in priority order
3. Next.js starts first and serves the web portal (enables fast Fly.io health checks)
4. Database migrations run automatically
5. Database is seeded with initial allow list
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
| Auto-stop | Disabled (always running) |

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

## Progressive Web App (PWA)

The web portal is a Progressive Web App that can be installed on mobile devices and supports the Web Share Target API.

### Features

| Feature | Description |
|---------|-------------|
| Installable | Add to home screen on Android/iOS |
| Offline Support | Service worker caches assets |
| Share Target | Receive shared content from other apps |
| Native Feel | Standalone display mode |

### Installing on Android

1. Open the web portal in Chrome
2. Tap the menu (three dots) → "Add to Home screen"
3. The app will appear on your home screen with the ob-share icon

### Web Share Target

When installed as a PWA, ob-share appears as a share target in Android's share menu. You can share:
- **URLs** from browsers or other apps
- **Text** from any app with share functionality
- **Titles** (when provided by the sharing app)
- **Images** (JPEG, PNG, GIF, WebP, etc.)
- **Audio** files (MP3, WAV, etc.)
- **Video** files (MP4, WebM, etc.)
- **PDF** documents

**File Size Limit:** Files up to 10MB are supported. Larger files will be skipped.

**Authentication Required:** Users must be logged in to receive shared content. If not authenticated, the app will prompt for GitHub login while preserving text data. Note: Files cannot be preserved across the login redirect and must be re-shared after signing in.

### Share Target Flow

1. Share content from any app → Select "ob-share"
2. If not logged in → Login prompt appears (share data preserved)
3. After authentication → Shared content is displayed
4. If vault settings not configured → Warning shown with link to settings
5. Once configured → Content automatically saved to vault
6. Content is saved as a markdown file in the configured incoming folder

### Vault Integration

Shared content is automatically saved to your Obsidian vault when received (after configuring vault settings). Each share creates:

**Markdown Note:** `/data/Documents/{vault-name}/{incoming-folder}/{date}-{time}-{name}.md`

The note includes YAML frontmatter with metadata:
```yaml
---
location: "country, city, area, street"  # From geolocation (if available)
created: 2024-01-15T10:30:00.000Z
status: "new"
tags: []
projects: []
---
```

**Attachments:** Non-text files (images, audio, video, PDFs) are saved alongside the note and linked using Obsidian's wiki-link syntax:
- Images: `![[filename.jpg]]` (embedded)
- Other files: `[[filename.pdf]]` (linked)

### PWA Configuration

The PWA is configured in:
- `public/manifest.json` - App manifest with share target config
- `next.config.ts` - PWA plugin configuration
- `src/app/layout.tsx` - Meta tags and theme colors

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

### Fly.io Deployment Issues

- **502 errors / "App not listening":** The app has a 30-second grace period for startup. If you still see this error, check logs with `fly logs -a ob-share`
- **Health check failures:** Verify the `/health` endpoint is accessible and returning 200
- **HOSTNAME override:** Fly.io overrides the `HOSTNAME` environment variable with the machine ID. The `fly.toml` explicitly sets `HOSTNAME = "0.0.0.0"` to ensure Next.js binds to all interfaces

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
- **Mobile sharing:** Share URLs, text, and content from mobile apps directly to ob-share
- **Quick capture:** Use the PWA as a share target for rapid content capture on the go

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

This project is open source. See the repository for license details.

---

**Note:** Obsidian is a product of Obsidian MD. This project is not affiliated with or endorsed by Obsidian MD.
