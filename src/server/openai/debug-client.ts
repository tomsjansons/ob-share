/**
 * OpenAI Debug Client - Multiple implementations to diagnose 404 errors
 *
 * This file provides different approaches to calling the OpenAI audio transcription
 * endpoint. Each debug_type represents a different strategy to help identify
 * what might be causing 404 errors.
 *
 * debug_type values:
 * 1 - Default SDK implementation (current approach)
 * 2 - Direct fetch API with explicit URL (no SDK)
 * 3 - Whisper-1 model fallback (known working model)
 * 4 - gpt-4o-transcribe without diarization
 * 5 - SDK with explicit baseURL override
 * 6 - Direct fetch with FormData (browser-style)
 * 7 - SDK without chunking_strategy
 *
 * Based on research from OpenAI community forums:
 * - https://community.openai.com/t/gpt-4o-transcribe-diarize-returns-chunking-strategy-is-required-any-working-example-or-schema/1364231
 * - https://community.openai.com/t/api-whisper-transcriptions-errors-solved/622843
 * - https://github.com/openai/openai-node/issues/348
 */

import { createReadStream, readFileSync } from "fs";
import { basename } from "path";
import OpenAI from "openai";
import { logger as baseLogger } from "@/lib/logger";

const logger = baseLogger.child({ module: "openai-debug-client" });

// OpenAI API endpoints
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const TRANSCRIPTION_ENDPOINT = `${OPENAI_BASE_URL}/audio/transcriptions`;

// Available models for testing
export const DEBUG_MODELS = {
  DIARIZE: "gpt-4o-transcribe-diarize",
  TRANSCRIBE: "gpt-4o-transcribe",
  WHISPER: "whisper-1",
  MINI_TRANSCRIBE: "gpt-4o-mini-transcribe",
} as const;

/**
 * Debug transcription result
 */
export interface DebugTranscriptionResult {
  success: boolean;
  text?: string;
  segments?: Array<{
    speaker?: string;
    text: string;
    start?: number;
    end?: number;
  }>;
  duration?: number;
  error?: string;
  debugInfo: {
    debugType: number;
    model: string;
    endpoint: string;
    method: string;
    responseStatus?: number;
    responseHeaders?: Record<string, string>;
    requestDetails?: string;
  };
}

/**
 * Debug transcription options
 */
export interface DebugTranscriptionOptions {
  debugType: number;
  apiKey: string;
  filePath: string;
  language?: string;
}

/**
 * Get MIME type for audio file
 */
function getAudioMimeType(filePath: string): string {
  const ext = filePath.toLowerCase().split(".").pop();
  const mimeTypes: Record<string, string> = {
    wav: "audio/wav",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    webm: "audio/webm",
    ogg: "audio/ogg",
    flac: "audio/flac",
    mp4: "audio/mp4",
    mpeg: "audio/mpeg",
    mpga: "audio/mpeg",
  };
  return mimeTypes[ext ?? ""] ?? "audio/mpeg";
}

/**
 * Debug Type 1: Default SDK implementation with diarization
 * Uses OpenAI SDK with createReadStream and all diarization parameters
 */
