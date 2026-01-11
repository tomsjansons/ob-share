import { promises as fs } from "fs";
import path from "path";
import { logger } from "./logger";
import { buildMarkdown } from "./frontmatter";
import type { CapturedPageData } from "./share-store";

// Create a child logger for vault operations
const vaultLogger = logger.child({ module: "vault" });

// Base path for vault storage - configurable via environment variable
const DATA_ROOT = process.env.VAULT_DATA_ROOT ?? "/data/Documents";

export interface VaultConfig {
  vaultName: string;
  incomingFolder: string;
}

export interface LocationInfo {
  country?: string;
  city?: string;
  area?: string;
  street?: string;
}

export interface VaultNoteFrontmatter {
  location: LocationInfo;
  created: string;
  status: string;
  tags: string[];
  projects: string[];
}

export interface SaveToVaultOptions {
  title?: string;
  text?: string;
  url?: string;
  files?: VaultFile[];
  location?: LocationInfo;
  vaultConfig: VaultConfig;
  capturedContent?: CapturedPageData;
}

export interface VaultFile {
  name: string;
  type: string;
  data: Buffer;
}

export interface SaveResult {
  success: boolean;
  notePath?: string;
  savedFiles?: string[];
  error?: string;
}

/**
 * Generates a safe filename from a name string
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "-") // Replace invalid chars
    .replace(/\s+/g, "-") // Replace spaces with dashes
    .replace(/-+/g, "-") // Collapse multiple dashes
    .replace(/^-|-$/g, "") // Trim dashes from start/end
    .toLowerCase()
    .slice(0, 100); // Limit length
}

/**
 * Generates a timestamp string in format YYYY-MM-DD-HHmmss
 */
function getTimestamp(): string {
  const now = new Date();
  const date = now.toISOString().split("T")[0];
  const time = now.toTimeString().split(" ")[0].replace(/:/g, "");
  return `${date}-${time}`;
}

/**
 * Formats location info for frontmatter
 */
function formatLocation(location?: LocationInfo): string {
  if (!location) {
    return "unknown";
  }

  const parts = [
    location.country,
    location.city,
    location.area,
    location.street,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : "unknown";
}

/**
 * Generates frontmatter data object for a note
 */
function generateFrontmatterData(options: {
  location?: LocationInfo;
  created: Date;
  tags: string[];
  projects: string[];
}): Record<string, unknown> {
  const { location, created, tags, projects } = options;

  return {
    location: formatLocation(location),
    created: created.toISOString(),
    status: "new",
    tags,
    projects,
  };
}

/**
 * Gets the file extension for a MIME type
 */
function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "audio/webm": "webm",
    "audio/mp4": "m4a",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/ogg": "ogv",
    "application/pdf": "pdf",
    "text/plain": "txt",
    "text/markdown": "md",
  };

  return mimeToExt[mimeType] || mimeType.split("/")[1] || "bin";
}

/**
 * Generates markdown content for a note
 */
function generateMarkdownContent(options: SaveToVaultOptions, savedFileNames: string[]): string {
  const sections: string[] = [];

  // Add title as heading if present
  if (options.title) {
    sections.push(`# ${options.title}\n`);
  }

  // Add URL if present
  if (options.url) {
    sections.push(`## Source\n\n${options.url}\n`);
  }

  // Add captured content if present (from browser extension full page capture)
  if (options.capturedContent) {
    const captured = options.capturedContent;

    // Add user note if provided
    if (captured.userNote) {
      sections.push(`## Note\n\n${captured.userNote}\n`);
    }

    // Add article content if extracted (preferred over full body text)
    if (captured.articleText) {
      sections.push(`## Article Content\n\n${captured.articleText}\n`);
    } else if (captured.bodyText) {
      // Fall back to full body text if no article was extracted
      // Truncate if too long to avoid massive notes
      const maxBodyLength = 50000;
      const bodyText = captured.bodyText.length > maxBodyLength
        ? captured.bodyText.slice(0, maxBodyLength) + "\n\n[Content truncated...]"
        : captured.bodyText;
      sections.push(`## Page Content\n\n${bodyText}\n`);
    }

    // Add metadata section if available
    const meta = captured.meta;
    if (meta && (meta.author || meta.publishedTime || meta.siteName || meta.description)) {
      sections.push(`## Metadata\n`);
      if (meta.siteName) sections.push(`- **Site:** ${meta.siteName}`);
      if (meta.author) sections.push(`- **Author:** ${meta.author}`);
      if (meta.publishedTime) sections.push(`- **Published:** ${meta.publishedTime}`);
      if (meta.description) sections.push(`- **Description:** ${meta.description}`);
      sections.push("");
    }

    // Add selection if captured
    if (captured.selection) {
      sections.push(`## Selected Text\n\n> ${captured.selection.replace(/\n/g, "\n> ")}\n`);
    }
  } else {
    // Add text content if present (non-captured mode)
    if (options.text) {
      sections.push(`## Content\n\n${options.text}\n`);
    }
  }

  // Add file links if present
  if (savedFileNames.length > 0) {
    sections.push(`## Attachments\n`);
    for (const fileName of savedFileNames) {
      // Determine if it's an image for inline display
      const ext = path.extname(fileName).toLowerCase();
      const imageExts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"];

      if (imageExts.includes(ext)) {
        // Embed images directly
        sections.push(`![[${fileName}]]\n`);
      } else {
        // Link other files
        sections.push(`[[${fileName}]]\n`);
      }
    }
  }

  return sections.join("\n");
}

