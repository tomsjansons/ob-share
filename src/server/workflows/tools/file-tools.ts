/**
 * File Tools - Tools for file system operations
 *
 * Provides tools for reading and writing files within workflows.
 */

import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "../steps/tool-step";

/**
 * Read file tool
 */
export const readFileTool = defineTool({
  name: "read-file",
  description: "Reads the contents of a file",
  category: "file",
  parameters: [
    {
      name: "path",
      type: "string",
      description: "Path to the file to read",
      required: true,
    },
    {
      name: "encoding",
      type: "string",
      description: "File encoding (default: utf-8)",
      required: false,
    },
  ],
  inputSchema: z.object({
    path: z.string(),
    encoding: z.string().default("utf-8"),
  }),
  outputSchema: z.object({
    content: z.string(),
    path: z.string(),
    size: z.number(),
  }),
  execute: async (input, context): Promise<ToolResult<{ content: string; path: string; size: number }>> => {
    try {
      context.logger.debug("Reading file", { path: input.path });

      const content = await fs.readFile(input.path, {
        encoding: input.encoding as BufferEncoding,
      });

      const stats = await fs.stat(input.path);

      return {
        success: true,
        output: {
          content,
          path: input.path,
          size: stats.size,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

/**
 * Write file tool
 */
export const writeFileTool = defineTool({
  name: "write-file",
  description: "Writes content to a file",
  category: "file",
  parameters: [
    {
      name: "path",
      type: "string",
      description: "Path to the file to write",
      required: true,
    },
    {
      name: "content",
      type: "string",
      description: "Content to write",
      required: true,
    },
    {
      name: "createDirs",
      type: "boolean",
      description: "Create parent directories if they don't exist",
      required: false,
    },
  ],
  inputSchema: z.object({
    path: z.string(),
    content: z.string(),
    createDirs: z.boolean().default(true),
  }),
  outputSchema: z.object({
    path: z.string(),
    size: z.number(),
  }),
  execute: async (input, context): Promise<ToolResult<{ path: string; size: number }>> => {
    try {
      context.logger.debug("Writing file", { path: input.path });

      if (input.createDirs) {
        const dir = path.dirname(input.path);
        await fs.mkdir(dir, { recursive: true });
      }

      await fs.writeFile(input.path, input.content, "utf-8");
      const stats = await fs.stat(input.path);

      return {
        success: true,
        output: {
          path: input.path,
          size: stats.size,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to write file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

/**
 * Append file tool
 */
export const appendFileTool = defineTool({
  name: "append-file",
  description: "Appends content to a file",
  category: "file",
  parameters: [
    {
      name: "path",
      type: "string",
      description: "Path to the file",
      required: true,
    },
    {
      name: "content",
      type: "string",
      description: "Content to append",
      required: true,
    },
  ],
  inputSchema: z.object({
    path: z.string(),
    content: z.string(),
  }),
  outputSchema: z.object({
    path: z.string(),
    newSize: z.number(),
  }),
  execute: async (input, context): Promise<ToolResult<{ path: string; newSize: number }>> => {
    try {
      context.logger.debug("Appending to file", { path: input.path });

      await fs.appendFile(input.path, input.content, "utf-8");
      const stats = await fs.stat(input.path);

      return {
        success: true,
        output: {
          path: input.path,
          newSize: stats.size,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to append to file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

/**
 * Check file exists tool
 */
export const fileExistsTool = defineTool({
  name: "file-exists",
  description: "Checks if a file or directory exists",
  category: "file",
  parameters: [
    {
      name: "path",
      type: "string",
      description: "Path to check",
      required: true,
    },
  ],
  inputSchema: z.object({
    path: z.string(),
  }),
  outputSchema: z.object({
    exists: z.boolean(),
    isFile: z.boolean().optional(),
    isDirectory: z.boolean().optional(),
  }),
  execute: async (input, context): Promise<ToolResult<{ exists: boolean; isFile?: boolean; isDirectory?: boolean }>> => {
    try {
      const stats = await fs.stat(input.path);
      return {
        success: true,
        output: {
          exists: true,
          isFile: stats.isFile(),
          isDirectory: stats.isDirectory(),
        },
      };
    } catch {
      return {
        success: true,
        output: {
          exists: false,
        },
      };
    }
  },
});

/**
 * List directory tool
 */
export const listDirectoryTool = defineTool({
  name: "list-directory",
  description: "Lists files and directories in a path",
  category: "file",
  parameters: [
    {
      name: "path",
      type: "string",
      description: "Directory path",
      required: true,
    },
  ],
  inputSchema: z.object({
    path: z.string(),
  }),
  outputSchema: z.object({
    entries: z.array(
      z.object({
        name: z.string(),
        type: z.enum(["file", "directory", "other"]),
      })
    ),
  }),
  execute: async (input, context): Promise<ToolResult<{ entries: Array<{ name: string; type: "file" | "directory" | "other" }> }>> => {
    try {
      context.logger.debug("Listing directory", { path: input.path });

      const items = await fs.readdir(input.path, { withFileTypes: true });
      const entries = items.map((item) => ({
        name: item.name,
        type: item.isFile()
          ? ("file" as const)
          : item.isDirectory()
            ? ("directory" as const)
            : ("other" as const),
      }));

      return {
        success: true,
        output: { entries },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to list directory: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

/**
 * All file tools
 */
export const fileTools = [
  readFileTool,
  writeFileTool,
  appendFileTool,
  fileExistsTool,
  listDirectoryTool,
];
