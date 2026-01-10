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
| Dashboard changes | Navigation |
| Audio feature changes | Audio Notes |

## Guidelines

- Keep documentation concise and accurate
- Use consistent formatting (tables, code blocks)
- Update version numbers when applicable
- Remove outdated information
- Test any commands or instructions you document

## Navigation and Dashboard

The app uses a consistent layout pattern with a header containing the logo, theme toggle, and avatar dropdown menu.

### Key Navigation Files

| File | Purpose |
|------|---------|
| `src/app/dashboard/page.tsx` | Main dashboard route (entry point after login) |
| `src/components/dashboard-page.tsx` | Dashboard with audio note button |
| `src/components/avatar-dropdown.tsx` | User menu with Account/Settings/Sign out |
| `src/components/theme-toggle.tsx` | Theme switcher (light/dark/system) |

### Navigation Structure

After login, users land on `/dashboard`. All pages have a consistent header:
- **Logo/Title** (left) - Links back to dashboard
- **Theme Toggle** (right) - Sun/moon icon
- **Avatar Dropdown** (right) - User menu with navigation links

### Avatar Dropdown Menu

The avatar dropdown (`src/components/avatar-dropdown.tsx`) provides:
- User name and email display
- Link to Account page
- Link to Settings page
- Sign out button

### Adding New Pages with Navigation

1. Create the route in `src/app/{page-name}/page.tsx`
2. Create the component in `src/components/{page-name}-page.tsx`
3. Include the standard header with:
   - `<Link href="/dashboard">` for logo
   - `<ThemeToggle />` for theme switching
   - `<AvatarDropdown user={user} />` for user menu
4. Optionally add to avatar dropdown if it's a primary navigation destination

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
| `src/app/dashboard/page.tsx` | Main dashboard page |
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

## Frontmatter Handling

**IMPORTANT:** All YAML frontmatter parsing and building MUST use the `gray-matter` library via the shared utilities in `src/lib/frontmatter.ts`.

### Key Frontmatter Files

| File | Purpose |
|------|---------|
| `src/lib/frontmatter.ts` | Shared utilities wrapping gray-matter |

### Available Functions

```typescript
import { parseFrontmatter, buildMarkdown, updateFrontmatter, hasFrontmatter } from "@/lib/frontmatter";

// Parse markdown with frontmatter
const parsed = parseFrontmatter(content);
// parsed.data - frontmatter as object
// parsed.content - body content without frontmatter

// Build markdown from frontmatter data and body
const markdown = buildMarkdown(data, body);

// Update frontmatter while preserving body
const updated = updateFrontmatter(content, { status: "extracted" });

// Check if content has frontmatter
const has = hasFrontmatter(content);
```

### Guidelines

1. **Never implement custom frontmatter parsing** - Always use the shared utilities
2. **Never manually build YAML strings** - Use `buildMarkdown()` to properly escape values
3. **Use `parsed.data` and `parsed.content`** - These are the gray-matter output properties
4. **Re-export types from gray-matter** - Don't create new types, use `GrayMatterFile<string>`

### Why gray-matter?

- Robust YAML parsing that handles edge cases (multiline strings, special characters, etc.)
- Consistent escaping across all files
- Well-tested library used by many markdown tools
- Prevents bugs from inconsistent custom implementations

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
- **Text LLM Provider**: AI provider for URL summarization (`anthropic` or `openai`)
- **Text LLM API Key**: API key for the selected provider
- **Text LLM Model**: Model to use for URL summarization

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
- `location`: String describing share location (country, city, area, street) or "unknown" if not available
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

## Location Sharing

The app includes location sharing functionality that adds geographic context to shared notes.

### Key Location Files

| File | Purpose |
|------|---------|
| `src/lib/location.ts` | Client-side geolocation and reverse geocoding |
| `src/components/location-permission-modal.tsx` | Permission request dialog |
| `src/components/ui/dialog.tsx` | Base dialog component |
| `src/server/db/schema.ts` | `locationPermission` field in `user_settings` table |

