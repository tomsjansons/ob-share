import { NextRequest, NextResponse } from "next/server";
import {
  generateShareId,
  storeSharedData,
  SharedFile,
} from "@/lib/share-store";
import { createLogger, sanitizeFileForLogging } from "@/lib/logger";

// Maximum file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Get the base URL for redirects - use BETTER_AUTH_URL to avoid 0.0.0.0 issues
function getBaseUrl(): string {
  return process.env.BETTER_AUTH_URL || "http://localhost:3000";
}

// Generate a unique request ID
function generateRequestId(): string {
  return `share_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export async function POST(request: NextRequest) {
  const requestId = generateRequestId();
  const logger = createLogger({ requestId, endpoint: "/api/share" });
  const startTime = Date.now();

  logger.info({
    event: "share.request.start",
    method: "POST",
    userAgent: request.headers.get("user-agent"),
  });

  try {
    const formData = await request.formData();

    // Extract text fields (don't log actual content)
    const title = formData.get("title")?.toString() || "";
    const text = formData.get("text")?.toString() || "";
    const url = formData.get("url")?.toString() || "";

    logger.debug({
      event: "share.request.parsed",
      hasTitle: Boolean(title),
      hasTitleLength: title.length,
      hasText: Boolean(text),
      hasTextLength: text.length,
      hasUrl: Boolean(url),
    });

    // Extract files - they come as "media" from the share target
    const files: SharedFile[] = [];
    const mediaFiles = formData.getAll("media");
    let skippedFileCount = 0;

    logger.debug({
      event: "share.request.files_received",
      totalFiles: mediaFiles.length,
    });

    for (const file of mediaFiles) {
      if (file instanceof File && file.size > 0) {
        // Check file size
        if (file.size > MAX_FILE_SIZE) {
          logger.warn({
            event: "share.request.file_skipped",
            reason: "exceeds_max_size",
            file: sanitizeFileForLogging({ name: file.name, type: file.type, size: file.size }),
            maxSize: MAX_FILE_SIZE,
          });
          skippedFileCount++;
          continue;
        }

        // Convert to base64 data URL
        const arrayBuffer = await file.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        const dataUrl = `data:${file.type};base64,${base64}`;

        files.push({
          name: file.name,
          type: file.type,
          size: file.size,
          dataUrl,
        });

        logger.debug({
          event: "share.request.file_processed",
          file: sanitizeFileForLogging({ name: file.name, type: file.type, size: file.size }),
        });
      }
    }

    // Generate unique ID and store the data
    const shareId = generateShareId();
    storeSharedData(shareId, {
      title,
      text,
      url,
      files,
      createdAt: Date.now(),
    });

    const durationMs = Date.now() - startTime;
    logger.info({
      event: "share.request.complete",
      shareId,
      filesProcessed: files.length,
      filesSkipped: skippedFileCount,
      durationMs,
    });

    // Redirect to the share page with the ID
    const baseUrl = getBaseUrl();
    const redirectUrl = new URL("/share", baseUrl);
    redirectUrl.searchParams.set("id", shareId);

    // Also pass text params as fallback for backwards compatibility
    if (title) redirectUrl.searchParams.set("title", title);
    if (text) redirectUrl.searchParams.set("text", text);
    if (url) redirectUrl.searchParams.set("url", url);

    return NextResponse.redirect(redirectUrl, { status: 303 });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error({
      event: "share.request.error",
      error: error instanceof Error ? error.message : "Unknown error",
      durationMs,
    });

    const baseUrl = getBaseUrl();
    return NextResponse.redirect(new URL("/share?error=processing", baseUrl), {
      status: 303,
    });
  }
}
