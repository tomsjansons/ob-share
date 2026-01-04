# AGENTS.md

Instructions for AI agents working on this repository.

## Documentation Requirements

**IMPORTANT:** After making any changes to this project, you MUST:

1. **Read the README.md** file to understand the current documentation state
2. **Update the README.md** to reflect your changes, including:
   - New features or functionality
   - Configuration changes (environment variables, ports, volumes)
   - New files or modified project structure
   - Updated dependencies or technology stack
   - New setup steps or prerequisites
   - Changes to deployment process
   - New troubleshooting scenarios

## What to Update

| Change Type | README Sections to Update |
|-------------|---------------------------|
| New files | Project Structure |
| New env variables | Configuration > Environment Variables |
| New ports | Configuration > Port Mappings |
| New volumes | Configuration > Volumes |
| New dependencies | Technology Stack |
| Setup changes | Quick Start |
| Architecture changes | Architecture |
| Deployment changes | Deployment |
| New issues/fixes | Troubleshooting |
| PWA changes | Progressive Web App (PWA) |
| Share target changes | Progressive Web App (PWA) > Web Share Target |

## Guidelines

- Keep documentation concise and accurate
- Use consistent formatting (tables, code blocks)
- Update version numbers when applicable
- Remove outdated information
- Test any commands or instructions you document

## PWA and Share Target

The app includes Progressive Web App functionality with Web Share Target API support.

### Key PWA Files

| File | Purpose |
|------|---------|
| `public/manifest.json` | PWA manifest with share_target configuration |
| `public/icon-192.svg` | App icon (192x192) |
| `public/icon-512.svg` | App icon (512x512) |
| `next.config.ts` | PWA plugin configuration (@ducanh2912/next-pwa) |
| `src/app/layout.tsx` | PWA meta tags and manifest link |
| `src/app/share/page.tsx` | Share target handler (server component) |
| `src/app/settings/page.tsx` | Vault settings page |
| `src/components/share-page.tsx` | Authenticated share view |
| `src/components/share-login.tsx` | Unauthenticated share login prompt |
| `src/components/settings-page.tsx` | Vault settings form |

### Share Target Parameters

The manifest configures the share target to accept:
- `title` - Shared content title
- `text` - Shared text content
- `url` - Shared URL
- `media` - Shared files (images, audio, video, PDFs)

### Key Share Target Files

| File | Purpose |
|------|---------|
| `src/app/api/share/route.ts` | POST handler for file uploads |
| `src/lib/share-store.ts` | Temporary in-memory storage for shared data |

### Modifying Share Behavior

To change how shared content is processed:
1. Update `src/components/share-page.tsx` for authenticated file/content display
2. Update `src/app/api/share/route.ts` to modify file processing
3. The share data is stored temporarily and retrieved by ID
4. Authentication check happens in `src/app/share/page.tsx`

### File Sharing Implementation

The app accepts shared files via POST with multipart/form-data:
- Files are converted to base64 data URLs for display
- Maximum file size: 10MB per file
- Supported types: images, audio, video, PDFs
- Files are stored in memory with 5-minute expiry

To modify accepted file types, update `public/manifest.json`. Include both MIME types and file extensions for reliable cross-device compatibility:
```json
"files": [
  {
    "name": "media",
    "accept": [
      "image/*", "image/jpeg", "image/png", ".jpg", ".png",
      "audio/*", "audio/mpeg", ".mp3",
      "video/*", "video/mp4", ".mp4",
      "application/pdf", ".pdf"
    ]
  }
]
```

## Vault Integration

The app saves shared content to the Obsidian vault automatically. Vault path is configured per-user via the settings page.

### Key Vault Files

| File | Purpose |
|------|---------|
| `src/lib/vault.ts` | Vault file operations (save notes, handle attachments) |
| `src/server/trpc/routers/vault.ts` | tRPC router for vault operations |
| `src/server/trpc/routers/settings.ts` | tRPC router for user settings |
| `src/server/db/schema.ts` | Database schema including `userSettings` table |

### User Settings

Each user must configure their vault settings before sharing works:
- **Vault Name**: Name of the Obsidian vault folder (e.g., `my-vault`)
- **Incoming Folder**: Folder inside vault for shared content (e.g., `incoming`)

Settings are stored in the `user_settings` table with foreign key to `user`.

### Vault Save Flow

1. User shares content → POST to `/api/share`
2. Content stored temporarily in memory (`share-store.ts`)
3. Share page loads and displays content
4. Settings are checked - if incomplete, warning shown with link to settings
5. If settings complete, tRPC mutation `vault.saveSharedContent` is called
6. User settings fetched from database to construct path
7. Markdown note created at `/data/Documents/{vault-name}/{incoming-folder}/{timestamp}-{name}.md`
8. Attachments saved alongside with same naming convention

### Frontmatter Schema

Notes include YAML frontmatter with these fields:
- `location`: String describing share location (country, city, area, street)
- `created`: ISO 8601 timestamp
- `status`: String indicating note status (defaults to "new")
- `tags`: Array of strings (empty by default)
- `projects`: Array of strings (empty by default)

### Modifying Vault Behavior

To change how content is saved to the vault:
1. Update `src/lib/vault.ts` for file operations and frontmatter generation
2. Update `src/server/trpc/routers/vault.ts` for API changes
3. Update `src/server/trpc/routers/settings.ts` for settings changes
4. Update `src/components/share-page.tsx` for UI feedback
5. Update `src/components/settings-page.tsx` for settings UI

### Path Configuration

Vault paths are now configured per-user via settings:
- Base path: `/data/Documents`
- Full path: `/data/Documents/{vault-name}/{incoming-folder}/`
- Settings created automatically on user signup
- Settings can be modified anytime from the settings page
