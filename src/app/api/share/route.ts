import { NextRequest, NextResponse } from "next/server";
import {
  generateShareId,
  storeSharedData,
  SharedFile,
} from "@/lib/share-store";

// Maximum file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Get the base URL for redirects - use BETTER_AUTH_URL to avoid 0.0.0.0 issues
function getBaseUrl(): string {
  return process.env.BETTER_AUTH_URL || "http://localhost:3000";
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    // Extract text fields
    const title = formData.get("title")?.toString() || "";
    const text = formData.get("text")?.toString() || "";
    const url = formData.get("url")?.toString() || "";

    // Extract files - they come as "media" from the share target
    const files: SharedFile[] = [];
    const mediaFiles = formData.getAll("media");

    for (const file of mediaFiles) {
      if (file instanceof File && file.size > 0) {
        // Check file size
        if (file.size > MAX_FILE_SIZE) {
          console.warn(`File ${file.name} exceeds max size, skipping`);
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
    console.error("Error processing share request:", error);
    const baseUrl = getBaseUrl();
    return NextResponse.redirect(new URL("/share?error=processing", baseUrl), {
      status: 303,
    });
  }
}
