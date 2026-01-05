/**
 * HTTP Tools - Tools for making HTTP requests
 *
 * Provides tools for making API calls within workflows.
 */

import { z } from "zod";
import { defineTool, type ToolResult } from "../steps/tool-step";

/**
 * HTTP request tool
 */
export const httpRequestTool = defineTool({
  name: "http-request",
  description: "Makes an HTTP request",
  category: "http",
  parameters: [
    {
      name: "url",
      type: "string",
      description: "URL to request",
      required: true,
    },
    {
      name: "method",
      type: "string",
      description: "HTTP method (GET, POST, PUT, DELETE, PATCH)",
      required: false,
    },
    {
      name: "headers",
      type: "object",
      description: "Request headers",
      required: false,
    },
    {
      name: "body",
      type: "object",
      description: "Request body (for POST, PUT, PATCH)",
      required: false,
    },
    {
      name: "timeout",
      type: "number",
      description: "Request timeout in milliseconds",
      required: false,
    },
  ],
  inputSchema: z.object({
    url: z.string().url(),
    method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET"),
    headers: z.record(z.string()).optional(),
    body: z.unknown().optional(),
    timeout: z.number().default(30000),
  }),
  outputSchema: z.object({
    status: z.number(),
    statusText: z.string(),
    headers: z.record(z.string()),
    body: z.unknown(),
    ok: z.boolean(),
  }),
  execute: async (input, context): Promise<ToolResult<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: unknown;
    ok: boolean;
  }>> => {
    try {
      context.logger.debug("Making HTTP request", {
        url: input.url,
        method: input.method,
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), input.timeout);

      // Combine abort signals
      context.signal.addEventListener("abort", () => controller.abort());

      const fetchOptions: RequestInit = {
        method: input.method,
        headers: input.headers,
        signal: controller.signal,
      };

      if (input.body && ["POST", "PUT", "PATCH"].includes(input.method)) {
        fetchOptions.body = JSON.stringify(input.body);
        fetchOptions.headers = {
          "Content-Type": "application/json",
          ...fetchOptions.headers,
        };
      }

      const response = await fetch(input.url, fetchOptions);
      clearTimeout(timeoutId);

      // Parse response body
      let body: unknown;
      const contentType = response.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        body = await response.json();
      } else {
        body = await response.text();
      }

      // Convert headers to object
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        success: true,
        output: {
          status: response.status,
          statusText: response.statusText,
          headers,
          body,
          ok: response.ok,
        },
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return {
          success: false,
          error: "Request was aborted",
        };
      }
      return {
        success: false,
        error: `HTTP request failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

/**
 * HTTP GET tool (simplified)
 */
export const httpGetTool = defineTool({
  name: "http-get",
  description: "Makes an HTTP GET request",
  category: "http",
  parameters: [
    {
      name: "url",
      type: "string",
      description: "URL to fetch",
      required: true,
    },
    {
      name: "headers",
      type: "object",
      description: "Request headers",
      required: false,
    },
  ],
  inputSchema: z.object({
    url: z.string().url(),
    headers: z.record(z.string()).optional(),
  }),
  outputSchema: z.object({
    status: z.number(),
    body: z.unknown(),
    ok: z.boolean(),
  }),
  execute: async (input, context): Promise<ToolResult<{
    status: number;
    body: unknown;
    ok: boolean;
  }>> => {
    try {
      context.logger.debug("Making GET request", { url: input.url });

      const response = await fetch(input.url, {
        headers: input.headers,
        signal: context.signal,
      });

      let body: unknown;
      const contentType = response.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        body = await response.json();
      } else {
        body = await response.text();
      }

      return {
        success: true,
        output: {
          status: response.status,
          body,
          ok: response.ok,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `GET request failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

/**
 * HTTP POST tool (simplified)
 */
export const httpPostTool = defineTool({
  name: "http-post",
  description: "Makes an HTTP POST request with JSON body",
  category: "http",
  parameters: [
    {
      name: "url",
      type: "string",
      description: "URL to post to",
      required: true,
    },
    {
      name: "body",
      type: "object",
      description: "Request body",
      required: true,
    },
    {
      name: "headers",
      type: "object",
      description: "Additional headers",
      required: false,
    },
  ],
  inputSchema: z.object({
    url: z.string().url(),
    body: z.unknown(),
    headers: z.record(z.string()).optional(),
  }),
  outputSchema: z.object({
    status: z.number(),
    body: z.unknown(),
    ok: z.boolean(),
  }),
  execute: async (input, context): Promise<ToolResult<{
    status: number;
    body: unknown;
    ok: boolean;
  }>> => {
    try {
      context.logger.debug("Making POST request", { url: input.url });

      const response = await fetch(input.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...input.headers,
        },
        body: JSON.stringify(input.body),
        signal: context.signal,
      });

      let body: unknown;
      const contentType = response.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        body = await response.json();
      } else {
        body = await response.text();
      }

      return {
        success: true,
        output: {
          status: response.status,
          body,
          ok: response.ok,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `POST request failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

/**
 * All HTTP tools
 */
export const httpTools = [
  httpRequestTool,
  httpGetTool,
  httpPostTool,
];