## Audio Notes

The app includes audio note recording functionality for capturing voice notes directly to the Obsidian vault.

### Key Audio Files

| File | Purpose |
|------|---------|
| `src/lib/audio.ts` | Audio recording utilities and permission handling |
| `src/components/audio-note-page.tsx` | Audio recording interface |
| `src/components/audio-permission-modal.tsx` | Microphone permission request dialog |
| `src/app/audio-note/page.tsx` | Audio note route handler |
| `src/server/db/schema.ts` | `audioPermission` field in `user_settings` table |

### Audio Recording Flow

1. User taps audio note button on dashboard
2. If `audioPermission` is `not_asked`, show permission modal
3. If permission granted, navigate to audio note page
4. Recording starts automatically on page load
5. User taps "Stop & Save" to end recording
6. If location permission granted, location data is fetched
7. Audio file and markdown note saved to vault via `vault.saveSharedContent`

### Audio Permission Status

Stored in `user_settings.audioPermission`:
- `not_asked`: User hasn't been prompted yet (show modal on first audio note)
- `granted`: User allowed microphone access
- `denied`: User denied or disabled microphone access

### AudioRecorder Class

The `AudioRecorder` class in `src/lib/audio.ts` provides:
- `start()` - Start recording audio
- `stop()` - Stop recording and return audio data as blob/dataUrl
- `cancel()` - Cancel recording without saving
- `getState()` - Get current recording state
- `getDuration()` - Get current recording duration

### Modifying Audio Behavior

| Change | Files to Update |
|--------|-----------------|
| Change audio format | `src/lib/audio.ts` - `getSupportedMimeType()` function |
| Modify permission UI | `src/components/audio-permission-modal.tsx` |
| Change recording UI | `src/components/audio-note-page.tsx` |
| Change settings UI | `src/components/settings-page.tsx` |
| Modify permission storage | `src/server/trpc/routers/settings.ts`

### Location Permission Flow

1. On first share, if `locationPermission` is `not_asked`, show permission modal
2. User chooses to allow or deny
3. Permission status stored in database (`granted` or `denied`)
4. If granted, get location via Geolocation API
5. Reverse geocode using Nominatim (OpenStreetMap) API
6. Location saved in note frontmatter

### LocationInfo Interface

```typescript
interface LocationInfo {
  country?: string;
  city?: string;
  area?: string;    // neighborhood/suburb/district
  street?: string;
}
```

### Location Permission Status

Stored in `user_settings.locationPermission`:
- `not_asked`: User hasn't been prompted yet (show modal on next share)
- `granted`: User allowed location access
- `denied`: User denied or disabled location access

### Modifying Location Behavior

| Change | Files to Update |
|--------|-----------------|
| Change geocoding provider | `src/lib/location.ts` - `reverseGeocode()` function |
| Modify permission UI | `src/components/location-permission-modal.tsx` |
| Add location fields | `src/lib/vault.ts` - `LocationInfo` interface |
| Change settings UI | `src/components/settings-page.tsx` |
| Modify permission storage | `src/server/trpc/routers/settings.ts` |

### Fallback Behavior

- If reverse geocoding fails → Use GPS coordinates (e.g., "45.1234°N, 19.5678°E")
- If geolocation not supported → Save without location
- If permission denied → Save with "unknown" location

### Path Configuration

Vault paths are now configured per-user via settings:
- Base path: `/data/Documents`
- Full path: `/data/Documents/{vault-name}/{incoming-folder}/`
- Settings created automatically on user signup
- Settings can be modified anytime from the settings page

## Theming

The app uses `next-themes` for dark/light mode support with Tailwind CSS.

### Key Theming Files

| File | Purpose |
|------|---------|
| `src/components/theme-provider.tsx` | ThemeProvider wrapper using next-themes |
| `src/components/theme-toggle.tsx` | Sun/moon toggle button component |
| `src/app/layout.tsx` | Theme provider configuration |
| `src/app/globals.css` | CSS variables for light and dark themes |
| `tailwind.config.ts` | Tailwind configuration with `darkMode: ["class"]` |