/**
 * Constructs the full vault path from config
 */
function getVaultPath(config: VaultConfig): string {
  return path.join(DATA_ROOT, config.vaultName);
}

/**
 * Ensures the incoming directory exists
 */
async function ensureIncomingDir(config: VaultConfig): Promise<string> {
  const incomingPath = path.join(getVaultPath(config), config.incomingFolder);
  await fs.mkdir(incomingPath, { recursive: true });
  return incomingPath;
}

/**
 * Saves shared content to the Obsidian vault
 */
export async function saveToVault(options: SaveToVaultOptions): Promise<SaveResult> {
  try {
    const { vaultConfig } = options;
    const vaultPath = getVaultPath(vaultConfig);
    const incomingPath = await ensureIncomingDir(vaultConfig);
    const timestamp = getTimestamp();
    const created = new Date();

    // Generate base filename from title or use "shared"
    const baseName = options.title
      ? sanitizeFilename(options.title)
      : "shared";
    const baseFilename = `${timestamp}-${baseName}`;

    vaultLogger.debug({
      event: "vault.file.save_start",
      vaultPath,
      incomingPath,
      baseFilename,
      fileCount: options.files?.length ?? 0,
    });

    // Save any attached files first
    const savedFileNames: string[] = [];

    if (options.files && options.files.length > 0) {
      for (let i = 0; i < options.files.length; i++) {
        const file = options.files[i];
        const ext = getExtensionFromMimeType(file.type);

        // Generate filename for the attachment
        const attachmentName = options.files.length === 1
          ? `${baseFilename}.${ext}`
          : `${baseFilename}-${i + 1}.${ext}`;

        const attachmentPath = path.join(incomingPath, attachmentName);
        await fs.writeFile(attachmentPath, file.data);
        savedFileNames.push(attachmentName);

        vaultLogger.debug({
          event: "vault.file.attachment_saved",
          attachmentName,
          fileType: file.type,
          fileSize: file.data.length,
        });
      }
    }

    // Generate the markdown note using gray-matter
    const frontmatterData = generateFrontmatterData({
      location: options.location,
      created,
      tags: [],
      projects: [],
    });

    const markdownContent = generateMarkdownContent(options, savedFileNames);
    const fullContent = buildMarkdown(frontmatterData, markdownContent);

    // Save the note
    const notePath = path.join(incomingPath, `${baseFilename}.md`);
    await fs.writeFile(notePath, fullContent, "utf-8");

    const relativeNotePath = path.relative(vaultPath, notePath);

    vaultLogger.info({
      event: "vault.file.save_complete",
      notePath: relativeNotePath,
      attachmentCount: savedFileNames.length,
    });

    return {
      success: true,
      notePath: relativeNotePath,
      savedFiles: savedFileNames,
    };
  } catch (error) {
    vaultLogger.error({
      event: "vault.file.save_error",
      error: error instanceof Error ? error.message : "Unknown error",
      vaultName: options.vaultConfig.vaultName,
      incomingFolder: options.vaultConfig.incomingFolder,
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

/**
 * Converts a base64 data URL to a Buffer
 * Handles MIME types with parameters like "audio/webm;codecs=opus"
 */
export function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mimeType: string } {
  // Match data URLs with MIME types that may include parameters (e.g., audio/webm;codecs=opus)
  // Format: data:<mimeType>[;<params>];base64,<data>
  const matches = dataUrl.match(/^data:([^;,]+(?:;[^;,]+)*);base64,(.+)$/);
  if (!matches) {
    throw new Error("Invalid data URL format");
  }

  // Extract the full MIME type including any parameters
  const fullMimeType = matches[1];
  // For file extension purposes, use only the base MIME type (before any semicolon params)
  const mimeType = fullMimeType.split(";")[0];
  const base64Data = matches[2];
  const buffer = Buffer.from(base64Data, "base64");

  return { buffer, mimeType };
}
