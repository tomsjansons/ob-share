/**
 * File Checker Module
 *
 * Periodic task for checking new files in incoming folder
 * and triggering extraction workflows.
 */

export {
  FileChecker,
  getGlobalFileChecker,
  resetGlobalFileChecker,
  updateFileStatus,
  getAttachmentPath,
} from "./file-checker";
