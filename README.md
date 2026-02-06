# Obsidian Share (ob-share)

A headless Obsidian instance running in Docker for seamless note synchronization across all your devices. Access your Obsidian vault remotely via VNC from anywhere, with a Next.js web portal for authentication and future vault management.

## Overview

This project provides a cloud-based, containerized Obsidian installation that:
- Runs headless in Docker with a virtual display
- Provides remote desktop access via VNC
- Enables Obsidian Sync across all your devices
- Deploys to Railway with automatic CI/CD
- Includes a Next.js web portal with GitHub authentication

## Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Base OS | Ubuntu 22.04 | Container foundation |
| Container | Docker & Docker Compose | Containerization |
| Deployment | Railway | Cloud hosting |
| Display | Xvfb (Virtual Framebuffer) | Headless X11 display |
| Window Manager | Openbox | Minimal window management |
| Remote Access | x11vnc | VNC server (port 5900) |
| Web Framework | Next.js 15 | Web portal (port 3000) |
| PWA | @ducanh2912/next-pwa | Progressive Web App support |
| API | tRPC | Type-safe API layer |
| Authentication | Better Auth | GitHub OAuth |
| Database | SQLite + Drizzle ORM | User data and sessions |
| UI | shadcn/ui + Tailwind CSS | Component library |
| Theming | next-themes | Dark/light mode support |
| Process Manager | supervisord | Service orchestration |
| Logging | Pino | Structured logging (JSON in prod, pretty in dev) |
| Browser | Chromium + Puppeteer | Web fetching with JS rendering |
| Application | Obsidian v1.7.7 | Note-taking app |

## Project Structure

```
ob-share/
├── Dockerfile              # Multi-stage container image
├── docker-compose.yml      # Docker Compose configuration
├── entrypoint.sh           # Container startup script
├── railway.toml            # Railway deployment config
├── supervisord.conf        # Process manager config
├── package.json            # Node.js dependencies
├── .eslintrc.json          # ESLint configuration for Next.js and TypeScript
├── drizzle.config.ts       # Database configuration
├── .env.example            # Environment variables template
├── .gitignore              # Git ignore patterns
├── src/
│   ├── app/                # Next.js App Router pages
│   │   ├── page.tsx        # Landing page (logged out)
│   │   ├── dashboard/      # Main dashboard (logged in)
│   │   │   └── page.tsx    # Dashboard page with audio note button
│   │   ├── account/        # Account details section
│   │   │   └── page.tsx    # Account page
│   │   ├── settings/       # Vault and permission settings
│   │   │   └── page.tsx    # Settings page
│   │   ├── audio-note/     # Audio note recording
│   │   │   └── page.tsx    # Audio recording page
│   │   ├── share/          # Web Share Target display
│   │   │   └── page.tsx    # Share page (displays & saves content)
│   │   └── api/            # API routes
│   │       ├── auth/       # Authentication endpoints
│   │       ├── share/      # Share target POST handler
│   │       └── trpc/       # tRPC API endpoints
│   ├── components/         # React components
│   │   ├── dashboard-page.tsx # Main dashboard with audio note button
│   │   ├── account-page.tsx  # User account details
│   │   ├── avatar-dropdown.tsx # User avatar with dropdown menu
│   │   ├── share-page.tsx  # Share target authenticated view
│   │   ├── share-login.tsx # Share target login prompt
│   │   ├── settings-page.tsx # Vault and permission settings
│   │   ├── audio-note-page.tsx # Audio recording interface
│   │   ├── audio-permission-modal.tsx # Microphone permission dialog
│   │   ├── location-permission-modal.tsx # Location permission request dialog
│   │   └── ui/             # shadcn/ui components
│   ├── lib/                # Shared utilities
│   │   ├── auth.ts         # Better Auth configuration
│   │   ├── auth-client.ts  # Client-side auth
│   │   ├── share-store.ts  # Temporary storage for shared files
│   │   ├── vault.ts        # Obsidian vault file operations
│   │   ├── location.ts     # Geolocation and reverse geocoding
│   │   ├── audio.ts        # Audio recording and permission utilities
│   │   └── trpc/           # tRPC client/provider
│   └── server/
│       ├── db/             # Database schema and connection
│       ├── browser/        # Headless Chromium for web fetching
│       │   ├── browser-service.ts  # Puppeteer browser management
│       │   ├── cookie-store.ts     # Session/cookie status checking
│       │   └── index.ts            # Module exports
│       ├── trpc/           # tRPC routers (user, vault, settings, queue, browser)
│       ├── jobs/           # Async job queue system
│       │   ├── types.ts    # Type definitions
│       │   ├── base-job.ts # Base job class
│       │   ├── queue-handler.ts # Queue polling and job execution
│       │   ├── task-runner.ts   # Phase execution engine
│       │   ├── scheduler.ts     # 30-min interval processing
│       │   ├── job-service.ts   # Job CRUD operations
│       │   └── examples/        # Example job implementations
│       └── workflows/      # Agentic workflow system
│           ├── types.ts    # Workflow type definitions
│           ├── base-workflow.ts # Workflow definition base class
│           ├── orchestrator.ts  # Workflow execution engine
│           ├── registry.ts      # Workflow registry
│           ├── workflow-job.ts  # Job queue integration
│           ├── steps/           # Step implementations
│           │   ├── base-step.ts # Base step class
│           │   ├── llm-step.ts  # LLM call step
│           │   ├── tool-step.ts # Tool execution step
│           │   ├── decision-step.ts # LLM decision step
│           │   └── control-steps.ts # Parallel, transform, condition, loop
│           ├── tools/           # Tool implementations
│           │   ├── file-tools.ts # File system tools
│           │   └── http-tools.ts # HTTP request tools
│           └── examples/        # Example workflows
├── chrome-extension/       # Browser extension for desktop sharing
│   ├── manifest.json       # Extension manifest (Manifest V3)
│   ├── background.js       # Service worker for handling shares
│   ├── options.html        # Settings page
│   ├── note-popup.html     # Share with note popup
│   └── icons/              # Extension icons
├── drizzle/                # Database migrations
├── scripts/
│   ├── migrate.ts          # Database migration and seeding script
│   ├── generate-extension-icons.ts # Icon generation for extension
├── public/
│   ├── manifest.json       # PWA manifest with share target
│   ├── icon-192.svg        # PWA icon (192x192)
│   └── icon-512.svg        # PWA icon (512x512)
└── .github/
    └── workflows/          # GitHub Actions (if needed)
```