### Adding Theme Support to New Components

1. Use semantic Tailwind colors (`bg-background`, `text-foreground`, etc.) for automatic theming
2. For hardcoded colors, add dark variants: `bg-amber-50 dark:bg-amber-950`
3. Add theme toggle to new pages with the `<ThemeToggle />` component
4. Common patterns:
   - Warning boxes: `bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200`
   - Success messages: `text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950`

### Theme Configuration

The theme provider is configured in `layout.tsx` with:
- `attribute="class"` - Adds `dark` class to HTML element
- `defaultTheme="system"` - Respects OS preference by default
- `enableSystem` - Enables system preference detection
- `disableTransitionOnChange` - Prevents flash on theme change

## Logging

The application uses Pino for structured logging across all backend operations.

### Key Logging Files

| File | Purpose |
|------|---------|
| `src/lib/logger.ts` | Pino logger configuration and utility functions |
| `src/server/trpc/trpc.ts` | tRPC context with logger and logging middleware |

### Logging Architecture

- **Logger Configuration:** `src/lib/logger.ts` exports the base Pino logger and helper functions
- **tRPC Context:** Every tRPC procedure receives a child logger with `requestId` and `userId` context
- **Logging Middleware:** All tRPC procedures are wrapped with logging middleware that logs start, complete, and error events
- **Module Loggers:** Auth and vault modules create their own child loggers with `module` context

### Log Level Configuration

Use the `DEBUG_LEVEL` environment variable to control log verbosity:

| Value | Description |
|-------|-------------|
| `debug` | Verbose logging including file reads, frontmatter parsing, content detection |
| `info` | Default - important events only |
| `warn` | Warnings and errors only |
| `error` | Errors only |

Example: `DEBUG_LEVEL=debug pnpm dev` to enable verbose logging during development.

### Log Formats

| Environment | Format | Transport |
|-------------|--------|-----------|
| Development | Pretty-print with colors | `pino-pretty` |
| Production | JSON (Railway structured logs) | None (Pino default) |

Production logs use JSON format optimized for Railway:
- Railway auto-normalizes `msg` → `message` field
- Supports `@attribute:value` filtering in Log Explorer
- Log levels are colored in Railway dashboard
- See: https://docs.railway.com/guides/logs#structured-logs

### Log Events

All logs use structured event names for easy filtering:

| Event Pattern | Description |
|--------------|-------------|
| `trpc.request.*` | tRPC procedure lifecycle (start, complete, error) |
| `share.request.*` | Share API endpoint events |
| `vault.save.*` | Vault content saving operations |
| `vault.file.*` | File-level vault operations |
| `auth.signin.*` | Authentication events |
| `auth.user.*` | User lifecycle events |
| `settings.*` | User settings operations |
| `queue.*` | Job queue operations (create, start, complete, fail) |
| `job.*` | Individual job lifecycle events |
| `phase.*` | Job phase execution events |

### Security Considerations

**IMPORTANT:** The logging system is designed to never log sensitive data:

- Shared content (text, URLs, titles) is NEVER logged
- File data (base64 content) is NEVER logged
- Only metadata is logged (file names, types, sizes, counts)
- Use `sanitizeForLogging()` and `sanitizeFileForLogging()` helpers when logging user data
- Sensitive keys are automatically redacted: text, url, title, dataUrl, data, content, password, secret, token

### Modifying Logging Behavior

To add logging to new code:

1. For tRPC procedures: Use `ctx.logger` which includes request context
2. For non-tRPC modules: Import `logger` from `@/lib/logger` and create a child logger:
   ```typescript
   import { logger } from "@/lib/logger";
   const moduleLogger = logger.child({ module: "my-module" });
   ```
3. Always use structured events with an `event` field for filtering
4. Never log sensitive user content - use `sanitizeForLogging()` helper

