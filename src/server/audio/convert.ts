/**
 * Audio Conversion Utility - Converts audio files using FFmpeg
 *
 * Used to convert unsupported audio formats (webm, ogg, m4a) to WAV
 * for compatibility with OpenAI's GPT-4o audio input API.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import { logger as baseLogger } from "@/lib/logger";

const execAsync = promisify(exec);
const logger = baseLogger.child({ module: "audio-convert" });

/**
 * Supported input formats for conversion
 */
const FORMATS_REQUIRING_CONVERSION = [".webm", ".ogg", ".m4a", ".opus", ".flac"];

/**
 * Formats natively supported by OpenAI's input_audio API
 */
const NATIVE_AUDIO_FORMATS = [".wav", ".mp3"];

/**
 * Check if the audio format requires conversion for OpenAI API
 */
export function requiresConversion(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return FORMATS_REQUIRING_CONVERSION.includes(ext);
}

/**
 * Check if the audio format is natively supported by OpenAI
 */
export function isNativeFormat(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return NATIVE_AUDIO_FORMATS.includes(ext);
}

/**
 * Convert audio file to WAV format using FFmpeg
 *
 * @param inputPath - Path to the input audio file
 * @returns Path to the converted WAV file (in temp directory)
 * @throws Error if conversion fails
 */
export async function convertToWav(inputPath: string): Promise<string> {
  const ext = path.extname(inputPath).toLowerCase();

  logger.info({
    event: "audio_convert.start",
    inputPath,
    inputFormat: ext,
    targetFormat: "wav",
  });

  // Generate a unique output path in temp directory
  const tempDir = os.tmpdir();
  const outputFileName = `audio-${uuidv4()}.wav`;
  const outputPath = path.join(tempDir, outputFileName);

  try {
    // Check if input file exists
    await fs.access(inputPath);

    // Build FFmpeg command
    // -y: overwrite output file without asking
    // -i: input file
    // -acodec pcm_s16le: use 16-bit PCM codec (standard WAV)
    // -ar 16000: sample rate 16kHz (good for speech recognition)
    // -ac 1: mono channel
    const command = `ffmpeg -y -i "${inputPath}" -acodec pcm_s16le -ar 16000 -ac 1 "${outputPath}"`;

    logger.debug({
      event: "audio_convert.executing",
      command,
    });

    const { stderr } = await execAsync(command, {
      timeout: 60000, // 60 second timeout
    });

    // FFmpeg outputs progress info to stderr, not stdout
    // Check if output file was created
    await fs.access(outputPath);

    const inputStats = await fs.stat(inputPath);
    const outputStats = await fs.stat(outputPath);

    logger.info({
      event: "audio_convert.complete",
      inputPath,
      outputPath,
      inputSize: inputStats.size,
      outputSize: outputStats.size,
    });

    return outputPath;
  } catch (err) {
    logger.error({
      event: "audio_convert.error",
      inputPath,
      outputPath,
      error: err instanceof Error ? err.message : String(err),
    });

    // Clean up partial output file if it exists
    try {
      await fs.unlink(outputPath);
    } catch {
      // Ignore cleanup errors
    }

    throw new Error(
      `Failed to convert audio: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Clean up a temporary converted file
 */
export async function cleanupConvertedFile(filePath: string): Promise<void> {
  try {
    // Only delete files in temp directory for safety
    if (filePath.startsWith(os.tmpdir())) {
      await fs.unlink(filePath);
      logger.debug({
        event: "audio_convert.cleanup",
        filePath,
      });
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Prepare audio file for OpenAI API
 *
 * If the file is already in a supported format, returns the original path.
 * Otherwise, converts to WAV and returns the converted file path.
 *
 * @returns Object with filePath and wasConverted flag
 */
export async function prepareAudioForOpenAI(
  inputPath: string
): Promise<{ filePath: string; wasConverted: boolean }> {
  if (isNativeFormat(inputPath)) {
    return { filePath: inputPath, wasConverted: false };
  }

  if (requiresConversion(inputPath)) {
    const convertedPath = await convertToWav(inputPath);
    return { filePath: convertedPath, wasConverted: true };
  }

  // Unknown format - try conversion anyway
  logger.warn({
    event: "audio_convert.unknown_format",
    inputPath,
    ext: path.extname(inputPath),
  });

  const convertedPath = await convertToWav(inputPath);
  return { filePath: convertedPath, wasConverted: true };
}
