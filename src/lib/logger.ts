import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Pino logger configuration
 * - In development: pretty-print with colors
 * - In production: JSON format for structured logging
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    },
  }),
});

/**
 * Create a child logger with additional context
 */
export function createLogger(context: Record<string, unknown>) {
  return logger.child(context);
}

/**
 * Redact sensitive data from objects before logging
 * Never log actual content being shared (text, urls, file data)
 */
export function sanitizeForLogging<T extends Record<string, unknown>>(
  obj: T,
  sensitiveKeys: string[] = ["text", "url", "title", "dataUrl", "data", "content", "password", "secret", "token"]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (sensitiveKeys.includes(key.toLowerCase())) {
      // Redact sensitive values but indicate they were present
      if (value !== undefined && value !== null && value !== "") {
        result[key] = "[REDACTED]";
      }
    } else if (Array.isArray(value)) {
      // For arrays (like files), log count and metadata only
      result[key] = value.map((item) => {
        if (typeof item === "object" && item !== null) {
          return sanitizeForLogging(item as Record<string, unknown>, sensitiveKeys);
        }
        return item;
      });
    } else if (typeof value === "object" && value !== null) {
      result[key] = sanitizeForLogging(value as Record<string, unknown>, sensitiveKeys);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Sanitize file metadata for logging - only include safe fields
 */
export function sanitizeFileForLogging(file: { name: string; type: string; size?: number }) {
  return {
    name: file.name,
    type: file.type,
    size: file.size,
  };
}

export type Logger = typeof logger;
