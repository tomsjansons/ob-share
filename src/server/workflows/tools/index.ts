/**
 * Tools - Reusable tool definitions for workflows
 *
 * Tools are functions that can be called by workflow steps to perform
 * actions like file I/O, HTTP requests, and other operations.
 */

export {
  readFileTool,
  writeFileTool,
  appendFileTool,
  fileExistsTool,
  listDirectoryTool,
  fileTools,
} from "./file-tools";

export {
  httpRequestTool,
  httpGetTool,
  httpPostTool,
  httpTools,
} from "./http-tools";

import { ToolRegistry } from "../steps/tool-step";
import type { ToolDefinition } from "../types";
import { fileTools } from "./file-tools";
import { httpTools } from "./http-tools";

/**
 * Register all available tools
 */
export function registerAllTools(): void {
  // File tools
  for (const tool of fileTools) {
    ToolRegistry.register(tool as ToolDefinition);
  }

  // HTTP tools
  for (const tool of httpTools) {
    ToolRegistry.register(tool as ToolDefinition);
  }
}