## Theme Support

The application supports dark and light themes:

| Feature | Description |
|---------|-------------|
| System preference | Automatically matches your OS theme preference |
| Manual toggle | Click the sun/moon icon in the top-right corner |
| Persistent | Theme choice is saved in local storage |

The theme toggle is available on all pages (landing, account, settings, and share pages).

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
   - **Homepage URL:** `http://localhost:3000` (local) or `https://ob-share.up.railway.app` (production)
   - **Authorization callback URL:** `http://localhost:3000/api/auth/callback/github` (local) or `https://ob-share.up.railway.app/api/auth/callback/github` (production)
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

# Run lint checks
pnpm lint
```

## Linting

The project includes a committed ESLint configuration (`.eslintrc.json`) extending:

- `next/core-web-vitals`
- `next/typescript`

Run lint checks with:

```bash
pnpm lint
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
| `ALLOW_LIST_USERS` | (empty) | Comma-separated GitHub usernames for allow list seeding |
| `VAULT_DATA_ROOT` | `/data/Documents` | Base path for vault storage (customizable for testing) |

**Note:** Vault path configuration has moved to in-app settings. See [Vault Settings](#vault-settings) below.

### Volumes

#### Local Development (Docker Compose)

| Local Path | Container Path | Purpose |
|------------|----------------|---------|
| `./vault` | `/home/obsidian/vault` | Your Obsidian notes (synced) |
| `./data` | `/data` | SQLite database |
| `obsidian-config` (named volume) | `/home/obsidian/.config/obsidian` | Obsidian settings |

#### Railway Deployment (Persistent Volume)

On Railway, a persistent volume is mounted at `/data` with the following structure:

| Volume Path | Purpose |
|-------------|---------|
| `/data/Documents` | Persistent document storage |
| `/data/obsidian-config` | Obsidian settings and sync data |
| `/data/ob-share.db` | SQLite database |

**Note:** Railway volumes mount as root user. For non-root containers, set `RAILWAY_RUN_UID=0`.

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

This endpoint is used by Railway for health checks with a 60-second timeout to allow time for database migrations and service startup.

### Allow List

The application uses a GitHub username allow list to restrict access. Initial users are seeded in the database during container startup from the `ALLOW_LIST_USERS` environment variable.

**Configuration:**
```bash
# Set in .env or Railway environment variables
ALLOW_LIST_USERS=user1,user2,user3
```

**Format:** Comma-separated list of GitHub usernames (spaces around commas are trimmed).

**Note:** If `ALLOW_LIST_USERS` is not set or empty, no users will be seeded to the allow list. You can also directly insert into the `allow_list` table in the SQLite database.

### Vault Settings

Each user must configure their vault settings before sharing content. Access the settings page from the Dashboard via the avatar dropdown.

| Setting | Description | Example |
|---------|-------------|---------|
| Vault Name | Name of your Obsidian vault folder | `my-vault` |
| Incoming Folder | Folder inside vault for shared content | `incoming` or `inbox/shared` |
| Location Sharing | Include location data in shared notes | Enabled/Disabled |
| Audio Recording | Allow recording audio notes | Enabled/Disabled |
| File Check Interval | How often to scan for new files (seconds) | `10` (default) |
| Text LLM Provider | AI provider for URL summarization | `anthropic` or `openai` |
| Text LLM API Key | API key for URL summarization | Your API key |
| Text LLM Model | Model to use for summarization | `claude-sonnet-4-20250514` or `gpt-4o` |

**Destination Path:** Files are saved to `/data/Documents/{vault-name}/{incoming-folder}/`

For example, with vault name `my-notes` and incoming folder `inbox`:
- Shared content saves to `/data/Documents/my-notes/inbox/`

**Important:**
- Both vault name and incoming folder settings are required before sharing works
- Do not include leading or trailing slashes
- The app shows an "Incomplete Setup" warning until configured
- Settings are stored per-user in the database

### Location Sharing

ob-share can include location data with your shared notes to help you remember where you captured content.

**How it works:**
1. On your first share, ob-share will ask for location permission
2. If granted, your notes will include location data (country, city, area, street)
3. If the exact area can't be determined, GPS coordinates are used as a fallback
4. If denied, notes are saved with "unknown" as the location

**Location data includes (when available):**
- Country
- City/Town
- Area/Neighborhood/Suburb
- Street

**Managing location permissions:**
- First-time prompt appears automatically when sharing content
- Manually enable/disable in the Settings page
- If you deny permission in the browser, you'll need to reset it in browser settings

**Privacy:**
- Location is determined using your device's GPS and reverse geocoding via OpenStreetMap (Nominatim)
- Location data is only saved to your notes, never stored on our servers
- You can disable location sharing at any time from Settings

### Audio Notes

ob-share allows you to record audio notes directly from the dashboard and save them to your Obsidian vault.

**How it works:**
1. From the dashboard, tap the large microphone button to start recording
2. On first use, the app will ask for microphone permission
3. Once granted, recording starts automatically
4. Tap "Stop & Save" to end the recording
5. The audio file is saved to your vault with a markdown note containing metadata

**Audio note features:**
- Recording starts automatically when you open the audio note page
- Visual feedback shows recording status and duration
- Location data is included if location sharing is enabled
- Audio is saved in WebM format (with Opus codec) for broad compatibility
- Each recording creates both an audio file and a linked markdown note

**Managing audio permissions:**
- First-time prompt appears when you tap the audio note button
- Manually enable/disable in the Settings page
- If you deny permission in the browser, you'll need to reset it in browser settings

**Privacy:**
- Audio is recorded only when you initiate recording
- Recordings are saved directly to your vault, never uploaded to external servers
- You can disable audio recording at any time from Settings

### Chromium Browser Sessions

ob-share includes a full Chromium browser for two purposes:
1. **UI Mode** - Log into websites via VNC to establish authenticated sessions
2. **Headless Mode** - Automatically fetch JavaScript-rendered content and authenticated pages

**How it works:**
1. Connect to VNC (port 5900) and open Chromium from the desktop
2. Log into websites you frequently share from (Twitter, Reddit, LinkedIn, etc.)
3. Close Chromium when done - sessions are saved to persistent storage
4. When you share a URL, the headless browser uses your saved sessions to fetch content
5. This enables extraction of:
   - **SPA content** - JavaScript-rendered pages that don't work with simple HTTP fetch
   - **Authenticated content** - Private posts, subscription content, logged-in views

**Session status:**
- View logged-in status in Settings → Browser Sessions
- Sessions persist across container restarts (stored in `/data/chromium-profile`)
- Re-login as needed if sessions expire

**Supported websites:**
| Website | Detection |
|---------|-----------|
| Twitter/X | Account switcher button |
| Reddit | User drawer button |
| LinkedIn | Profile photo in nav |
| Generic | Logout links, account links |

**Configuration:**
- Profile stored at: `/data/chromium-profile` (persistent volume)
- Chromium can be launched via VNC or supervisorctl

### Automated Content Extraction

ob-share includes an automated system that periodically scans your incoming folder for new notes and extracts information from attached media files.

**How it works:**
1. The system runs a periodic check (configurable interval, default: 10 seconds)
2. It scans the incoming folder for markdown files with `status: new` in frontmatter
3. For each new file, it detects the content type (audio, video, image, or URL)
4. It triggers an extraction workflow that processes the content using AI
5. Extracted information is added to the note with the original content preserved
6. The status is updated from `new` → `extracting` → `extracted`

**Content types and extraction:**

| Content Type | What Gets Extracted |
|--------------|---------------------|
| **Audio** | Speakers, transcription, intentions, background noises, mood, language |
| **Video** | Speakers, transcription, scenes, visible texts, locations, actions, objects |
| **Image** | Description, objects, people, visible text, diagrams, technical info, location |
| **URL** | Title, summary, key points, main content, author, publish date, capture diagnostics experiments |
| **Document** | Title, summary (meaning-focused, 2-3 sentences), key points (3-5 max) |

**Extracted information format:**
- Extracted content is added at the top of the note under `## Extracted [Type] Content`
- Original content is preserved under `## Original Content`
- Frontmatter is updated with `status`, `extractedAt`, and `contentType`
- Extraction normalizes misplaced frontmatter (when text appears before `---`) so notes are always rewritten with frontmatter at the top; leading noise is preserved as a diagnostic warning in the body instead of before frontmatter

**URL diagnostics in extracted notes:**
- URL extraction now runs built-in capture diagnostics during note processing
- Results are written into the same note under `### Capture Diagnostics`
- Diagnostics include: DevTools health, DevTools target inventory, cookie/session status, multiple browser-render attempts (network-idle and selector-driven), direct Puppeteer anti-bot probes, raw fetch baseline, an X syndication fallback probe when applicable, and a Reddit controlled fetch comparison (default vs desktop-UA selector mode) with selector checks/cookie-count telemetry
- For Reddit URLs, diagnostics summary now includes a concise recommended extraction mode line and extraction logs record the selected mode
- This works for any shared URL domain (X/Twitter, Reddit, etc.) using the URL from the note

**Configuration:**
- Adjust the file check interval in Settings (5-3600 seconds)
- API keys can be configured per-user in Settings or via environment variables:
  - **URL Summarization**: Configure in Settings → URL Summarization Settings
    - Choose provider: Anthropic (Claude) or OpenAI (GPT)
    - Enter your API key and select a model
  - **Audio Transcription**: Configure in Settings → AI Extraction Settings (OpenAI)
  - **Document Analysis**: Configure the model in Settings (default: gpt-4o)
  - **Image Analysis**: Uses `ANTHROPIC_API_KEY` environment variable
- Required environment variables (fallback if not configured in Settings):
  - `ANTHROPIC_API_KEY` for image analysis
  - `OPENAI_API_KEY` for audio transcription (whisper-1) and document analysis

**Supported document formats:**
- PDF files (`.pdf`)
- Microsoft Word (`.doc`, `.docx`)
- Text files (`.txt`, `.md`, `.markdown`)
- Rich Text Format (`.rtf`)
- OpenDocument Text (`.odt`)
- CSV files (`.csv`)
- reStructuredText (`.rst`)

### Navigation

The app uses a consistent header across all pages with an avatar dropdown menu in the top right corner.

**Avatar Dropdown Menu:**
- **Account** - View your account details and user information
- **Settings** - Configure vault settings and manage permissions
- **Sign out** - Log out of the application

**Main Pages:**
- **Dashboard** (`/dashboard`) - Main page after login with audio note button
- **Account** (`/account`) - User account details
- **Settings** (`/settings`) - Vault configuration, location and audio permissions
- **Audio Note** (`/audio-note`) - Audio recording interface
- **Share** (`/share`) - Displays content shared from other apps

## Architecture

### Process Management

The container uses supervisord to manage all services with automatic restart capabilities:

| Priority | Service | Description |
|----------|---------|-------------|
| 10 | nextjs | Next.js web portal (starts first for fast health checks) |
| 100 | xvfb | Virtual X11 framebuffer (display :5) |
| 200 | openbox | Minimal window manager |
| 300 | x11vnc | VNC server with password authentication |
| 400 | obsidian | Obsidian application (runs last) |
| 450 | chromium | Chromium browser (manual start via VNC) |

### Startup Flow

1. `entrypoint.sh` initializes persistent volume and VNC password
2. Database migrations run automatically
3. Database is seeded with initial allow list
4. supervisord launches services in priority order
5. Next.js starts first and serves the web portal (enables fast health checks)
6. Xvfb creates virtual display
7. Openbox provides window management
8. x11vnc exposes display over VNC
9. Obsidian starts in the virtual display

## Deployment

### Railway Deployment

The project is configured for Railway deployment with the following specifications:

| Setting | Value |
|---------|-------|
| App Name | `ob-share` |
| Builder | Dockerfile |
| Health Check | `/health` (60s timeout) |
| Restart Policy | On failure (max 3 retries) |

#### Setting Secrets (Manual Step)

Before deploying, set the required environment variables in Railway Dashboard:

1. Go to your Railway project → Service → Variables tab
2. Add the following variables:
   - `BETTER_AUTH_SECRET` - Generate with: `openssl rand -base64 32`
   - `BETTER_AUTH_URL` - Set to `https://ob-share.up.railway.app` (or your custom domain)
   - `GITHUB_CLIENT_ID` - From GitHub OAuth App
   - `GITHUB_CLIENT_SECRET` - From GitHub OAuth App
   - `DATABASE_URL` - Set to `/data/ob-share.db`
   - `HOSTNAME` - Set to `0.0.0.0`
   - `PORT` - Set to `3000`

#### Creating a Volume (Manual Step)

1. In Railway Dashboard, go to your project
2. Press `⌘K` (or right-click) and select "Add Volume"
3. Attach the volume to your service
4. Set mount path to `/data`

#### Automatic Deployment (GitHub Integration)

Railway's GitHub integration automatically deploys when you push to the connected branch.

**Setup:**
1. Create a Railway account at [railway.app](https://railway.app)
2. Create a new project from your GitHub repository
3. Railway will automatically deploy on every push to main

#### Manual Deployment

1. **Install Railway CLI:**
   ```bash
   npm install -g @railway/cli
   ```

2. **Authenticate:**
   ```bash
   railway login
   ```

3. **Link to your project:**
   ```bash
   railway link
   ```

4. **Deploy the application:**
   ```bash
   railway up
   ```

#### Connecting via VNC

VNC (port 5900) needs to be exposed via Railway's TCP Proxy:

1. **Enable TCP Proxy in Railway:**
   - Go to Service Settings → Networking
   - Add a TCP Proxy for port 5900
   - Note the provided public URL and port

2. **Connect with your VNC client:**
   - Open your VNC viewer (TigerVNC, RealVNC, etc.)
   - Connect to the Railway TCP proxy URL and port
   - Enter the VNC password (default: `obsidian`)

3. **Set up Obsidian (first time):**
   - Once connected, Obsidian will be running in the virtual display
   - Click "Open folder as vault" and select `/home/obsidian/Documents`
   - Log in with your Obsidian account (if using Obsidian Sync)
   - Enable Obsidian Sync to synchronize your notes across devices

## Database Management

### Running Migrations

Migrations run automatically on container startup using a TypeScript migration script that handles both Drizzle migrations and database seeding.

```bash
# Generate migration from schema changes
pnpm db:generate

# Run migrations with Drizzle Kit (interactive, for development)
pnpm db:migrate

# Run migrations programmatically (used by entrypoint, includes seeding)
pnpm db:migrate:run

# Push schema directly (development only)
pnpm db:push

# Open Drizzle Studio (database GUI)
pnpm db:studio
```

### Migration Script

The `scripts/migrate.ts` script handles:
1. Running Drizzle migrations from the `drizzle/` folder
2. Seeding the `allow_list` table with initial users
3. Creating default settings for existing users

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

## Browser Extension (Chrome/Vivaldi)

For desktop browsers, ob-share provides a private Chrome extension for one-click sharing.

### Features

| Feature | Description |
|---------|-------------|
| One-click share | Click the extension icon to instantly share the current page |
| Share with note | Add context or notes when sharing via right-click menu |
| Share links | Right-click any link to share it directly |
| Share selection | Select text and share it as a note |
| SPA-aware capture | Full-page capture waits for client-side rendering and chooses the most content-rich frame |
| Payload safeguards | Large DOM captures are trimmed to avoid API size-limit fallbacks |
| Configurable URL | Point to your own ob-share instance |

### Installing the Extension

1. **Download**: Click "Download Extension" from the dashboard
2. **Extract**: Unzip `ob-share-extension.zip` to a folder
3. **Open Extensions**: Navigate to `chrome://extensions` in your browser
4. **Developer Mode**: Enable the toggle in the top-right corner
5. **Load**: Click "Load unpacked" and select the extracted folder

The extension works with Chrome, Vivaldi, Edge, Brave, and other Chromium-based browsers.

> After updates, click **Reload** on `chrome://extensions` so new capture logic and host permissions are applied.

### Using the Extension

| Action | How To |
|--------|--------|
| Quick share | Click the extension icon in the toolbar |
| Share with note | Right-click on page → "Share with note..." |
| Share a link | Right-click on any link → "Share this link to ob-share" |
| Share selected text | Select text → Right-click → "Share selection to ob-share" |
| Settings | Right-click on page → "Settings" |

### Extension Settings

Access settings via the right-click context menu to configure:
- **ob-share URL**: Your ob-share instance URL (default: `https://ob-share.up.railway.app`)

## Troubleshooting

### Browser Extension Capture Issues

- **Only HTML shell captured on SPAs (X/Twitter, Reddit, etc.):** Use **Capture full page content** (or set default mode to `full_page`). The extension waits for render stabilization and prefers the frame with the most visible text.
- **Still getting shell content:** Reload the extension (to pick up new permissions), wait until the page visibly finishes loading, then retry capture.
- **Pages that block extension/script injection:** Browser-internal pages (`chrome://*`), extension pages, and some protected contexts cannot be captured and will fall back to URL-only mode.
- **Fallback to URL extraction unexpectedly:** This usually means captured payload was rejected (for example, too large). The extension now trims oversized payloads before upload; if it still happens, retry after reducing open side panels/popups on the page.

### X/Twitter URL Extraction Shows "JavaScript is not available"

- URL extraction now runs a built-in diagnostics matrix and writes details to the note under `### Capture Diagnostics`.
- URL fetch now uses ordered browser strategies before falling back to raw HTTP fetch:
  1. `browser-network-idle`
  2. `browser-selector` (uses `main,article` and Reddit-specific `main,article,[data-testid="post-container"]`)
  3. `browser-desktop-ua` (desktop Chrome UA + selector strategy)
  4. `fetch-fallback` (only after all browser strategies fail)
- Extraction metadata includes `fetchMethod` for traceability of which strategy succeeded.
- Current diagnostics include:
  - DevTools endpoint health and target inventory (`/json/version`, `/json/list`)
  - Cookie/session visibility for the target domain
  - Multiple browser fetch strategies (network-idle, selector-based, desktop UA + screenshot)
  - Direct Puppeteer anti-bot probes (console errors, request failures, webdriver value)
  - Raw fetch body/header baselines
  - X-specific URL variant comparison (`x.com` vs `twitter.com`) and syndication fallback check
  - Reddit controlled experiment comparing default mode vs desktop-UA selector mode, including status/final URL/title lengths, `navigator.userAgent`, key Reddit selector presence, and `.reddit.com` cookie count (count only)
- For Reddit URLs, diagnostics add a "Recommended extraction mode" summary line and URL extraction logs the selected recommendation for traceability.
- If DevTools connection checks fail, verify Chromium is running with `--remote-debugging-port=9222`.
- For production debugging, share a URL note and inspect the generated diagnostics section in the extracted markdown output.

### Workflow Build Issues

- **TypeScript decorator type error in `RegisterWorkflow`:** If `next build` fails with a `ClassDecorator` mismatch in `src/server/workflows/registry.ts`, ensure the decorator returns a function typed as a class constructor (`abstract new () => WorkflowDefinition`) and cast the returned function to `ClassDecorator`. This keeps compatibility with strict TypeScript and ESLint `no-unsafe-function-type` rules.

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

### Railway Deployment Issues

- **502 errors / "App not listening":** The app has a 60-second health check timeout. If you still see this error, check logs in Railway Dashboard → Service → Logs
- **Health check failures:** Verify the `/health` endpoint is accessible and returning 200
- **Volume not mounting:** Ensure volume is attached to the service and mount path is set to `/data`. Volumes only mount at runtime, not during build
- **Permission issues with volume:** Railway volumes mount as root. Set `RAILWAY_RUN_UID=0` if needed

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

## Async Job Queue

The application includes a robust async job queue system for handling background tasks with reliability and fault tolerance.

### Features

| Feature | Description |
|---------|-------------|
| Phase-based execution | Jobs are divided into idempotent phases that can be retried independently |
| Visibility timeouts | Prevents duplicate processing when handlers fail |
| Heartbeat monitoring | Detects dead handlers and recovers stalled jobs |
| Automatic retries | Failed jobs retry with exponential backoff |
| Manual triggering | Process queue on-demand via tRPC API |
| Scheduled processing | Runs every 30 minutes by default |
| Deployment resilience | Jobs survive deployments and are automatically recovered |

### Deployment Resilience

The job queue is designed to handle deployments gracefully. Jobs will not get stuck if a deployment occurs mid-execution.

| Feature | Description |
|---------|-------------|
| Visibility heartbeat | Long-running phases automatically extend visibility to prevent premature stalling |
| Graceful shutdown | Handler releases jobs immediately on shutdown, no waiting for timeout |
| Stalled phase recovery | Phases left in 'running' state are reset to 'pending' on reclaim |
| Orphan detection | Jobs from dead handlers are immediately reclaimed |
| Max execution time | Jobs that exceed maximum time are failed to prevent infinite runs |

**How it works during deployment:**

1. **Graceful shutdown signal received** → Handler cancels running jobs and releases them to "stalled" state
2. **Jobs immediately available** → No waiting for visibility timeout (5 min default)
3. **New handler starts** → Detects stalled jobs and any jobs from dead handlers
4. **Phase state check** → Any phases left in "running" are reset to "pending" for retry
5. **Execution resumes** → Previously completed phases are skipped (idempotent), only pending phases run

**Configuration:**

| Setting | Default | Description |
|---------|---------|-------------|
| Visibility heartbeat | 60s | How often to extend visibility during execution |
| Max job execution time | 1 hour | Maximum total time for a job before it's failed |
| Visibility timeout | 5 min | How long before a job becomes visible again |
| Heartbeat timeout | 2 min | How long before a handler is considered dead |

### Job Queue Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Job Service   │────▶│   Queue Handler  │────▶│   Task Runner   │
│  (Create/Query) │     │  (Poll/Claim)    │     │ (Execute Phases)│
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │   Heartbeat      │
                        │   (Health Check) │
                        └──────────────────┘
```

### Database Tables

| Table | Purpose |
|-------|---------|
| `jobs` | Main job queue with status, payload, and scheduling |
| `job_phases` | Individual phases within a job with retry tracking |
| `queue_handler_heartbeat` | Handler health monitoring |
| `queue_lock` | Prevents concurrent queue processing |

### Creating a Job

```typescript
import { createJob, JobPriority, JobRegistry } from "@/server/jobs";

// Register your job type first
JobRegistry.register(myJobDefinition);

// Create a job
const job = await createJob({
  type: "my-job-type",
  payload: { key: "value" },
  priority: JobPriority.NORMAL,
  maxRetries: 3,
});
```

### Defining a Job Type

```typescript
import { defineJob, JobPriority } from "@/server/jobs";

export const myJob = defineJob({
  type: "my-job",
  description: "Processes something in the background",
  defaultPriority: JobPriority.NORMAL,
  defaultMaxRetries: 3,

  phases: [
    {
      name: "validate",
      async execute(ctx) {
        // Validation logic (must be idempotent)
        return { success: true, output: { validated: true } };
      },
    },
    {
      name: "process",
      async execute(ctx) {
        // Main processing (must be idempotent)
        return { success: true, output: { result: "done" } };
      },
    },
  ],
});
```

### tRPC Endpoints

| Endpoint | Description |
|----------|-------------|
| `queue.getStats` | Get queue statistics (pending, processing, failed counts) |
| `queue.getHealth` | Check handler health and queue backlog |
| `queue.triggerProcessing` | Manually trigger queue processing |
| `queue.listJobs` | List jobs with filters |
| `queue.createJob` | Create a new job |
| `queue.cancelJob` | Cancel a pending job |
| `queue.retryJob` | Retry a failed job |

### Scheduler Configuration

The queue scheduler runs automatically with these defaults:

| Setting | Default | Description |
|---------|---------|-------------|
| Interval | 30 minutes | Time between queue processing runs |
| Visibility timeout | 5 minutes | Time before stalled jobs become visible again |
| Heartbeat interval | 30 seconds | How often handlers send heartbeats |
| Heartbeat timeout | 2 minutes | Time before a handler is considered dead |
| Cleanup interval | 6 hours | How often old jobs are cleaned up |
| Job retention | 7 days | How long completed/failed jobs are kept |

## Agentic Workflow System

The application includes a powerful agentic workflow system built on top of the async job queue for building multi-step, LLM-driven automation.

### Features

| Feature | Description |
|---------|-------------|
| LLM Integration | Built-in support for Anthropic and OpenAI providers |
| Structured Output | Zod schema-based structured responses from LLMs |
| Tool System | Extensible tool system for file I/O, HTTP, and custom actions |
| Decision Steps | LLM-driven routing between workflow branches |
| Parallel Execution | Run multiple steps concurrently |
| Fault Tolerance | Built on job queue with retries and error handling |
| Event System | Real-time workflow and step execution events |

### Workflow Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌───────────────┐
│   Trigger   │────▶│   Orchestrator   │────▶│    Steps      │
│   (Input)   │     │   (Execution)    │     │ (LLM/Tools)   │
└─────────────┘     └──────────────────┘     └───────────────┘
                           │                        │
                           ▼                        ▼
                    ┌──────────────┐         ┌─────────────┐
                    │   Registry   │         │   Result    │
                    │  (Workflows) │         │  (Output)   │
                    └──────────────┘         └─────────────┘
```

### Step Types

| Type | Description |
|------|-------------|
| `llm-call` | Makes an LLM API call with structured output support |
| `tool-call` | Executes a registered tool (file I/O, HTTP, etc.) |
| `decision` | LLM evaluates context and picks next step(s) |
| `parallel` | Runs multiple steps concurrently |
| `transform` | Transforms data without LLM calls |
| `condition` | Conditional branching based on expressions |
| `loop` | Iterates over collections |

### Defining a Workflow

```typescript
import {
  workflow,
  defineLLMStep,
  defineDecisionStep,
  defineToolStep,
  WorkflowPriority,
} from "@/server/workflows";
import { z } from "zod";

const myWorkflow = workflow("my-workflow", "My Workflow")
  .description("Processes incoming content")
  .priority(WorkflowPriority.NORMAL)
  .trigger(z.object({ content: z.string() }))

  // LLM classification step
  .step(defineLLMStep({
    id: "classify",
    name: "Classify Content",
    userPrompt: (ctx) => `Classify: ${ctx.trigger.content}`,
    structuredOutput: {
      schema: z.object({
        category: z.string(),
        confidence: z.number(),
      }),
    },
  }))

  // Decision step
  .step(defineDecisionStep({
    id: "decide",
    name: "Decide Action",
    prompt: "What should we do with this content?",
    options: [
      { id: "save", name: "Save", description: "Save to vault", nextStepId: "save-step" },
      { id: "skip", name: "Skip", description: "Skip processing", nextStepId: "done" },
    ],
  }))

  .entryStep("classify")
  .transition("classify", "decide")
  .build();
```

### Executing Workflows

```typescript
import { executeWorkflow, createWorkflowJob } from "@/server/workflows";

// Direct execution (synchronous)
const result = await executeWorkflow("my-workflow", {
  content: "Hello world",
});

// Via job queue (asynchronous, fault-tolerant)
const jobId = await createWorkflowJob({
  workflowId: "my-workflow",
  trigger: { content: "Hello world" },
});
```

### Built-in Tools

| Tool | Category | Description |
|------|----------|-------------|
| `read-file` | file | Read file contents |
| `write-file` | file | Write content to file |
| `append-file` | file | Append to file |
| `file-exists` | file | Check file existence |
| `list-directory` | file | List directory contents |
| `http-request` | http | Make HTTP request |
| `http-get` | http | Simple GET request |
| `http-post` | http | Simple POST request |
| `echo` | testing | Echo input back |
| `delay` | testing | Wait for duration |

### Creating Custom Tools

```typescript
import { defineTool, ToolRegistry } from "@/server/workflows";
import { z } from "zod";

const myTool = defineTool({
  name: "my-tool",
  description: "Does something useful",
  category: "custom",
  inputSchema: z.object({ input: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  execute: async (input, context) => {
    context.logger.info("Executing tool");
    return {
      success: true,
      output: { result: `Processed: ${input.input}` },
    };
  },
});

ToolRegistry.register(myTool);
```

## Security Considerations

- **VNC Password:** Change the default password in production
- **Network Exposure:** VNC requires TCP Proxy setup in Railway to access externally
- **Authentication:** GitHub OAuth with allow list restricts access
- **Secrets:** Never commit `.env` files or secrets to version control
- **HTTPS:** Enforced automatically on Railway
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
