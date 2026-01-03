import { promises as fs } from "fs";
import path from "path";

// Vault configuration
const VAULT_ROOT = process.env.VAULT_ROOT || "/home/obsidian/vault";
const INCOMING_DIR = "incoming";

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
 * Generates frontmatter YAML for a note
 */
function generateFrontmatter(options: {
  location?: LocationInfo;
  created: Date;
  tags: string[];
  projects: string[];
}): string {
  const { location, created, tags, projects } = options;

  const lines = [
    "---",
    `location: "${formatLocation(location)}"`,
    `created: ${created.toISOString()}`,
    `status: "new"`,
    `tags: [${tags.map(t => `"${t}"`).join(", ")}]`,
    `projects: [${projects.map(p => `"${p}"`).join(", ")}]`,
    "---",
    "",
  ];

  return lines.join("\n");
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

  // Add text content if present
  if (options.text) {
    sections.push(`## Content\n\n${options.text}\n`);
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
 * Ensures the incoming directory exists
 */
async function ensureIncomingDir(): Promise<string> {
  const incomingPath = path.join(VAULT_ROOT, INCOMING_DIR);
  await fs.mkdir(incomingPath, { recursive: true });
  return incomingPath;
}

/**
 * Saves shared content to the Obsidian vault
 */
export async function saveToVault(options: SaveToVaultOptions): Promise<SaveResult> {
  try {
    const incomingPath = await ensureIncomingDir();
    const timestamp = getTimestamp();
    const created = new Date();

    // Generate base filename from title or use "shared"
    const baseName = options.title
      ? sanitizeFilename(options.title)
      : "shared";
    const baseFilename = `${timestamp}-${baseName}`;

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
      }
    }

    // Generate the markdown note
    const frontmatter = generateFrontmatter({
      location: options.location,
      created,
      tags: [],
      projects: [],
    });

    const markdownContent = generateMarkdownContent(options, savedFileNames);
    const fullContent = frontmatter + markdownContent;

    // Save the note
    const notePath = path.join(incomingPath, `${baseFilename}.md`);
    await fs.writeFile(notePath, fullContent, "utf-8");

    return {
      success: true,
      notePath: path.relative(VAULT_ROOT, notePath),
      savedFiles: savedFileNames,
    };
  } catch (error) {
    console.error("Error saving to vault:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

/**
 * Converts a base64 data URL to a Buffer
 */
export function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mimeType: string } {
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) {
    throw new Error("Invalid data URL format");
  }

  const mimeType = matches[1];
  const base64Data = matches[2];
  const buffer = Buffer.from(base64Data, "base64");

  return { buffer, mimeType };
}
