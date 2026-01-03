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
| `src/components/share-page.tsx` | Authenticated share view |
| `src/components/share-login.tsx` | Unauthenticated share login prompt |

### Share Target Parameters

The manifest configures the share target to accept:
- `title` - Shared content title
- `text` - Shared text content
- `url` - Shared URL
- `media` - Shared files (images, audio, video, PDFs)

### Key Share Target Files

| File | Purpose |
|------|---------|
| `src/app/share/route.ts` | POST handler for file uploads |
| `src/lib/share-store.ts` | Temporary in-memory storage for shared data |

### Modifying Share Behavior

To change how shared content is processed:
1. Update `src/components/share-page.tsx` for authenticated file/content display
2. Update `src/app/share/route.ts` to modify file processing
3. The share data is stored temporarily and retrieved by ID
4. Authentication check happens in `src/app/share/page.tsx`

### File Sharing Implementation

The app accepts shared files via POST with multipart/form-data:
- Files are converted to base64 data URLs for display
- Maximum file size: 10MB per file
- Supported types: images, audio, video, PDFs
- Files are stored in memory with 5-minute expiry

To modify accepted file types, update `public/manifest.json`:
```json
"files": [
  {
    "name": "media",
    "accept": ["image/*", "audio/*", "video/*", "application/pdf"]
  }
]
```