## Async Job Queue

The app includes a robust async job queue system for background task processing.

### Key Job Queue Files

| File | Purpose |
|------|---------|
| `src/server/jobs/types.ts` | Type definitions for jobs, phases, and configuration |
| `src/server/jobs/base-job.ts` | Base class for defining job types |
| `src/server/jobs/queue-handler.ts` | Polls queue, manages visibility timeouts, sends heartbeats |
| `src/server/jobs/task-runner.ts` | Executes job phases sequentially with retry support |
| `src/server/jobs/scheduler.ts` | Runs queue processing every 30 minutes |
| `src/server/jobs/job-service.ts` | CRUD operations for jobs |
| `src/server/jobs/registry.ts` | Global registry for job definitions |
| `src/server/jobs/index.ts` | Main exports |
| `src/server/trpc/routers/queue.ts` | tRPC router for queue management |
| `src/server/db/schema.ts` | Database tables: `jobs`, `job_phases`, `queue_handler_heartbeat`, `queue_lock` |

### Job Queue Concepts

1. **Jobs**: Top-level work units with type, payload, status, and retry tracking
2. **Phases**: Individual steps within a job, each must be idempotent
3. **Visibility Timeout**: Prevents duplicate processing by hiding claimed jobs
4. **Heartbeat**: Health monitoring to detect dead handlers
5. **Scheduler**: Periodic processing trigger (30-minute intervals)
6. **Visibility Heartbeat**: Extends job visibility during long-running phase execution
7. **Graceful Shutdown**: Releases jobs immediately on handler stop for quick reclaim

### Deployment Resilience

The job queue is designed to survive deployments without losing jobs:

| Mechanism | Purpose |
|-----------|---------|
| Visibility heartbeat | TaskRunner extends job visibility every 60s during execution |
| Stalled phase reset | Phases left in "running" state are reset to "pending" on reclaim |
| Graceful job release | Handler.stop() immediately releases jobs as "stalled" |
| Orphan reclaim | Jobs from dead handlers are reclaimed proactively |
| Max execution time | Jobs exceeding 1 hour are failed to prevent infinite runs |

**Key configuration in `types.ts`:**
- `visibilityHeartbeatInterval`: 60000ms (1 min) - extend visibility during execution
- `maxJobExecutionTime`: 3600000ms (1 hour) - circuit breaker for stuck jobs
- `visibilityTimeout`: 300000ms (5 min) - how long until a job becomes visible again
- `heartbeatTimeout`: 120000ms (2 min) - how long until a handler is considered dead

**Phase idempotency is critical:**
- Phases may be executed multiple times due to restarts
- Always check if work is already done before re-doing it
- Use database checks or file existence tests for idempotency

### Creating a New Job Type

To add a new background job type:

1. Create a job definition file in `src/server/jobs/` or a subdirectory:
```typescript
import { defineJob, JobPriority } from "@/server/jobs";

export const myNewJob = defineJob<MyPayloadType>({
  type: "my-new-job",
  description: "What this job does",
  defaultPriority: JobPriority.NORMAL,
  defaultMaxRetries: 3,

  phases: [
    {
      name: "phase-1",
      async execute(ctx) {
        // Must be idempotent!
        // Access payload: ctx.job.payload
        // Access previous phase output: ctx.phase.input
        return { success: true, output: { /* data for next phase */ } };
      },
    },
    // More phases...
  ],

  async onComplete(job, result) {
    // Called when all phases complete successfully
  },

  async onFailed(job, error) {
    // Called when job fails after all retries
  },
});
```

2. Register the job in your application startup:
```typescript
import { JobRegistry } from "@/server/jobs";
import { myNewJob } from "./my-new-job";

JobRegistry.register(myNewJob);
```

3. Create jobs using the service:
```typescript
import { createJob } from "@/server/jobs";

await createJob({
  type: "my-new-job",
  payload: { /* your data */ },
  userId: optionalUserId,
});
```

