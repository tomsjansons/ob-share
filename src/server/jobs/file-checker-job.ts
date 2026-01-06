/**
 * File Checker Job - Periodic job for scanning incoming folders
 *
 * This job scans all user vaults' incoming folders for markdown files
 * with status: new (or ready for retry) and creates workflow jobs for each.
 *
 * The job runs periodically via the periodic job scheduler and spawns
 * individual workflow jobs for each file found.
 */

import { promises as fs } from "fs";
import path from "path";
import { db } from "../db";
import { userSettings } from "../db/schema";
import { defineJob, JobPriority, type PhaseContext } from "./index";
import { createWorkflowJob } from "@/server/workflows";
import { logger as baseLogger } from "@/lib/logger";

const logger = baseLogger.child({ module: "file-checker-job" });

// Base path for vault storage
const DATA_ROOT = "/data/Documents";

/**
 * Payload for the file checker job
 */
export interface FileCheckerJobPayload {
  /** Schedule ID that triggered this job (set by periodic scheduler) */
  _scheduleId?: string;
  /** When this was scheduled (set by periodic scheduler) */
  _scheduledAt?: string;
}

/**
 * Result of the file checker job
 */
export interface FileCheckerJobResult {
  vaultsChecked: number;
  filesFound: number;
  workflowJobsCreated: number;
  errors: Array<{ path: string; error: string }>;
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
 * Rebuild frontmatter to string
 */
function buildFrontmatter(frontmatter: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => `"${v}"`).join(", ")}]`);
    } else if (typeof value === "string") {
      lines.push(`${key}: "${value}"`);
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
async function updateFileStatus(filePath: string, newStatus: string): Promise<void> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);

    frontmatter.status = newStatus;

    const newContent = buildFrontmatter(frontmatter) + "\n\n" + body;
    await fs.writeFile(filePath, newContent, "utf-8");

    logger.debug({
      event: "file-checker-job.status_updated",
      filePath,
      newStatus,
    });
  } catch (err) {
    logger.error({
      event: "file-checker-job.status_update_error",
      filePath,
      newStatus,
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
 * Scan a single incoming folder for new files
 */
async function scanIncomingFolder(
  incomingPath: string,
  userConfig: {
    userId: string;
    openaiApiKey?: string;
    openaiModel: string;
    maxRetries: number;
  }
): Promise<{
  filesFound: number;
  workflowJobsCreated: number;
  errors: Array<{ path: string; error: string }>;
}> {
  const result = {
    filesFound: 0,
    workflowJobsCreated: 0,
    errors: [] as Array<{ path: string; error: string }>,
  };

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

        // Check if status is "new" or ready for retry
        const isNew = frontmatter.status === "new";
        const isRetryReady = isReadyForRetry(frontmatter);

        if (!isNew && !isRetryReady) {
          continue;
        }

        result.filesFound++;

        // Detect content type
        const contentType = detectContentType(content, frontmatter);
        const isRetry = frontmatter.status === "retry";
        const retryNum = typeof frontmatter["retry-num"] === "number" ? frontmatter["retry-num"] : 0;

        logger.info({
          event: isRetry ? "file-checker-job.retry_file_found" : "file-checker-job.new_file_found",
          filePath,
          contentType,
          userId: userConfig.userId,
          retryNum: isRetry ? retryNum : undefined,
        });

        // Update status to "extracting"
        await updateFileStatus(filePath, "extracting");

        // Create workflow job for extraction
        await createWorkflowJob({
          workflowId: "new-note-extract",
          trigger: {
            filePath,
            contentType,
            userId: userConfig.userId,
            openaiApiKey: userConfig.openaiApiKey,
            openaiModel: userConfig.openaiModel,
            maxRetries: userConfig.maxRetries,
            isRetry,
            retryNum,
          },
          userId: userConfig.userId,
        });

        result.workflowJobsCreated++;

        logger.info({
          event: "file-checker-job.workflow_created",
          filePath,
          contentType,
          isRetry,
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        result.errors.push({ path: filePath, error });
        logger.error({
          event: "file-checker-job.file_process_error",
          filePath,
          error,
        });
      }
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    result.errors.push({ path: incomingPath, error });
    logger.error({
      event: "file-checker-job.folder_read_error",
      incomingPath,
      error,
    });
  }

  return result;
}

/**
 * File Checker Job Definition
 *
 * This job scans all user vaults for new files and creates workflow jobs.
 */
export const fileCheckerJob = defineJob<FileCheckerJobPayload>({
  type: "file-checker",
  description: "Scans incoming folders for new files and creates extraction workflows",
  defaultPriority: JobPriority.NORMAL,
  defaultMaxRetries: 1, // Don't retry - next scheduled run will pick up missed files

  phases: [
    {
      name: "scan-vaults",
      async execute(ctx: PhaseContext<FileCheckerJobPayload>): Promise<{
        success: boolean;
        output?: FileCheckerJobResult;
        error?: string;
      }> {
        const startTime = Date.now();

        logger.info({
          event: "file-checker-job.scan.start",
          jobId: ctx.job.id,
          scheduleId: ctx.job.payload._scheduleId,
        }, "Starting file checker scan");

        const result: FileCheckerJobResult = {
          vaultsChecked: 0,
          filesFound: 0,
          workflowJobsCreated: 0,
          errors: [],
        };

        try {
          // Get all user settings with configured vaults
          const allSettings = await db.select().from(userSettings);

          logger.debug({
            event: "file-checker-job.scan.users",
            userCount: allSettings.length,
          });

          for (const settings of allSettings) {
            if (!settings.vaultName || !settings.incomingFolder) {
              continue;
            }

            const incomingPath = path.join(DATA_ROOT, settings.vaultName, settings.incomingFolder);

            // Check if incoming folder exists
            try {
              await fs.access(incomingPath);
            } catch {
              // Folder doesn't exist, skip this user
              continue;
            }

            result.vaultsChecked++;

            const scanResult = await scanIncomingFolder(incomingPath, {
              userId: settings.userId,
              openaiApiKey: settings.openaiApiKey ?? undefined,
              openaiModel: settings.openaiModel,
              maxRetries: settings.maxRetries,
            });

            result.filesFound += scanResult.filesFound;
            result.workflowJobsCreated += scanResult.workflowJobsCreated;
            result.errors.push(...scanResult.errors);
          }

          const duration = Date.now() - startTime;

          logger.info({
            event: "file-checker-job.scan.complete",
            jobId: ctx.job.id,
            vaultsChecked: result.vaultsChecked,
            filesFound: result.filesFound,
            workflowJobsCreated: result.workflowJobsCreated,
            errorCount: result.errors.length,
            durationMs: duration,
          }, "File checker scan complete");

          return {
            success: true,
            output: result,
          };
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);

          logger.error({
            event: "file-checker-job.scan.error",
            jobId: ctx.job.id,
            error,
          }, "File checker scan failed");

          return {
            success: false,
            error,
          };
        }
      },
    },
  ],

  async onComplete(job, result) {
    const fileResult = result as FileCheckerJobResult;
    logger.info({
      event: "file-checker-job.completed",
      jobId: job.id,
      vaultsChecked: fileResult?.vaultsChecked,
      filesFound: fileResult?.filesFound,
      workflowJobsCreated: fileResult?.workflowJobsCreated,
    }, "File checker job completed");
  },

  async onFailed(job, error) {
    logger.error({
      event: "file-checker-job.failed",
      jobId: job.id,
      error,
    }, "File checker job failed");
  },
});

/**
 * Schedule ID for the file checker periodic job
 */
export const FILE_CHECKER_SCHEDULE_ID = "file-checker";

/**
 * Default interval for file checking (10 seconds)
 */
export const DEFAULT_FILE_CHECK_INTERVAL_MS = 10 * 1000;
