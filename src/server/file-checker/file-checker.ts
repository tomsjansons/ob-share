/**
 * File Checker - Periodic task for checking new files in incoming folder
 *
 * Scans the incoming folder for markdown files with status: new in frontmatter
 * and triggers the new-note-extract workflow for each one.
 */

import { promises as fs } from "fs";
import path from "path";
import { db } from "@/server/db";
import { userSettings } from "@/server/db/schema";
import { logger as baseLogger } from "@/lib/logger";
import { createWorkflowJob } from "@/server/workflows";

const logger = baseLogger.child({ module: "file-checker" });

// Base path for vault storage
const DATA_ROOT = "/data/Documents";

// Default check interval (10 seconds)
const DEFAULT_CHECK_INTERVAL_MS = 10 * 1000;

interface FileInfo {
  path: string;
  content: string;
  frontmatter: Record<string, unknown>;
}

interface FileCheckerConfig {
  /** Check interval in milliseconds. Default: 10 seconds */
  intervalMs?: number;
  /** Run check immediately on start */
  runOnStart?: boolean;
}

interface FileCheckerStatus {
  isRunning: boolean;
  isChecking: boolean;
  lastCheck: Date | null;
  lastCheckDuration: number | null;
  lastCheckFilesFound: number;
  nextCheck: Date | null;
  totalChecks: number;
  totalFilesProcessed: number;
  errors: Array<{ timestamp: Date; error: string }>;
}

/**
 * Parse YAML frontmatter from markdown content
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
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
 * Update frontmatter status in a markdown file
 */
export async function updateFileStatus(filePath: string, newStatus: string): Promise<void> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);

    frontmatter.status = newStatus;

    // Rebuild frontmatter
    const frontmatterLines = ["---"];
    for (const [key, value] of Object.entries(frontmatter)) {
      if (Array.isArray(value)) {
        frontmatterLines.push(`${key}: [${value.map((v) => `"${v}"`).join(", ")}]`);
      } else if (typeof value === "string") {
        frontmatterLines.push(`${key}: "${value}"`);
      } else {
        frontmatterLines.push(`${key}: ${value}`);
      }
    }
    frontmatterLines.push("---");
    frontmatterLines.push("");

    const newContent = frontmatterLines.join("\n") + body;
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
 * Detect content type from file content
 */
