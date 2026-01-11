import { NextRequest, NextResponse } from "next/server";
import {
  generateShareId,
  storeSharedData,
  CapturedPageData,
} from "@/lib/share-store";
import { createLogger } from "@/lib/logger";

// Maximum content size: 5MB (HTML can be large)
const MAX_CONTENT_SIZE = 5 * 1024 * 1024;

// Generate a unique request ID
function generateRequestId(): string {
  return `captured_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * POST /api/share/captured
 *
 * Receives captured page content from the browser extension.
 * This endpoint handles full page captures including HTML, text, and metadata.
 */
export async function POST(request: NextRequest) {
  const requestId = generateRequestId();
  const logger = createLogger({ requestId, endpoint: "/api/share/captured" });
  const startTime = Date.now();

  logger.info({
    event: "captured.request.start",
    method: "POST",
    userAgent: request.headers.get("user-agent"),
    contentType: request.headers.get("content-type"),
  });

  try {
    // Check content length
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_CONTENT_SIZE) {
      logger.warn({
        event: "captured.request.too_large",
        contentLength,
        maxSize: MAX_CONTENT_SIZE,
      });
      return NextResponse.json(
        { error: "Content too large", maxSize: MAX_CONTENT_SIZE },
        { status: 413 }
      );
    }

    // Parse JSON body
    const body = await request.json() as CapturedPageData;

    // Validate required fields
    if (!body.url || !body.title) {
      logger.warn({
        event: "captured.request.invalid",
        hasUrl: Boolean(body.url),
        hasTitle: Boolean(body.title),
      });
      return NextResponse.json(
        { error: "Missing required fields: url and title" },
        { status: 400 }
      );
    }

    logger.debug({
      event: "captured.request.parsed",
      url: body.url,
      titleLength: body.title?.length ?? 0,
      htmlLength: body.html?.length ?? 0,
      bodyTextLength: body.bodyText?.length ?? 0,
      hasArticle: Boolean(body.articleText),
      articleTextLength: body.articleText?.length ?? 0,
      hasSelection: Boolean(body.selection),
      selectionLength: body.selection?.length ?? 0,
      hasUserNote: Boolean(body.userNote),
      hasMeta: Boolean(body.meta),
    });

    // Generate unique ID and store the data
    const shareId = generateShareId();

    // Store as SharedData with captured content
    storeSharedData(shareId, {
      title: body.title,
      text: body.userNote || "",
      url: body.url,
      files: [],
      createdAt: Date.now(),
      capturedContent: body,
    });

    const durationMs = Date.now() - startTime;
    logger.info({
      event: "captured.request.complete",
      shareId,
      durationMs,
      contentSize: body.html?.length ?? 0,
    });

    // Return the share ID for redirect
    return NextResponse.json({
      success: true,
      id: shareId,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error({
      event: "captured.request.error",
      error: error instanceof Error ? error.message : "Unknown error",
      durationMs,
    });

    return NextResponse.json(
      { error: "Failed to process captured content" },
      { status: 500 }
    );
  }
}

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