### Modifying Job Queue Behavior

| Change | Files to Update |
|--------|-----------------|
| Add new job type | Create definition file, register in startup |
| Change scheduler interval | `src/server/jobs/scheduler.ts` - `DEFAULT_INTERVAL_MS` |
| Modify visibility timeout | `src/server/jobs/types.ts` - `DEFAULT_QUEUE_CONFIG` |
| Add tRPC endpoints | `src/server/trpc/routers/queue.ts` |
| Change database schema | `src/server/db/schema.ts`, then `pnpm db:generate` |

### Phase Execution Rules

1. **Idempotency**: Every phase must be safe to run multiple times with the same input
2. **Output Propagation**: Each phase's output becomes the next phase's input
3. **Conditional Execution**: Use `shouldRun` to skip phases based on conditions
4. **Error Handling**: Return `{ success: false, error: "message", shouldRetry: true }` for retryable errors
5. **Early Exit**: Return `{ success: true, skipRemaining: true }` to complete job early

## Database Migrations

The application uses Drizzle ORM for database management with a custom migration script for production deployments.

### Key Migration Files

| File | Purpose |
|------|---------|
| `scripts/migrate.ts` | TypeScript migration script for production |
| `drizzle.config.ts` | Drizzle Kit configuration |
| `drizzle/` | Generated SQL migration files |
| `src/server/db/schema.ts` | Drizzle ORM schema definitions |
| `src/server/db/seed.ts` | Development seed script (uses ORM) |

### Migration Architecture

