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
 * Tolerance for duration validation (in seconds)
 * Allow up to 0.5 seconds difference due to codec variations
 */
const DURATION_TOLERANCE_SECONDS = 0.5;

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
 * Get audio duration in seconds using ffprobe
 * Uses multiple strategies for robustness:
 * 1. Try format duration (works for most formats)
 * 2. Fall back to stream duration (needed for some WAV files)
 * 3. Calculate from file properties (fallback for PCM WAV)
 */
export async function getAudioDuration(filePath: string): Promise<number> {
  try {
    // Strategy 1: Try format duration (works for most formats like webm, mp3)
    const formatCommand = `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`;
    const { stdout: formatOutput } = await execAsync(formatCommand, { timeout: 30000 });
    const formatDuration = parseFloat(formatOutput.trim());

    if (!isNaN(formatDuration) && formatDuration > 0) {
      logger.debug({
        event: "audio_convert.duration_from_format",
        filePath,
        duration: formatDuration,
      });
      return formatDuration;
    }

    // Strategy 2: Try stream duration (needed for some containers)
    const streamCommand = `ffprobe -v quiet -select_streams a:0 -show_entries stream=duration -of csv=p=0 "${filePath}"`;
    const { stdout: streamOutput } = await execAsync(streamCommand, { timeout: 30000 });
    const streamDuration = parseFloat(streamOutput.trim());

    if (!isNaN(streamDuration) && streamDuration > 0) {
      logger.debug({
        event: "audio_convert.duration_from_stream",
        filePath,
        duration: streamDuration,
      });
      return streamDuration;
    }

    // Strategy 3: Calculate from WAV file properties (for PCM WAV files)
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".wav") {
      // Get sample rate, channels, and bits per sample to calculate duration
      const probeCommand = `ffprobe -v quiet -select_streams a:0 -show_entries stream=sample_rate,channels,bits_per_sample,codec_name -of json "${filePath}"`;
      const { stdout: probeOutput } = await execAsync(probeCommand, { timeout: 30000 });
      const probeData = JSON.parse(probeOutput);
      const stream = probeData?.streams?.[0];

      if (stream?.sample_rate) {
        const sampleRate = parseInt(stream.sample_rate, 10);
        const channels = parseInt(stream.channels, 10) || 1;
        const bitsPerSample = parseInt(stream.bits_per_sample, 10) || 16;

        // Get file size and estimate duration
        const stats = await fs.stat(filePath);
        const fileSize = stats.size;

        // WAV header is typically 44 bytes for standard PCM
        const dataSize = fileSize - 44;
        const bytesPerSample = bitsPerSample / 8;
        const bytesPerSecond = sampleRate * channels * bytesPerSample;
        const calculatedDuration = dataSize / bytesPerSecond;

        if (calculatedDuration > 0) {
          logger.debug({
            event: "audio_convert.duration_calculated_wav",
            filePath,
            duration: calculatedDuration,
            sampleRate,
            channels,
            bitsPerSample,
            fileSize,
          });
          return calculatedDuration;
        }
      }
    }

    // If all strategies fail, try one more approach: ffprobe with duration calculation
    const durationCalcCommand = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
    const { stdout: calcOutput } = await execAsync(durationCalcCommand, { timeout: 30000 });
    const calcDuration = parseFloat(calcOutput.trim());

    if (!isNaN(calcDuration) && calcDuration > 0) {
      logger.debug({
        event: "audio_convert.duration_from_calc",
        filePath,
        duration: calcDuration,
      });
      return calcDuration;
    }

    throw new Error(`Could not determine duration from ffprobe output (format: '${formatOutput.trim()}', stream: '${streamOutput.trim()}')`);
  } catch (err) {
    logger.error({
      event: "audio_convert.duration_error",
      filePath,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Error(
      `Failed to get audio duration: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Validate that two audio files have matching durations
 * @returns true if durations match within tolerance
 */
export async function validateAudioDuration(
  originalPath: string,
  convertedPath: string
): Promise<{ valid: boolean; originalDuration: number; convertedDuration: number }> {
  const originalDuration = await getAudioDuration(originalPath);
  const convertedDuration = await getAudioDuration(convertedPath);

  const difference = Math.abs(originalDuration - convertedDuration);
  const valid = difference <= DURATION_TOLERANCE_SECONDS;

  logger.info({
    event: "audio_convert.duration_validation",
    originalPath,
    convertedPath,
    originalDuration,
    convertedDuration,
    difference,
    valid,
    tolerance: DURATION_TOLERANCE_SECONDS,
  });

  return { valid, originalDuration, convertedDuration };
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
    // -ar 24000: sample rate 24kHz (OpenAI recommended for audio input)
    // -ac 1: mono channel
    const command = `ffmpeg -y -i "${inputPath}" -acodec pcm_s16le -ar 24000 -ac 1 "${outputPath}"`;

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

/**
 * Result of audio conversion with validation
 */
export interface AudioConversionResult {
  /** Whether conversion was needed (false for native formats like wav, mp3) */
  wasConverted: boolean;
  /** Path to the audio file to use for transcription */
  transcriptionFilePath: string;
  /** Path to the WAV file saved in vault (if converted) */
  vaultWavPath?: string;
  /** Whether duration validation passed */
  durationValid: boolean;
  /** Original audio duration in seconds */
  originalDuration?: number;
  /** Converted audio duration in seconds */
  convertedDuration?: number;
  /** Error message if validation failed */
  validationError?: string;
}

/**
 * Convert audio to WAV with duration validation and save to vault
 *
 * This function:
 * 1. Checks if the file needs conversion (wav/mp3 are native)
 * 2. Converts to WAV if needed
 * 3. Validates duration matches between original and converted
 * 4. Saves the WAV file to the vault next to the original
 * 5. Returns detailed info for markdown attachment
 *
 * @param inputPath - Path to the input audio file
 * @returns Conversion result with validation info
 */
export async function convertAndValidateAudio(
  inputPath: string
): Promise<AudioConversionResult> {
  // Check if this is a native format that doesn't need conversion
  if (isNativeFormat(inputPath)) {
    logger.info({
      event: "audio_convert.native_format",
      inputPath,
      format: path.extname(inputPath).toLowerCase(),
    });

    return {
      wasConverted: false,
      transcriptionFilePath: inputPath,
      durationValid: true,
    };
  }

  // Convert to WAV (to temp directory first)
  const tempWavPath = await convertToWav(inputPath);

  // Generate the vault destination path (same directory as original, with .wav extension)
  const inputDir = path.dirname(inputPath);
  const inputBasename = path.basename(inputPath, path.extname(inputPath));
  const vaultWavPath = path.join(inputDir, `${inputBasename}.wav`);

  try {
    // Validate duration
    const validation = await validateAudioDuration(inputPath, tempWavPath);

    // Copy WAV to vault (regardless of validation - user wants it saved either way)
    await fs.copyFile(tempWavPath, vaultWavPath);

    logger.info({
      event: "audio_convert.saved_to_vault",
      inputPath,
      vaultWavPath,
      durationValid: validation.valid,
    });

    // Clean up temp file
    await cleanupConvertedFile(tempWavPath);

    if (!validation.valid) {
      const errorMsg = `Duration mismatch: original ${validation.originalDuration.toFixed(2)}s vs converted ${validation.convertedDuration.toFixed(2)}s (difference: ${Math.abs(validation.originalDuration - validation.convertedDuration).toFixed(2)}s exceeds tolerance of ${DURATION_TOLERANCE_SECONDS}s)`;

      logger.warn({
        event: "audio_convert.duration_mismatch",
        inputPath,
        vaultWavPath,
        originalDuration: validation.originalDuration,
        convertedDuration: validation.convertedDuration,
        error: errorMsg,
      });

      return {
        wasConverted: true,
        transcriptionFilePath: vaultWavPath,
        vaultWavPath,
        durationValid: false,
        originalDuration: validation.originalDuration,
        convertedDuration: validation.convertedDuration,
        validationError: errorMsg,
      };
    }

    return {
      wasConverted: true,
      transcriptionFilePath: vaultWavPath,
      vaultWavPath,
      durationValid: true,
      originalDuration: validation.originalDuration,
      convertedDuration: validation.convertedDuration,
    };
  } catch (err) {
    // If validation or copy fails, still try to save the temp file to vault
    try {
      await fs.copyFile(tempWavPath, vaultWavPath);
      logger.warn({
        event: "audio_convert.saved_with_error",
        inputPath,
        vaultWavPath,
        error: err instanceof Error ? err.message : String(err),
      });
    } catch {
      // Ignore copy errors
    }

    // Clean up temp file
    await cleanupConvertedFile(tempWavPath);

    const errorMsg = `Validation error: ${err instanceof Error ? err.message : String(err)}`;

    return {
      wasConverted: true,
      transcriptionFilePath: vaultWavPath,
      vaultWavPath,
      durationValid: false,
      validationError: errorMsg,
    };
  }
}