async function debugType1(options: DebugTranscriptionOptions): Promise<DebugTranscriptionResult> {
  const { apiKey, filePath, language } = options;
  const model = DEBUG_MODELS.DIARIZE;

  logger.info({
    event: "debug_transcribe.type1.start",
    debugType: 1,
    model,
    filePath,
  });

  try {
    const openai = new OpenAI({
      apiKey,
      timeout: 120000,
    });

    // Use type assertion since SDK types don't include diarized_json yet
    const response = await (openai.audio.transcriptions.create as (params: unknown) => Promise<unknown>)({
      file: createReadStream(filePath),
      model,
      response_format: "diarized_json",
      chunking_strategy: "auto",
      ...(language && { language }),
    }) as { text?: string; segments?: Array<{ speaker: string; text: string; start: number; end: number }>; duration?: number };

    logger.info({
      event: "debug_transcribe.type1.success",
      debugType: 1,
      textLength: response.text?.length ?? 0,
      segmentCount: response.segments?.length ?? 0,
    });

    return {
      success: true,
      text: response.text,
      segments: response.segments,
      duration: response.duration,
      debugInfo: {
        debugType: 1,
        model,
        endpoint: "SDK audio.transcriptions.create",
        method: "createReadStream + diarized_json + chunking_strategy",
      },
    };
  } catch (err) {
    const error = err as Error & { status?: number; headers?: Record<string, string> };

    logger.error({
      event: "debug_transcribe.type1.error",
      debugType: 1,
      error: error.message,
      status: error.status,
    });

    return {
      success: false,
      error: error.message,
      debugInfo: {
        debugType: 1,
        model,
        endpoint: "SDK audio.transcriptions.create",
        method: "createReadStream + diarized_json + chunking_strategy",
        responseStatus: error.status,
        requestDetails: `Model: ${model}, response_format: diarized_json, chunking_strategy: auto`,
      },
    };
  }
}

/**
 * Debug Type 2: Direct fetch API with explicit URL
 * Bypasses SDK entirely, uses native fetch with FormData
 */