The `scripts/migrate.ts` script is a standalone TypeScript file that:
1. Opens a direct SQLite connection (without the app's logger dependencies)
2. Runs Drizzle migrations using `drizzle-orm/better-sqlite3/migrator`
3. Seeds the `allow_list` table with initial users
4. Creates default `user_settings` for users who don't have them

### Adding New Migrations

1. Modify the schema in `src/server/db/schema.ts`
2. Generate migration: `pnpm db:generate`
3. Review the generated SQL in `drizzle/`
4. Test locally: `pnpm db:migrate:run`

### Seeding Data

To add new seed data:
1. Update `scripts/migrate.ts` with additional seeding logic
2. Ensure seeding is idempotent (uses `INSERT OR IGNORE` or checks for existing data)
3. Update `src/server/db/seed.ts` for development consistency

### Modifying Migration Behavior

| Change | Files to Update |
|--------|-----------------|
| Add new table | `src/server/db/schema.ts`, then `pnpm db:generate` |
| Add seed data | `scripts/migrate.ts` (production), `src/server/db/seed.ts` (development) |
| Change database location | `drizzle.config.ts`, environment variable `DATABASE_URL` |
| Modify migration script | `scripts/migrate.ts` |

## Agentic Workflow System

The app includes an agentic workflow system for building multi-step, LLM-driven automation on top of the async job queue.

### Key Workflow Files

| File | Purpose |
|------|---------|
| `src/server/workflows/types.ts` | Type definitions for workflows, steps, and tools |
| `src/server/workflows/base-workflow.ts` | Base class and builder for defining workflows |
| `src/server/workflows/orchestrator.ts` | Workflow execution engine |
| `src/server/workflows/registry.ts` | Central registry for workflow definitions |
| `src/server/workflows/workflow-job.ts` | Integration with async job queue |
| `src/server/workflows/steps/base-step.ts` | Base step class with retry logic |
| `src/server/workflows/steps/llm-step.ts` | LLM call step with structured output |
| `src/server/workflows/steps/tool-step.ts` | Tool execution step |
| `src/server/workflows/steps/decision-step.ts` | LLM-driven decision step |
| `src/server/workflows/steps/control-steps.ts` | Parallel, transform, condition, loop steps |
| `src/server/workflows/tools/file-tools.ts` | File system tools |
| `src/server/workflows/tools/http-tools.ts` | HTTP request tools |
| `src/server/workflows/tools/ai-extraction-tools.ts` | AI content extraction tools |
| `src/server/workflows/examples/` | Example workflow implementations |
| `src/server/workflows/examples/new-note-extract-workflow.ts` | Note content extraction workflow |

### Workflow Concepts

1. **Workflows**: Define the structure and flow of multi-step processes
2. **Steps**: Individual units of work (LLM calls, tool calls, decisions, etc.)
3. **Tools**: Reusable functions for file I/O, HTTP, and custom actions
4. **Triggers**: Input data that starts a workflow
5. **Orchestrator**: Manages workflow execution, state, and step scheduling

### Creating a New Workflow

1. Create a workflow definition file in `src/server/workflows/` or a subdirectory:
```typescript
import { workflow, defineLLMStep, WorkflowPriority } from "@/server/workflows";
import { z } from "zod";

export const myWorkflow = workflow("my-workflow", "My Workflow")
  .description("Does something useful")
  .priority(WorkflowPriority.NORMAL)
  .trigger(z.object({ input: z.string() }))

  .step(defineLLMStep({
    id: "process",
    name: "Process Input",
    userPrompt: (ctx) => `Process this: ${ctx.trigger.input}`,
  }))

  .entryStep("process")
  .build();
```

2. Register the workflow in your application startup:
```typescript
import { WorkflowRegistry } from "@/server/workflows";
import { myWorkflow } from "./my-workflow";

WorkflowRegistry.register(myWorkflow);
```

3. Execute workflows:
```typescript
import { executeWorkflow, createWorkflowJob } from "@/server/workflows";

// Direct execution
const result = await executeWorkflow("my-workflow", { input: "hello" });

// Via job queue (recommended for production)
const jobId = await createWorkflowJob({
  workflowId: "my-workflow",
  trigger: { input: "hello" },
});
```

### Creating Custom Tools

```typescript
import { defineTool, ToolRegistry } from "@/server/workflows";
import { z } from "zod";

const myTool = defineTool({
  name: "my-tool",
  description: "Does something",
  category: "custom",
  inputSchema: z.object({ data: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  execute: async (input, context) => {
    // Tool implementation
    return { success: true, output: { result: "done" } };
  },
});

ToolRegistry.register(myTool);
```

### Step Types

| Type | Description | Use Case |
|------|-------------|----------|
| `llm-call` | Makes an LLM API call | Content analysis, generation, classification |
| `tool-call` | Executes a registered tool | File I/O, HTTP requests, custom actions |
| `decision` | LLM picks next step(s) | Dynamic routing based on context |
| `parallel` | Runs steps concurrently | Independent parallel tasks |
| `transform` | Transforms data | Data manipulation without LLM |
| `condition` | Conditional branching | If/else logic |
| `loop` | Iterates over items | Processing collections |

### Modifying Workflow Behavior

| Change | Files to Update |
|--------|-----------------|
| Add new step type | `src/server/workflows/steps/`, then update `control-steps.ts` factory |
| Add LLM provider | `src/server/workflows/steps/llm-step.ts` - implement `LLMProvider` interface |
| Add new tool | Create in `src/server/workflows/tools/`, register with `ToolRegistry` |
| Change default LLM config | `src/server/workflows/steps/llm-step.ts` - `DEFAULT_LLM_CONFIG` |
| Modify orchestrator config | `src/server/workflows/orchestrator.ts` - `DEFAULT_ORCHESTRATOR_CONFIG` |

### Workflow Execution Flow

1. **Trigger**: Workflow receives trigger data (validated against schema if provided)
2. **Instance Creation**: Orchestrator creates a workflow instance with context
3. **Step Execution**: Entry step is executed, then transitions determine next steps
4. **Decision Points**: Decision steps use LLM to pick next step(s) dynamically
5. **Parallel Execution**: Parallel steps run concurrently when specified
6. **Completion**: Workflow completes when no more steps to execute

### Event System

Subscribe to workflow events for monitoring:
```typescript
import { getOrchestrator } from "@/server/workflows";

const orchestrator = getOrchestrator();
orchestrator.on((event) => {
  switch (event.type) {
    case "workflow:started":
      console.log("Workflow started:", event.instance.id);
      break;
    case "step:completed":
      console.log("Step completed:", event.step.stepName);
      break;
    case "workflow:completed":
      console.log("Workflow completed:", event.result);
      break;
  }
});
```

## File Checker Module

The File Checker is a periodic task system that scans the incoming folder for new notes and triggers content extraction workflows.

### Key File Checker Files

| File | Purpose |
|------|---------|
| `src/server/file-checker/file-checker.ts` | Core file checker implementation |
| `src/server/file-checker/index.ts` | Module exports |

### How It Works

1. **Periodic Scanning**: Runs every N seconds (configurable, default: 10)
2. **Status Detection**: Looks for `.md` files with `status: new` in frontmatter
3. **Content Type Detection**: Determines if content is audio, video, image, URL, or text
4. **Workflow Trigger**: Creates a workflow job for the `new-note-extract` workflow
5. **Status Update**: Updates file status from `new` → `extracting` → `extracted`

### File Checker Configuration

The check interval is stored in `user_settings.fileCheckInterval` (in seconds).

```typescript
// Get the global file checker instance
import { getGlobalFileChecker } from "@/server/file-checker";

const checker = getGlobalFileChecker({ intervalMs: 10000 });
checker.start();

// Update interval
checker.updateInterval(30000); // 30 seconds

// Get status
const status = checker.getStatus();

// Stop
checker.stop();
```

### AI Extraction Tools

| Tool | Purpose |
|------|---------|
| `extract-audio` | Extract speakers, transcription, intentions from audio files |
| `extract-video` | Extract audio + visual info from video files |
| `extract-image` | Extract visual info, text, diagrams from images |
| `extract-url` | Fetch and extract content from URLs |
| `extract-document` | Extract text, summary, key points from documents (PDF, DOC, TXT, etc.) |

### Required API Keys

| API Key | Used For | Configurable In Settings |
|---------|----------|--------------------------|
| `ANTHROPIC_API_KEY` | Image analysis | No (environment variable only) |
| `OPENAI_API_KEY` | Audio transcription (Whisper API), document analysis | Yes (AI Extraction Settings) |
| Text LLM API Key | URL summarization and content extraction | Yes (URL Summarization Settings) |

**Note:** URL summarization supports both Anthropic and OpenAI providers. Users can configure their preferred provider, API key, and model in Settings → URL Summarization Settings.

### Modifying File Checker Behavior

| Change | Files to Update |
|--------|-----------------|
| Change default interval | `src/server/file-checker/file-checker.ts` - `DEFAULT_CHECK_INTERVAL_MS` |
| Add content type detection | `src/server/file-checker/file-checker.ts` - `detectContentType()` |
| Modify extraction workflow | `src/server/workflows/examples/new-note-extract-workflow.ts` |
| Add new extraction tool | `src/server/workflows/tools/ai-extraction-tools.ts` |
| Change AI models | `src/server/workflows/tools/ai-extraction-tools.ts` |
| Modify URL extraction | `src/server/workflows/tools/ai-extraction-tools.ts` - `extractUrlTool` |

### Note Status Flow

```
new → extracting → extracted
                 ↘ extraction_failed (on error)
```

The workflow updates the note file with:
- Extracted content at the top under `## Extracted [Type] Content`
- Original content preserved under `## Original Content`
- Updated frontmatter with `status`, `extractedAt`, `contentType`

### Document Analysis Configuration

Document analysis uses OpenAI's models (configurable per-user in settings):
- **Document Analysis Model**: Stored in `user_settings.documentAnalysisModel` (default: `gpt-4o`)
- Supports PDF, DOC, DOCX, TXT, MD, CSV, RTF, ODT file types
- Extracts: title, summary (meaning-focused, 2-3 sentences), key points (3-5 max)