function detectContentType(content: string, frontmatter: Record<string, unknown>): "audio" | "video" | "image" | "url" | "text" {
  const body = content.split("---").slice(2).join("---").trim();

  // Check for embedded audio/video/image links
  const audioExtensions = [".mp3", ".wav", ".ogg", ".webm", ".m4a"];
  const videoExtensions = [".mp4", ".webm", ".mov", ".avi", ".mkv"];
  const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"];

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

/**
 * File Checker class for periodic scanning
 */
export class FileChecker {
  private config: Required<FileCheckerConfig>;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private isChecking = false;

  private status: FileCheckerStatus = {
    isRunning: false,
    isChecking: false,
    lastCheck: null,
    lastCheckDuration: null,
    lastCheckFilesFound: 0,
    nextCheck: null,
    totalChecks: 0,
    totalFilesProcessed: 0,
    errors: [],
  };

  constructor(config?: FileCheckerConfig) {
    this.config = {
      intervalMs: config?.intervalMs ?? DEFAULT_CHECK_INTERVAL_MS,
      runOnStart: config?.runOnStart ?? false,
    };
  }

  /**
   * Start the file checker
   */
  start(): void {
    if (this.status.isRunning) {
      logger.warn({ event: "file-checker.already_running" });
      return;
    }

    this.status.isRunning = true;
    logger.info({
      event: "file-checker.started",
      intervalMs: this.config.intervalMs,
    });

    // Schedule periodic checks
    this.scheduleNextCheck();

    // Run immediately if configured
    if (this.config.runOnStart) {
      this.triggerCheck().catch((err) => {
        logger.error({ event: "file-checker.initial_check_error", err });
      });
    }
  }

  /**
   * Stop the file checker
   */
  stop(): void {
    if (!this.status.isRunning) {
      return;
    }

    if (this.intervalTimer) {
      clearTimeout(this.intervalTimer);
      this.intervalTimer = null;
    }

    this.status.isRunning = false;
    this.status.nextCheck = null;
    logger.info({
      event: "file-checker.stopped",
      totalChecks: this.status.totalChecks,
      totalFilesProcessed: this.status.totalFilesProcessed,
    });
  }

  /**
   * Update the check interval
   */
  updateInterval(intervalMs: number): void {
    this.config.intervalMs = intervalMs;
    if (this.status.isRunning && this.intervalTimer) {
      clearTimeout(this.intervalTimer);
      this.scheduleNextCheck();
    }
    logger.info({
      event: "file-checker.interval_updated",
      intervalMs,
    });
  }

  /**
   * Manually trigger a check
   */
  async triggerCheck(): Promise<{
    success: boolean;
    filesFound: number;
    filesProcessed: number;
    duration: number;
    error?: string;
  }> {
    if (this.isChecking) {
      return {
        success: false,
        filesFound: 0,
        filesProcessed: 0,
        duration: 0,
        error: "Check is already in progress",
      };
    }

    this.isChecking = true;
    this.status.isChecking = true;
    const startTime = Date.now();

    try {
      const result = await this.checkAllVaults();
      const duration = Date.now() - startTime;

      this.status.lastCheck = new Date();
      this.status.lastCheckDuration = duration;
      this.status.lastCheckFilesFound = result.filesFound;
      this.status.totalChecks++;
      this.status.totalFilesProcessed += result.filesProcessed;

      logger.info({
        event: "file-checker.check_completed",
        filesFound: result.filesFound,
        filesProcessed: result.filesProcessed,
        durationMs: duration,
      });

      return {
        success: true,
        filesFound: result.filesFound,
        filesProcessed: result.filesProcessed,
        duration,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const duration = Date.now() - startTime;

      this.status.errors.push({ timestamp: new Date(), error });
      if (this.status.errors.length > 10) {
        this.status.errors.shift();
      }

      logger.error({
        event: "file-checker.check_error",
        error,
        durationMs: duration,
      });

      return {
        success: false,
        filesFound: 0,
        filesProcessed: 0,
        duration,
        error,
      };
    } finally {
      this.isChecking = false;
      this.status.isChecking = false;

      // Schedule next check if still running
      if (this.status.isRunning) {
        this.scheduleNextCheck();
      }
    }
  }

  /**
   * Get current status
   */
  getStatus(): FileCheckerStatus {
    return { ...this.status };
  }

  /**
   * Schedule the next check
   */
  private scheduleNextCheck(): void {
    if (this.intervalTimer) {
      clearTimeout(this.intervalTimer);
    }

    this.status.nextCheck = new Date(Date.now() + this.config.intervalMs);

    this.intervalTimer = setTimeout(() => {
      this.triggerCheck().catch((err) => {
        logger.error({ event: "file-checker.scheduled_check_error", err });
      });
    }, this.config.intervalMs);
  }

  /**
   * Check all user vaults for new files
   */
  private async checkAllVaults(): Promise<{ filesFound: number; filesProcessed: number }> {
    // Get all user settings with configured vaults
    const allSettings = await db.select().from(userSettings);

    let totalFilesFound = 0;
    let totalFilesProcessed = 0;

    for (const settings of allSettings) {
      if (!settings.vaultName || !settings.incomingFolder) {
        continue;
      }

      const incomingPath = path.join(DATA_ROOT, settings.vaultName, settings.incomingFolder);

      try {
        // Check if incoming folder exists
        await fs.access(incomingPath);
      } catch {
        // Folder doesn't exist, skip this user
        continue;
      }

      const result = await this.checkIncomingFolder(incomingPath, settings.userId);
      totalFilesFound += result.filesFound;
      totalFilesProcessed += result.filesProcessed;
    }

    return { filesFound: totalFilesFound, filesProcessed: totalFilesProcessed };
  }

  /**
   * Check a specific incoming folder for new files
   */
  private async checkIncomingFolder(
    incomingPath: string,
    userId: string
  ): Promise<{ filesFound: number; filesProcessed: number }> {
    let filesFound = 0;
    let filesProcessed = 0;

    try {
      const entries = await fs.readdir(incomingPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) {
          continue;
        }

        const filePath = path.join(incomingPath, entry.name);

        try {
          const content = await fs.readFile(filePath, "utf-8");
          const { frontmatter } = parseFrontmatter(content);

          // Check if status is "new"
          if (frontmatter.status !== "new") {
            continue;
          }

          filesFound++;

          // Detect content type
          const contentType = detectContentType(content, frontmatter);

          logger.info({
            event: "file-checker.new_file_found",
            filePath,
            contentType,
            userId,
          });

          // Update status to "extracting"
          await updateFileStatus(filePath, "extracting");

          // Create workflow job for extraction
          await createWorkflowJob({
            workflowId: "new-note-extract",
            trigger: {
              filePath,
              contentType,
              userId,
            },
            userId,
          });

          filesProcessed++;

          logger.info({
            event: "file-checker.workflow_triggered",
            filePath,
            contentType,
          });
        } catch (err) {
          logger.error({
            event: "file-checker.file_process_error",
            filePath,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      logger.error({
        event: "file-checker.folder_read_error",
        incomingPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return { filesFound, filesProcessed };
  }
}

// Global file checker instance
let globalFileChecker: FileChecker | null = null;

/**
 * Get or create the global file checker instance
 */
export function getGlobalFileChecker(config?: FileCheckerConfig): FileChecker {
  if (!globalFileChecker) {
    globalFileChecker = new FileChecker(config);
  }
  return globalFileChecker;
}

/**
 * Reset the global file checker (useful for testing)
 */
export function resetGlobalFileChecker(): void {
  if (globalFileChecker) {
    globalFileChecker.stop();
    globalFileChecker = null;
  }
}
