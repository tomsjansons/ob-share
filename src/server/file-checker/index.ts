/**
 * File Checker Utilities Module
 *
 * Provides utility functions for working with markdown files.
 * Used by the file-checker job and extraction workflows.
 *
 * Note: File checking is now handled by a periodic job.
 * See src/server/jobs/file-checker-job.ts for the job implementation.
 */

export {
  updateFileStatus,
  updateFileWithError,
  getAttachmentPath,
  parseFrontmatter,
  buildMarkdown,
  isReadyForRetry,
  detectContentType,
} from "./file-checker";
