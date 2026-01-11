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
import { parseFrontmatter, buildMarkdown } from "@/lib/frontmatter";
import { isReadyForRetry, detectContentType } from "@/server/file-checker";

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
 * Update frontmatter status in a markdown file
 */
async function updateFileStatus(filePath: string, newStatus: string): Promise<void> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = parseFrontmatter(content);

    parsed.data.status = newStatus;

    const newContent = buildMarkdown(parsed.data, parsed.content);
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
 * Scan a single incoming folder for new files
 */
async function scanIncomingFolder(
  incomingPath: string,
  userConfig: {
    userId: string;
    openaiApiKey?: string;
    openaiModel: string;
    textLlmProvider?: "anthropic" | "openai";
    textLlmApiKey?: string;
    textLlmModel?: string;
    documentAnalysisModel: string;
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
    logger.debug({
      event: "file-checker-job.folder_scan_start",
      incomingPath,
    });

    const entries = await fs.readdir(incomingPath, { withFileTypes: true });

    const allFiles = entries.filter(e => e.isFile()).map(e => e.name);
    // Case-insensitive check for markdown files
    const mdFiles = entries.filter(e => e.isFile() && e.name.toLowerCase().endsWith(".md")).map(e => e.name);

    logger.debug({
      event: "file-checker-job.folder_scan_result",
      incomingPath,
      totalEntries: entries.length,
      totalFiles: allFiles.length,
      mdFilesCount: mdFiles.length,
      mdFiles,
    });

    // Log all files found for diagnostic purposes
    logger.info({
      event: "file-checker-job.folder_contents",
      incomingPath,
      allFiles,
      mdFilesCount: mdFiles.length,
    });

    for (const entry of entries) {
      // Case-insensitive check for markdown extension
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
        continue;
      }

      const filePath = path.join(incomingPath, entry.name);

      try {
        logger.debug({
          event: "file-checker-job.file_read_start",
          filePath,
          fileName: entry.name,
        });

        const content = await fs.readFile(filePath, "utf-8");

        logger.debug({
          event: "file-checker-job.file_read_complete",
          filePath,
          contentLength: content.length,
          contentPreview: content.slice(0, 100).replace(/\n/g, "\\n"),
        });

        const parsed = parseFrontmatter(content);

        logger.debug({
          event: "file-checker-job.frontmatter_parsed",
          filePath,
          frontmatterKeys: Object.keys(parsed.data),
          status: parsed.data.status,
          hasFrontmatter: Object.keys(parsed.data).length > 0,
          bodyLength: parsed.content.length,
        });

        // Check if status is "new" or ready for retry
        // Normalize status to handle whitespace/case variations
        const rawStatus = parsed.data.status;
        const normalizedStatus = typeof rawStatus === "string" ? rawStatus.trim().toLowerCase() : rawStatus;
        const isNew = normalizedStatus === "new";
        const isRetryReady = isReadyForRetry(parsed.data);

        // Always log status for each file at INFO level for diagnostics
        logger.info({
          event: "file-checker-job.file_status_check",
          filePath,
          rawStatus: rawStatus,
          rawStatusType: typeof rawStatus,
          normalizedStatus,
          isNew,
          isRetryReady,
          frontmatterKeys: Object.keys(parsed.data),
        });

        if (!isNew && !isRetryReady) {
          logger.debug({
            event: "file-checker-job.file_skipped",
            filePath,
            status: parsed.data.status,
            isNew,
            isRetryReady,
            reason: parsed.data.status ? `status is '${parsed.data.status}', not 'new'` : "no status in frontmatter",
          });
          continue;
        }

        result.filesFound++;

        // Detect content type
        const contentType = detectContentType(content);
        const isRetry = parsed.data.status === "retry";
        const retryNum = typeof parsed.data["retry-num"] === "number" ? parsed.data["retry-num"] : 0;

        // Read debug_type from frontmatter for testing different transcription approaches
        const debugType = typeof parsed.data.debug_type === "number" ? parsed.data.debug_type : undefined;

        logger.info({
          event: isRetry ? "file-checker-job.retry_file_found" : "file-checker-job.new_file_found",
          filePath,
          contentType,
          userId: userConfig.userId,
          retryNum: isRetry ? retryNum : undefined,
          debugType,
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
            textLlmProvider: userConfig.textLlmProvider,
            textLlmApiKey: userConfig.textLlmApiKey,
            textLlmModel: userConfig.textLlmModel,
            documentAnalysisModel: userConfig.documentAnalysisModel,
            maxRetries: userConfig.maxRetries,
            isRetry,
            retryNum,
            debugType,
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

        logger.debug({
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

          // Log if no users have configured vaults
          const configuredUsers = allSettings.filter(s => s.vaultName && s.incomingFolder);
          if (configuredUsers.length === 0 && allSettings.length > 0) {
            logger.info({
              event: "file-checker-job.scan.no_configured_vaults",
              totalUsers: allSettings.length,
            }, "No users have configured vault/incoming folder");
          }

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
              logger.info({
                event: "file-checker-job.scan.folder_not_found",
                userId: settings.userId,
                incomingPath,
              }, "Incoming folder does not exist");
              continue;
            }

            result.vaultsChecked++;

            logger.debug({
              event: "file-checker-job.scan.vault_start",
              userId: settings.userId,
              incomingPath,
            });

            const scanResult = await scanIncomingFolder(incomingPath, {
              userId: settings.userId,
              openaiApiKey: settings.openaiApiKey ?? undefined,
              openaiModel: settings.openaiModel,
              textLlmProvider: settings.textLlmProvider ?? undefined,
              textLlmApiKey: settings.textLlmApiKey ?? undefined,
              textLlmModel: settings.textLlmModel ?? undefined,
              documentAnalysisModel: settings.documentAnalysisModel,
              maxRetries: settings.maxRetries,
            });

            result.filesFound += scanResult.filesFound;
            result.workflowJobsCreated += scanResult.workflowJobsCreated;
            result.errors.push(...scanResult.errors);
          }

          const duration = Date.now() - startTime;

          // Only log at INFO level if files were found
          if (result.filesFound > 0) {
            logger.info({
              event: "file-checker-job.scan.complete",
              jobId: ctx.job.id,
              vaultsChecked: result.vaultsChecked,
              filesFound: result.filesFound,
              workflowJobsCreated: result.workflowJobsCreated,
              errorCount: result.errors.length,
              durationMs: duration,
            }, "File checker scan complete");
          } else {
            logger.debug({
              event: "file-checker-job.scan.complete",
              jobId: ctx.job.id,
              vaultsChecked: result.vaultsChecked,
              filesFound: 0,
              durationMs: duration,
            }, "File checker scan complete (no new files)");
          }

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
    // Only log at INFO level if files were processed
    if (fileResult?.filesFound && fileResult.filesFound > 0) {
      logger.info({
        event: "file-checker-job.completed",
        jobId: job.id,
        vaultsChecked: fileResult.vaultsChecked,
        filesFound: fileResult.filesFound,
        workflowJobsCreated: fileResult.workflowJobsCreated,
      }, "File checker job completed");
    } else {
      logger.debug({
        event: "file-checker-job.completed",
        jobId: job.id,
      }, "File checker job completed (no files)");
    }
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