async function debugType2(options: DebugTranscriptionOptions): Promise<DebugTranscriptionResult> {
  const { apiKey, filePath, language } = options;
  const model = DEBUG_MODELS.DIARIZE;

  logger.info({
    event: "debug_transcribe.type2.start",
    debugType: 2,
    model,
    filePath,
    endpoint: TRANSCRIPTION_ENDPOINT,
  });

  try {
    const fileBuffer = readFileSync(filePath);
    const fileName = basename(filePath);
    const mimeType = getAudioMimeType(filePath);

    // Create form data using Node.js FormData
    const formData = new FormData();
    formData.append("file", new Blob([fileBuffer], { type: mimeType }), fileName);
    formData.append("model", model);
    formData.append("response_format", "diarized_json");
    formData.append("chunking_strategy", "auto");
    if (language) {
      formData.append("language", language);
    }

    const response = await fetch(TRANSCRIPTION_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
      },
      body: formData,
    });

    const responseText = await response.text();

    logger.info({
      event: "debug_transcribe.type2.response",
      debugType: 2,
      status: response.status,
      statusText: response.statusText,
      responseLength: responseText.length,
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${responseText}`,
        debugInfo: {
          debugType: 2,
          model,
          endpoint: TRANSCRIPTION_ENDPOINT,
          method: "Direct fetch with FormData",
          responseStatus: response.status,
          requestDetails: `Direct POST to ${TRANSCRIPTION_ENDPOINT}`,
        },
      };
    }

    const data = JSON.parse(responseText) as { text?: string; segments?: Array<{ speaker: string; text: string; start: number; end: number }>; duration?: number };

    return {
      success: true,
      text: data.text,
      segments: data.segments,
      duration: data.duration,
      debugInfo: {
        debugType: 2,
        model,
        endpoint: TRANSCRIPTION_ENDPOINT,
        method: "Direct fetch with FormData",
        responseStatus: response.status,
      },
    };
  } catch (err) {
    const error = err as Error;

    logger.error({
      event: "debug_transcribe.type2.error",
      debugType: 2,
      error: error.message,
    });

    return {
      success: false,
      error: error.message,
      debugInfo: {
        debugType: 2,
        model,
        endpoint: TRANSCRIPTION_ENDPOINT,
        method: "Direct fetch with FormData",
        requestDetails: `Direct POST to ${TRANSCRIPTION_ENDPOINT}`,
      },
    };
  }
}

/**
 * Debug Type 3: Whisper-1 model fallback
 * Uses known working model to verify API connectivity
 */
async function debugType3(options: DebugTranscriptionOptions): Promise<DebugTranscriptionResult> {
  const { apiKey, filePath, language } = options;
  const model = DEBUG_MODELS.WHISPER;

  logger.info({
    event: "debug_transcribe.type3.start",
    debugType: 3,
    model,
    filePath,
  });

  try {
    const openai = new OpenAI({
      apiKey,
      timeout: 120000,
    });

    const response = await openai.audio.transcriptions.create({
      file: createReadStream(filePath),
      model,
      response_format: "verbose_json",
      ...(language && { language }),
    });

    logger.info({
      event: "debug_transcribe.type3.success",
      debugType: 3,
      textLength: response.text?.length ?? 0,
    });

    return {
      success: true,
      text: response.text,
      segments: response.segments?.map(s => ({
        text: s.text,
        start: s.start,
        end: s.end,
      })),
      duration: response.duration,
      debugInfo: {
        debugType: 3,
        model,
        endpoint: "SDK audio.transcriptions.create",
        method: "Whisper-1 fallback with verbose_json",
      },
    };
  } catch (err) {
    const error = err as Error & { status?: number };

    logger.error({
      event: "debug_transcribe.type3.error",
      debugType: 3,
      error: error.message,
      status: error.status,
    });

    return {
      success: false,
      error: error.message,
      debugInfo: {
        debugType: 3,
        model,
        endpoint: "SDK audio.transcriptions.create",
        method: "Whisper-1 fallback with verbose_json",
        responseStatus: error.status,
      },
    };
  }
}

/**
 * Debug Type 4: gpt-4o-transcribe without diarization
 * Uses transcribe model but without diarization features
 */
async function debugType4(options: DebugTranscriptionOptions): Promise<DebugTranscriptionResult> {
  const { apiKey, filePath, language } = options;
  const model = DEBUG_MODELS.TRANSCRIBE;

  logger.info({
    event: "debug_transcribe.type4.start",
    debugType: 4,
    model,
    filePath,
  });

  try {
    const openai = new OpenAI({
      apiKey,
      timeout: 120000,
    });

    // gpt-4o-transcribe only supports json response format
    const response = await openai.audio.transcriptions.create({
      file: createReadStream(filePath),
      model,
      response_format: "json",
      ...(language && { language }),
    });

    logger.info({
      event: "debug_transcribe.type4.success",
      debugType: 4,
      textLength: response.text?.length ?? 0,
    });

    return {
      success: true,
      text: response.text,
      debugInfo: {
        debugType: 4,
        model,
        endpoint: "SDK audio.transcriptions.create",
        method: "gpt-4o-transcribe with json format (no diarization)",
      },
    };
  } catch (err) {
    const error = err as Error & { status?: number };

    logger.error({
      event: "debug_transcribe.type4.error",
      debugType: 4,
      error: error.message,
      status: error.status,
    });

    return {
      success: false,
      error: error.message,
      debugInfo: {
        debugType: 4,
        model,
        endpoint: "SDK audio.transcriptions.create",
        method: "gpt-4o-transcribe with json format (no diarization)",
        responseStatus: error.status,
      },
    };
  }
}

/**
 * Debug Type 5: SDK with explicit baseURL override
 * Forces the correct base URL to rule out URL construction issues
 */
async function debugType5(options: DebugTranscriptionOptions): Promise<DebugTranscriptionResult> {
  const { apiKey, filePath, language } = options;
  const model = DEBUG_MODELS.DIARIZE;

  logger.info({
    event: "debug_transcribe.type5.start",
    debugType: 5,
    model,
    filePath,
    baseURL: OPENAI_BASE_URL,
  });

  try {
    const openai = new OpenAI({
      apiKey,
      baseURL: OPENAI_BASE_URL,
      timeout: 120000,
    });

    const response = await (openai.audio.transcriptions.create as (params: unknown) => Promise<unknown>)({
      file: createReadStream(filePath),
      model,
      response_format: "diarized_json",
      chunking_strategy: "auto",
      ...(language && { language }),
    }) as { text?: string; segments?: Array<{ speaker: string; text: string; start: number; end: number }>; duration?: number };

    logger.info({
      event: "debug_transcribe.type5.success",
      debugType: 5,
      textLength: response.text?.length ?? 0,
      segmentCount: response.segments?.length ?? 0,
    });

    return {
      success: true,
      text: response.text,
      segments: response.segments,
      duration: response.duration,
      debugInfo: {
        debugType: 5,
        model,
        endpoint: "SDK with explicit baseURL",
        method: `baseURL: ${OPENAI_BASE_URL}`,
      },
    };
  } catch (err) {
    const error = err as Error & { status?: number };

    logger.error({
      event: "debug_transcribe.type5.error",
      debugType: 5,
      error: error.message,
      status: error.status,
    });

    return {
      success: false,
      error: error.message,
      debugInfo: {
        debugType: 5,
        model,
        endpoint: "SDK with explicit baseURL",
        method: `baseURL: ${OPENAI_BASE_URL}`,
        responseStatus: error.status,
      },
    };
  }
}

/**
 * Debug Type 6: Direct fetch with multipart boundary
 * Manual multipart form construction for maximum control
 */
async function debugType6(options: DebugTranscriptionOptions): Promise<DebugTranscriptionResult> {
  const { apiKey, filePath, language } = options;
  const model = DEBUG_MODELS.DIARIZE;

  logger.info({
    event: "debug_transcribe.type6.start",
    debugType: 6,
    model,
    filePath,
  });

  try {
    const fileBuffer = readFileSync(filePath);
    const fileName = basename(filePath);
    const mimeType = getAudioMimeType(filePath);
    const boundary = `----WebKitFormBoundary${Date.now().toString(16)}`;

    // Manually construct multipart form data
    const parts: string[] = [];

    // File part
    parts.push(`--${boundary}`);
    parts.push(`Content-Disposition: form-data; name="file"; filename="${fileName}"`);
    parts.push(`Content-Type: ${mimeType}`);
    parts.push("");

    // Model part
    const modelPart = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="model"`,
      "",
      model,
    ].join("\r\n");

    // Response format part
    const formatPart = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="response_format"`,
      "",
      "diarized_json",
    ].join("\r\n");

    // Chunking strategy part
    const chunkingPart = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="chunking_strategy"`,
      "",
      "auto",
    ].join("\r\n");

    // Language part (optional)
    const languagePart = language ? [
      `--${boundary}`,
      `Content-Disposition: form-data; name="language"`,
      "",
      language,
    ].join("\r\n") : "";

    // Combine all parts
    const header = parts.join("\r\n") + "\r\n";
    const headerBuffer = Buffer.from(header);
    const footer = Buffer.from(`\r\n${modelPart}\r\n${formatPart}\r\n${chunkingPart}${languagePart ? "\r\n" + languagePart : ""}\r\n--${boundary}--\r\n`);

    const body = Buffer.concat([headerBuffer, fileBuffer, footer]);

    const response = await fetch(TRANSCRIPTION_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    const responseText = await response.text();

    logger.info({
      event: "debug_transcribe.type6.response",
      debugType: 6,
      status: response.status,
      responseLength: responseText.length,
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${responseText}`,
        debugInfo: {
          debugType: 6,
          model,
          endpoint: TRANSCRIPTION_ENDPOINT,
          method: "Manual multipart form construction",
          responseStatus: response.status,
        },
      };
    }

    const data = JSON.parse(responseText) as { text?: string; segments?: Array<{ speaker: string; text: string; start: number; end: number }>; duration?: number };

    return {
      success: true,
      text: data.text,
      segments: data.segments,
      duration: data.duration,
      debugInfo: {
        debugType: 6,
        model,
        endpoint: TRANSCRIPTION_ENDPOINT,
        method: "Manual multipart form construction",
        responseStatus: response.status,
      },
    };
  } catch (err) {
    const error = err as Error;

    logger.error({
      event: "debug_transcribe.type6.error",
      debugType: 6,
      error: error.message,
    });

    return {
      success: false,
      error: error.message,
      debugInfo: {
        debugType: 6,
        model,
        endpoint: TRANSCRIPTION_ENDPOINT,
        method: "Manual multipart form construction",
      },
    };
  }
}

/**
 * Debug Type 7: SDK without chunking_strategy
 * Tests if chunking_strategy is causing the issue
 */
async function debugType7(options: DebugTranscriptionOptions): Promise<DebugTranscriptionResult> {
  const { apiKey, filePath, language } = options;
  const model = DEBUG_MODELS.DIARIZE;

  logger.info({
    event: "debug_transcribe.type7.start",
    debugType: 7,
    model,
    filePath,
  });

  try {
    const openai = new OpenAI({
      apiKey,
      timeout: 120000,
    });

    // Try without chunking_strategy to see if that's the issue
    const response = await (openai.audio.transcriptions.create as (params: unknown) => Promise<unknown>)({
      file: createReadStream(filePath),
      model,
      response_format: "json", // Try json instead of diarized_json
      ...(language && { language }),
    }) as { text?: string; segments?: Array<{ speaker: string; text: string; start: number; end: number }>; duration?: number };

    logger.info({
      event: "debug_transcribe.type7.success",
      debugType: 7,
      textLength: response.text?.length ?? 0,
    });

    return {
      success: true,
      text: response.text,
      segments: response.segments,
      duration: response.duration,
      debugInfo: {
        debugType: 7,
        model,
        endpoint: "SDK audio.transcriptions.create",
        method: "diarize model with json format (no chunking_strategy)",
      },
    };
  } catch (err) {
    const error = err as Error & { status?: number };

    logger.error({
      event: "debug_transcribe.type7.error",
      debugType: 7,
      error: error.message,
      status: error.status,
    });

    return {
      success: false,
      error: error.message,
      debugInfo: {
        debugType: 7,
        model,
        endpoint: "SDK audio.transcriptions.create",
        method: "diarize model with json format (no chunking_strategy)",
        responseStatus: error.status,
      },
    };
  }
}

/**
 * Main debug transcription function
 * Routes to appropriate implementation based on debug_type
 */
export async function debugTranscribe(options: DebugTranscriptionOptions): Promise<DebugTranscriptionResult> {
  const { debugType } = options;

  logger.info({
    event: "debug_transcribe.dispatch",
    debugType,
    filePath: options.filePath,
  });

  switch (debugType) {
    case 1:
      return debugType1(options);
    case 2:
      return debugType2(options);
    case 3:
      return debugType3(options);
    case 4:
      return debugType4(options);
    case 5:
      return debugType5(options);
    case 6:
      return debugType6(options);
    case 7:
      return debugType7(options);
    default:
      // Default to type 1 if unknown debug type
      logger.warn({
        event: "debug_transcribe.unknown_type",
        debugType,
        fallback: 1,
      });
      return debugType1(options);
  }
}

/**
 * Get description of what each debug type tests
 */
export function getDebugTypeDescription(debugType: number): string {
  const descriptions: Record<number, string> = {
    1: "Default SDK with diarized_json and chunking_strategy=auto",
    2: "Direct fetch API to exact endpoint URL (bypasses SDK)",
    3: "Whisper-1 model fallback (known working model)",
    4: "gpt-4o-transcribe without diarization features",
    5: "SDK with explicit baseURL override",
    6: "Manual multipart form construction (maximum control)",
    7: "Diarize model with json format (no chunking_strategy)",
  };
  return descriptions[debugType] ?? "Unknown debug type";
}

/**
 * Get all available debug types
 */
export function getAvailableDebugTypes(): Array<{ type: number; description: string }> {
  return [
    { type: 1, description: getDebugTypeDescription(1) },
    { type: 2, description: getDebugTypeDescription(2) },
    { type: 3, description: getDebugTypeDescription(3) },
    { type: 4, description: getDebugTypeDescription(4) },
    { type: 5, description: getDebugTypeDescription(5) },
    { type: 6, description: getDebugTypeDescription(6) },
    { type: 7, description: getDebugTypeDescription(7) },
  ];
}
