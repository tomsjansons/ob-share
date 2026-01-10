import { NextResponse } from "next/server";
import archiver from "archiver";
import path from "path";
import fs from "fs";
import { PassThrough } from "stream";

const EXTENSION_DIR = path.join(process.cwd(), "public", "chrome-extension");

export async function GET() {
  try {
    // Check if extension directory exists
    if (!fs.existsSync(EXTENSION_DIR)) {
      return NextResponse.json(
        { error: "Extension not found" },
        { status: 404 }
      );
    }

    // Create a pass-through stream to pipe the archive
    const passThrough = new PassThrough();

    // Create the archive
    const archive = archiver("zip", {
      zlib: { level: 9 }, // Maximum compression
    });

    // Handle archive errors
    archive.on("error", (err) => {
      console.error("Archive error:", err);
      passThrough.destroy(err);
    });

    // Pipe archive to the pass-through stream
    archive.pipe(passThrough);

    // Add the extension directory to the archive
    archive.directory(EXTENSION_DIR, "ob-share-extension");

    // Finalize the archive
    archive.finalize();

    // Convert the pass-through stream to a ReadableStream for Next.js
    const readableStream = new ReadableStream({
      start(controller) {
        passThrough.on("data", (chunk) => {
          controller.enqueue(chunk);
        });
        passThrough.on("end", () => {
          controller.close();
        });
        passThrough.on("error", (err) => {
          controller.error(err);
        });
      },
    });

    // Return the zip file as a download
    return new NextResponse(readableStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="ob-share-extension.zip"',
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error("Extension download error:", error);
    return NextResponse.json(
      { error: "Failed to create extension archive" },
      { status: 500 }
    );
  }
}
