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
import { parseFrontmatter, buildMarkdown } from "@/lib/frontmatter";

const logger = baseLogger.child({ module: "file-checker" });

// Re-export for convenience
export { parseFrontmatter, buildMarkdown };

/**
 * Sanitize a string for safe storage in YAML frontmatter
 * Removes newlines and other characters that could break YAML structure
 */
function sanitizeForFrontmatter(value: string): string {
  return value
    .replace(/\r\n/g, " ") // Replace Windows newlines with space
    .replace(/\n/g, " ") // Replace Unix newlines with space
    .replace(/\r/g, " ") // Replace carriage returns with space
    .replace(/\s+/g, " ") // Collapse multiple whitespace into single space
    .trim();
}

/**
 * Update frontmatter status in a markdown file
 */
export async function updateFileStatus(filePath: string, newStatus: string): Promise<void> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = parseFrontmatter(content);

    parsed.data.status = newStatus;

    const newContent = buildMarkdown(parsed.data, parsed.content);
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
    const parsed = parseFrontmatter(content);

    // Get current retry count
    const currentRetryNum = typeof parsed.data["retry-num"] === "number" ? parsed.data["retry-num"] : 0;
    const newRetryNum = currentRetryNum + 1;

    // Check if we should retry
    const shouldRetry = newRetryNum <= maxRetries;

    // Update frontmatter (sanitize error to remove newlines from JSON responses)
    parsed.data["retry-num"] = newRetryNum;
    parsed.data["last-error"] = sanitizeForFrontmatter(error);
    parsed.data["last-error-at"] = new Date().toISOString();

    if (shouldRetry) {
      // Calculate next retry time with exponential backoff
      const backoffMs = calculateBackoffMs(newRetryNum);
      const nextRetryAt = new Date(Date.now() + backoffMs);
      parsed.data.status = "retry";
      parsed.data["next-retry-at"] = nextRetryAt.toISOString();

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
      parsed.data.status = "extraction_failed";
      parsed.data["next-retry-at"] = null;

      logger.warn({
        event: "file-checker.max_retries_exceeded",
        filePath,
        retryNum: newRetryNum,
        maxRetries,
      });
    }

    // Add error details section to body if not already present
    let newBody = parsed.content;
    const errorSection = `\n\n---\n\n## Extraction Error (Attempt ${newRetryNum}/${maxRetries})\n\n**Error:** ${error}\n\n**Time:** ${new Date().toISOString()}\n\n`;

    // Check if body already has an error section
    if (!parsed.content.includes("## Extraction Error")) {
      newBody = parsed.content + errorSection;
    } else {
      // Append to existing error section
      newBody = parsed.content.replace(
        /(## Extraction Error[\s\S]*?)(\n\n---|\n\n## (?!Extraction Error)|$)/,
        `$1${errorSection.trim()}\n\n$2`
      );
    }

    const newContent = buildMarkdown(parsed.data, newBody);
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
export function isReadyForRetry(data: Record<string, unknown>): boolean {
  // Normalize status to handle whitespace/case variations
  const rawStatus = data.status;
  const normalizedStatus = typeof rawStatus === "string" ? rawStatus.trim().toLowerCase() : rawStatus;

  if (normalizedStatus !== "retry") {
    return false;
  }

  const nextRetryAt = data["next-retry-at"];
  if (!nextRetryAt || typeof nextRetryAt !== "string") {
    return true; // If no timestamp, retry immediately
  }

  const retryTime = new Date(nextRetryAt);
  return Date.now() >= retryTime.getTime();
}

/**
 * Detect content type from file content
 */
export function detectContentType(content: string): "audio" | "video" | "image" | "url" | "document" | "text" {
  const parsed = parseFrontmatter(content);
  const body = parsed.content;

  // Check for embedded audio/video/image/document links
  const audioExtensions = [".mp3", ".wav", ".ogg", ".webm", ".m4a"];
  const videoExtensions = [".mp4", ".webm", ".mov", ".avi", ".mkv"];
  const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"];
  const documentExtensions = [".pdf", ".doc", ".docx", ".txt", ".md", ".markdown", ".rtf", ".odt", ".csv", ".rst"];

  // Look for wiki links like ![[filename.ext]] or [[filename.ext]]
  const wikiLinkRegex = /!?\[\[([^\]]+)\]\]/g;
  const matches = [...body.matchAll(wikiLinkRegex)];

  logger.debug({
    event: "file-checker.detect_content_type.start",
    bodyLength: body.length,
    wikiLinksFound: matches.length,
    wikiLinks: matches.map(m => m[1]),
  });

  for (const match of matches) {
    const filename = match[1].toLowerCase();
    if (audioExtensions.some((ext) => filename.endsWith(ext))) {
      logger.debug({
        event: "file-checker.detect_content_type.result",
        contentType: "audio",
        matchedFile: filename,
      });
      return "audio";
    }
    if (videoExtensions.some((ext) => filename.endsWith(ext))) {
      logger.debug({
        event: "file-checker.detect_content_type.result",
        contentType: "video",
        matchedFile: filename,
      });
      return "video";
    }
    if (imageExtensions.some((ext) => filename.endsWith(ext))) {
      logger.debug({
        event: "file-checker.detect_content_type.result",
        contentType: "image",
        matchedFile: filename,
      });
      return "image";
    }
    if (documentExtensions.some((ext) => filename.endsWith(ext))) {
      logger.debug({
        event: "file-checker.detect_content_type.result",
        contentType: "document",
        matchedFile: filename,
      });
      return "document";
    }
  }

  // Check for URLs in the content
  const urlRegex = /https?:\/\/[^\s<>\]]+/gi;
  const urlMatches = body.match(urlRegex);
  if (urlMatches && urlMatches.length > 0) {
    logger.debug({
      event: "file-checker.detect_content_type.result",
      contentType: "url",
      urlCount: urlMatches.length,
      firstUrl: urlMatches[0],
    });
    return "url";
  }

  logger.debug({
    event: "file-checker.detect_content_type.result",
    contentType: "text",
    reason: "no attachments or URLs found",
  });
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
