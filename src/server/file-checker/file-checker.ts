/**
 * File Checker Utilities
 *
 * Utility functions for working with markdown files in incoming folders.
 * These functions are used by the file-checker job and extraction workflows.
 *
 * Note: The actual file checking logic has been moved to a periodic job.
 * See src/server/jobs/file-checker-job.ts for the job implementation.
 */

import { promises as fs } from "fs";
import path from "path";
import { logger as baseLogger } from "@/lib/logger";

const logger = baseLogger.child({ module: "file-checker" });

/**
 * Parse YAML frontmatter from markdown content
 */
export function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterText = match[1];
  const body = match[2];

  // Simple YAML parsing (handles basic key: value pairs)
  const frontmatter: Record<string, unknown> = {};
  const lines = frontmatterText.split("\n");

  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      let value: unknown = line.substring(colonIndex + 1).trim();

      // Remove quotes if present
      if (typeof value === "string") {
        let strValue = value;
        if ((strValue.startsWith('"') && strValue.endsWith('"')) || (strValue.startsWith("'") && strValue.endsWith("'"))) {
          strValue = strValue.slice(1, -1);
        }
        // Handle arrays
        if (strValue.startsWith("[") && strValue.endsWith("]")) {
          try {
            value = JSON.parse(strValue.replace(/'/g, '"'));
          } catch {
            // Keep as string if parsing fails
            value = strValue;
          }
        } else if (strValue === "null") {
          value = null;
        } else if (strValue === "true") {
          value = true;
        } else if (strValue === "false") {
          value = false;
        } else if (/^-?\d+$/.test(strValue)) {
          // Parse integers
          value = parseInt(strValue, 10);
        } else if (/^-?\d+\.\d+$/.test(strValue)) {
          // Parse floats
          value = parseFloat(strValue);
        } else {
          value = strValue;
        }
      }

      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}

/**
 * Escape a string value for YAML double-quoted strings
 * Escapes backslashes first, then double quotes
 */
function escapeYamlString(value: string): string {
  return value
    .replace(/\\/g, "\\\\") // Escape backslashes first
    .replace(/"/g, '\\"') // Escape double quotes
    .replace(/\n/g, "\\n") // Escape newlines
    .replace(/\r/g, "\\r") // Escape carriage returns
    .replace(/\t/g, "\\t"); // Escape tabs
}

/**
 * Rebuild frontmatter to string
 */
export function buildFrontmatter(frontmatter: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => `"${escapeYamlString(String(v))}"`).join(", ")}]`);
    } else if (typeof value === "string") {
      lines.push(`${key}: "${escapeYamlString(value)}"`);
    } else if (value === null || value === undefined) {
      lines.push(`${key}: null`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

/**
 * Update frontmatter status in a markdown file
 */
export async function updateFileStatus(filePath: string, newStatus: string): Promise<void> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);

    frontmatter.status = newStatus;

    const newContent = buildFrontmatter(frontmatter) + "\n\n" + body.trimStart();
    await fs.writeFile(filePath, newContent, "utf-8");

    logger.debug({
      event: "file-checker.status_updated",
      filePath,
      newStatus,
    });
  } catch (err) {
    logger.error({
      event: "file-checker.status_update_error",
      filePath,
      newStatus,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Calculate exponential backoff delay in milliseconds
 */
function calculateBackoffMs(retryNum: number, baseDelayMs: number = 30000): number {
  // Exponential backoff: base * 2^retryNum with jitter
  // Example: 30s, 60s, 120s, 240s, 480s...
  const exponentialDelay = baseDelayMs * Math.pow(2, retryNum);
  const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
  return Math.min(exponentialDelay + jitter, 3600000); // Cap at 1 hour
}

/**
 * Update file with error details and schedule retry
 */
export async function updateFileWithError(
  filePath: string,
  error: string,
  maxRetries: number
): Promise<{ shouldRetry: boolean; retryNum: number; nextRetryAt: Date | null }> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);

    // Get current retry count
    const currentRetryNum = typeof frontmatter["retry-num"] === "number" ? frontmatter["retry-num"] : 0;
    const newRetryNum = currentRetryNum + 1;

    // Check if we should retry
    const shouldRetry = newRetryNum <= maxRetries;

    // Update frontmatter
    frontmatter["retry-num"] = newRetryNum;
    frontmatter["last-error"] = error;
    frontmatter["last-error-at"] = new Date().toISOString();

    if (shouldRetry) {
      // Calculate next retry time with exponential backoff
      const backoffMs = calculateBackoffMs(newRetryNum);
      const nextRetryAt = new Date(Date.now() + backoffMs);
      frontmatter.status = "retry";
      frontmatter["next-retry-at"] = nextRetryAt.toISOString();

      logger.info({
        event: "file-checker.retry_scheduled",
        filePath,
        retryNum: newRetryNum,
        maxRetries,
        nextRetryAt: nextRetryAt.toISOString(),
        backoffMs,
      });
    } else {
      // Max retries exceeded
      frontmatter.status = "extraction_failed";
      frontmatter["next-retry-at"] = null;

      logger.warn({
        event: "file-checker.max_retries_exceeded",
        filePath,
        retryNum: newRetryNum,
        maxRetries,
      });
    }

    // Add error details section to body if not already present
    let newBody = body;
    const errorSection = `\n\n---\n\n## Extraction Error (Attempt ${newRetryNum}/${maxRetries})\n\n**Error:** ${error}\n\n**Time:** ${new Date().toISOString()}\n\n`;

    // Check if body already has an error section
    if (!body.includes("## Extraction Error")) {
      newBody = body + errorSection;
    } else {
      // Append to existing error section
      newBody = body.replace(
        /(## Extraction Error[\s\S]*?)(\n\n---|\n\n## (?!Extraction Error)|$)/,
        `$1${errorSection.trim()}\n\n$2`
      );
    }

    const newContent = buildFrontmatter(frontmatter) + "\n\n" + newBody.trimStart();
    await fs.writeFile(filePath, newContent, "utf-8");

    return {
      shouldRetry,
      retryNum: newRetryNum,
      nextRetryAt: shouldRetry ? new Date(Date.now() + calculateBackoffMs(newRetryNum)) : null,
    };
  } catch (err) {
    logger.error({
      event: "file-checker.error_update_failed",
      filePath,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Check if a file is ready for retry based on next-retry-at timestamp
 */
function isReadyForRetry(frontmatter: Record<string, unknown>): boolean {
  if (frontmatter.status !== "retry") {
    return false;
  }

  const nextRetryAt = frontmatter["next-retry-at"];
  if (!nextRetryAt || typeof nextRetryAt !== "string") {
    return true; // If no timestamp, retry immediately
  }

  const retryTime = new Date(nextRetryAt);
  return Date.now() >= retryTime.getTime();
}

/**
 * Detect content type from file content
 */
export function detectContentType(content: string, frontmatter: Record<string, unknown>): "audio" | "video" | "image" | "url" | "document" | "text" {
  const body = content.split("---").slice(2).join("---").trim();

  // Check for embedded audio/video/image/document links
  const audioExtensions = [".mp3", ".wav", ".ogg", ".webm", ".m4a"];
  const videoExtensions = [".mp4", ".webm", ".mov", ".avi", ".mkv"];
  const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"];
  const documentExtensions = [".pdf", ".doc", ".docx", ".txt", ".md", ".markdown", ".rtf", ".odt", ".csv", ".rst"];

  // Look for wiki links like ![[filename.ext]] or [[filename.ext]]
  const wikiLinkRegex = /!?\[\[([^\]]+)\]\]/g;
  const matches = [...body.matchAll(wikiLinkRegex)];

  for (const match of matches) {
    const filename = match[1].toLowerCase();
    if (audioExtensions.some((ext) => filename.endsWith(ext))) {
      return "audio";
    }
    if (videoExtensions.some((ext) => filename.endsWith(ext))) {
      return "video";
    }
    if (imageExtensions.some((ext) => filename.endsWith(ext))) {
      return "image";
    }
    if (documentExtensions.some((ext) => filename.endsWith(ext))) {
      return "document";
    }
  }

  // Check for URLs in the content
  const urlRegex = /https?:\/\/[^\s<>\]]+/gi;
  if (urlRegex.test(body)) {
    return "url";
  }

  return "text";
}

/**
 * Get the path to an attachment file referenced in a note
 */
export function getAttachmentPath(notePath: string, attachmentName: string): string {
  const noteDir = path.dirname(notePath);
  return path.join(noteDir, attachmentName);
}

// Note: The FileChecker class has been replaced with a periodic job.
// See src/server/jobs/file-checker-job.ts for the new implementation.
// File checking is now handled by the job scheduler via periodic job schedules.
