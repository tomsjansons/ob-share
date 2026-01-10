/**
 * Generate Chrome extension icons from the main icon
 *
 * Run with: pnpm tsx scripts/generate-extension-icons.ts
 */

import fs from "fs";
import path from "path";

const SIZES = [16, 48, 128];
const SOURCE_SVG = path.join(process.cwd(), "public/icon-192.svg");
const OUTPUT_DIR = path.join(process.cwd(), "chrome-extension/icons");

async function generateIcons() {
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Read the source SVG
  const svgContent = fs.readFileSync(SOURCE_SVG, "utf-8");

  try {
    // Try using sharp if available
    const sharp = await import("sharp");

    for (const size of SIZES) {
      const outputPath = path.join(OUTPUT_DIR, `icon-${size}.png`);

      // Modify SVG viewBox and dimensions for the target size
      const scaledSvg = svgContent
        .replace(/width="192"/, `width="${size}"`)
        .replace(/height="192"/, `height="${size}"`);

      await sharp
        .default(Buffer.from(scaledSvg))
        .resize(size, size)
        .png()
        .toFile(outputPath);

      console.log(`Generated: ${outputPath}`);
    }

    console.log("\nAll icons generated successfully!");
  } catch (error) {
    console.log("sharp not available, generating SVG icons instead...");

    // Fallback: Generate SVG icons that Chrome can use
    for (const size of SIZES) {
      const outputPath = path.join(OUTPUT_DIR, `icon-${size}.svg`);
      const scaledSvg = svgContent
        .replace(/width="192"/, `width="${size}"`)
        .replace(/height="192"/, `height="${size}"`);

      fs.writeFileSync(outputPath, scaledSvg);
      console.log(`Generated SVG: ${outputPath}`);
    }

    console.log("\nSVG icons generated. For PNG icons, install sharp and re-run.");
    console.log("Run: pnpm add -D sharp && pnpm tsx scripts/generate-extension-icons.ts");
  }
}

generateIcons().catch(console.error);
