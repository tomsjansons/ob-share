/**
 * AI Extraction Tools - Tools for extracting information from media files
 *
 * These tools use AI models to extract structured information from
 * audio, video, images, and URLs.
 */

import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import OpenAI from "openai";
import { defineTool } from "../steps/tool-step";
import type { ToolResult } from "../types";
import { logger as baseLogger } from "@/lib/logger";
import { OpenAIClient, isValidApiKey, DEFAULT_AUDIO_MODEL } from "@/server/openai";
import { convertAndValidateAudio, type AudioConversionResult } from "@/server/audio";
import { getBrowserService } from "@/server/browser";

const logger = baseLogger.child({ module: "ai-extraction-tools" });

// Schemas for extraction results

export const AudioExtractionResultSchema = z.object({
  speakers: z.array(z.object({
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
  })),
  transcription: z.array(z.object({
    speaker: z.string().optional(),
    text: z.string(),
    timestamp: z.string().optional(),
  })),
  summary: z.string(),
  intentions: z.array(z.string()),
  backgroundNoises: z.array(z.string()),
  mood: z.string().optional(),
  language: z.string().optional(),
  // Audio conversion info
  wavFilePath: z.string().optional(),
  wasConverted: z.boolean().optional(),
  conversionValid: z.boolean().optional(),
  conversionError: z.string().optional(),
});

export const VideoExtractionResultSchema = z.object({
  // Audio components
  speakers: z.array(z.object({
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
  })),
  transcription: z.array(z.object({
    speaker: z.string().optional(),
    text: z.string(),
    timestamp: z.string().optional(),
  })),
  // Visual components
  scenes: z.array(z.object({
    timestamp: z.string().optional(),
    description: z.string(),
    location: z.string().optional(),
    actions: z.array(z.string()),
    objects: z.array(z.string()),
  })),
  visibleTexts: z.array(z.object({
    text: z.string(),
    source: z.string(), // e.g., "billboard", "sign", "screen", "document"
    timestamp: z.string().optional(),
  })),
  summary: z.string(),
  intentions: z.array(z.string()),
  backgroundNoises: z.array(z.string()),
  mood: z.string().optional(),
  language: z.string().optional(),
});

export const ImageExtractionResultSchema = z.object({
  description: z.string(),
  objects: z.array(z.string()),
  people: z.array(z.object({
    description: z.string(),
    action: z.string().optional(),
  })),
  visibleTexts: z.array(z.object({
    text: z.string(),
    source: z.string(), // e.g., "sign", "document", "screen", "label"
  })),
  diagrams: z.array(z.object({
    type: z.string(), // e.g., "flowchart", "graph", "technical diagram"
    description: z.string(),
    elements: z.array(z.string()),
  })),
  location: z.object({
    description: z.string().optional(),
    type: z.string().optional(), // e.g., "indoor", "outdoor", "urban", "nature"
    landmarks: z.array(z.string()),
  }).optional(),
  technicalInfo: z.object({
    type: z.string().optional(), // e.g., "screenshot", "code", "schematic"
    details: z.string().optional(),
  }).optional(),
  mood: z.string().optional(),
  colors: z.array(z.string()),
});

export const UrlExtractionResultSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  mainContent: z.string(),
  summary: z.string(),
  keyPoints: z.array(z.string()),
  type: z.string(), // e.g., "article", "documentation", "product page", "social media"
  author: z.string().optional(),
  publishDate: z.string().optional(),
  images: z.array(z.object({
    src: z.string(),
    alt: z.string().optional(),
  })),
  links: z.array(z.object({
    text: z.string(),
    url: z.string(),
  })),
});

export const DocumentExtractionResultSchema = z.object({
  title: z.string().optional(),
  author: z.string().optional(),
  pageCount: z.number().optional(),
  extractedText: z.string(),
  summary: z.string(),
  keyPoints: z.array(z.string()),
  sections: z.array(z.object({
    title: z.string().optional(),
    content: z.string(),
  })),
  documentType: z.string(), // e.g., "pdf", "word document", "text file", "report", "manual"
  language: z.string().optional(),
  topics: z.array(z.string()),
});

export type AudioExtractionResult = z.infer<typeof AudioExtractionResultSchema>;
export type VideoExtractionResult = z.infer<typeof VideoExtractionResultSchema>;
export type ImageExtractionResult = z.infer<typeof ImageExtractionResultSchema>;
export type UrlExtractionResult = z.infer<typeof UrlExtractionResultSchema>;
export type DocumentExtractionResult = z.infer<typeof DocumentExtractionResultSchema>;

/**
 * Extract information from audio files using whisper-1 model
 * Uses the OpenAI audio transcriptions endpoint with verbose_json format
 */
export const extractAudioTool = defineTool({
  name: "extract-audio",
  description: "Extract transcription and structured information from an audio file using whisper-1.",
  category: "ai-extraction",
  parameters: [
    {
      name: "filePath",
      type: "string",
      description: "Path to the audio file (supports webm, mp3, wav, ogg, flac, mp4, mpeg, m4a)",
      required: true,
    },
    {
      name: "openaiApiKey",
      type: "string",
      description: "OpenAI API key for audio transcription",
      required: false,
    },
  ],
  inputSchema: z.object({
    filePath: z.string(),
    openaiApiKey: z.string().optional(),
  }),
  outputSchema: AudioExtractionResultSchema,
  execute: async (input, context): Promise<ToolResult<AudioExtractionResult>> => {
    let audioFileSize: number | null = null;
    let conversionResult: AudioConversionResult | null = null;

    try {
      context.logger.info("Extracting audio content", { filePath: input.filePath });

      // Get API key from input or environment
      const apiKey = input.openaiApiKey ?? process.env.OPENAI_API_KEY;
      // Always use whisper-1 for audio transcription - it's the only model that works
      // with the standard transcriptions endpoint (gpt-4o-transcribe-diarize requires different API)
      const model = DEFAULT_AUDIO_MODEL;

      if (!isValidApiKey(apiKey)) {
        logger.warn({
          event: "audio_extraction.no_api_key",
          filePath: input.filePath,
        });

        return {
          success: false,
          error: "OpenAI API key not configured. Please add your API key in Settings.",
        };
      }

      // Check file size
      const fileStats = await fs.stat(input.filePath);
      audioFileSize = fileStats.size;

      const originalExt = path.extname(input.filePath).toLowerCase();

      // Validate file format - the transcriptions endpoint supports these formats:
      // flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, or webm
      const supportedFormats = [".flac", ".mp3", ".mp4", ".mpeg", ".mpga", ".m4a", ".ogg", ".wav", ".webm"];
      if (!supportedFormats.includes(originalExt)) {
        return {
          success: false,
          error: `Unsupported audio format: ${originalExt}. Supported formats: ${supportedFormats.join(", ")}`,
        };
      }

      // TESTING: Skip audio conversion to test if webm files work directly with OpenAI API
      // The OpenAI transcriptions endpoint claims to support webm format natively
      // TODO: Remove this comment block and restore conversion if webm doesn't work
      /*
      // Convert audio to WAV if needed (webm, ogg, m4a, opus, flac -> wav)
      // Native formats (wav, mp3) will not be converted
      // The conversion also validates duration and saves the WAV file to vault
      conversionResult = await convertAndValidateAudio(input.filePath);

      if (conversionResult.wasConverted) {
        logger.info({
          event: "audio_extraction.converted_to_wav",
          originalPath: input.filePath,
          convertedPath: conversionResult.vaultWavPath,
          originalFormat: originalExt,
          durationValid: conversionResult.durationValid,
          originalDuration: conversionResult.originalDuration,
          convertedDuration: conversionResult.convertedDuration,
        });
      }

      // Log if duration validation failed but proceed with transcription anyway
      // (validation is known to be unreliable for some formats)
      if (conversionResult.wasConverted && !conversionResult.durationValid) {
        logger.info({
          event: "audio_extraction.duration_validation_skipped",
          filePath: input.filePath,
          vaultWavPath: conversionResult.vaultWavPath,
          note: "Proceeding with transcription despite validation warning",
          validationWarning: conversionResult.validationError,
        });
      }
      */

      // TESTING: Use original file directly without conversion
      conversionResult = {
        wasConverted: false,
        transcriptionFilePath: input.filePath,
        durationValid: true,
      };

      logger.info({
        event: "audio_extraction.testing_webm_direct",
        filePath: input.filePath,
        format: originalExt,
        note: "Testing webm transcription without conversion to WAV",
      });

      // Use OpenAI client for transcription with whisper-1
      const openai = new OpenAIClient({ apiKey });

      logger.info({
        event: "audio_extraction.calling_transcribe",
        filePath: conversionResult.transcriptionFilePath,
        originalFilePath: input.filePath,
        model,
        fileSize: audioFileSize,
        format: conversionResult.wasConverted ? ".wav" : originalExt,
        wasConverted: conversionResult.wasConverted,
      });

      // Use the transcription endpoint with whisper-1 and verbose_json
      const response = await openai.transcribe(conversionResult.transcriptionFilePath, {
        model,
      });

      logger.info({
        event: "audio_extraction.response_received",
        filePath: input.filePath,
        duration: response.duration,
        segmentCount: response.segments?.length ?? 0,
        textLength: response.text?.length ?? 0,
      });

      // Build transcription array from segments (whisper-1 doesn't have speaker info)
      const transcription = (response.segments || []).map((segment) => ({
        text: segment.text,
        timestamp: `${segment.start.toFixed(1)}s - ${segment.end.toFixed(1)}s`,
      }));

      // Build the result with WAV file info
      const analysisResult: AudioExtractionResult = {
        speakers: [], // whisper-1 doesn't provide speaker diarization
        transcription,
        summary: response.text || "",
        intentions: [],
        backgroundNoises: [],
        language: undefined,
        mood: undefined,
        // Include WAV file info for MD attachment
        wavFilePath: conversionResult.vaultWavPath,
        wasConverted: conversionResult.wasConverted,
        conversionValid: conversionResult.durationValid,
      };

      logger.info({
        event: "audio_extraction.complete",
        filePath: input.filePath,
        transcriptionSegments: transcription.length,
        duration: response.duration,
        wavFilePath: conversionResult.vaultWavPath,
      });

      return {
        success: true,
        output: analysisResult,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      const originalExt = path.extname(input.filePath).toLowerCase();

      logger.error({
        event: "audio_extraction.error",
        filePath: input.filePath,
        error: errorMsg,
        stack: errorStack,
        fileSize: audioFileSize,
        vaultWavPath: conversionResult?.vaultWavPath,
      });

      // Build detailed error message
      const errorLines = [
        `**Audio Extraction Error**`,
        ``,
        `**Error:** ${errorMsg}`,
        ``,
        `**Input File:** \`${input.filePath}\``,
        `**Format:** ${originalExt}`,
        audioFileSize ? `**File Size:** ${Math.round(audioFileSize / 1024)} KB` : `**File Size:** unknown`,
      ];

      // Include WAV file info if available
      if (conversionResult?.vaultWavPath) {
        errorLines.push(`**WAV File:** \`${path.basename(conversionResult.vaultWavPath)}\``);
      }

      return {
        success: false,
        error: `Failed to extract audio:\n\n${errorLines.join("\n")}`,
        // Include partial output with WAV file info if conversion happened
        output: conversionResult?.wasConverted ? {
          speakers: [],
          transcription: [],
          summary: "",
          intentions: [],
          backgroundNoises: [],
          wavFilePath: conversionResult.vaultWavPath,
          wasConverted: true,
          conversionValid: conversionResult.durationValid,
          conversionError: errorMsg,
        } : undefined,
      };
    }
  },
});

/**
 * Extract information from video files
 */
export const extractVideoTool = defineTool({
  name: "extract-video",
  description: "Extract audio content and visual information from a video file",
  category: "ai-extraction",
  parameters: [
    {
      name: "filePath",
      type: "string",
      description: "Path to the video file",
      required: true,
    },
  ],
  inputSchema: z.object({
    filePath: z.string(),
  }),
  outputSchema: VideoExtractionResultSchema,
  execute: async (input, context): Promise<ToolResult<VideoExtractionResult>> => {
    try {
      context.logger.info("Extracting video content", { filePath: input.filePath });

      // Video extraction requires frame extraction and audio extraction
      // This is a complex process - for now, we provide a structured placeholder
      logger.info({
        event: "video_extraction.processing",
        filePath: input.filePath,
      });

      // Return placeholder with instructions for manual processing
      return {
        success: true,
        output: {
          speakers: [],
          transcription: [{
            text: "[Video file requires external processing for full extraction]",
          }],
          scenes: [{
            description: "Video file detected. Full scene analysis requires frame extraction capabilities.",
            actions: [],
            objects: [],
          }],
          visibleTexts: [],
          summary: "Video file detected. Configure video processing capabilities for full extraction.",
          intentions: [],
          backgroundNoises: [],
          language: "unknown",
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to extract video: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

/**
 * Get MIME type for image files
 */
function getImageMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  return mimeTypes[ext] ?? "image/jpeg";
}

/**
 * Extract information from image files using OpenAI's vision capabilities
 * Supports OCR/text recognition, diagram analysis, and visual understanding
 */
export const extractImageTool = defineTool({
  name: "extract-image",
  description: "Extract visual information, text (OCR), diagrams, and descriptions from an image file using OpenAI vision",
  category: "ai-extraction",
  parameters: [
    {
      name: "filePath",
      type: "string",
      description: "Path to the image file",
      required: true,
    },
    {
      name: "openaiApiKey",
      type: "string",
      description: "OpenAI API key for image analysis",
      required: false,
    },
    {
      name: "openaiModel",
      type: "string",
      description: "OpenAI model to use (default: gpt-4o)",
      required: false,
    },
  ],
  inputSchema: z.object({
    filePath: z.string(),
    openaiApiKey: z.string().optional(),
    openaiModel: z.string().optional(),
  }),
  outputSchema: ImageExtractionResultSchema,
  execute: async (input, context): Promise<ToolResult<ImageExtractionResult>> => {
    try {
      context.logger.info("Extracting image content", { filePath: input.filePath });

      // Get API key from input or environment
      const apiKey = input.openaiApiKey ?? process.env.OPENAI_API_KEY;
      const model = input.openaiModel ?? "gpt-4o";

      if (!isValidApiKey(apiKey)) {
        logger.warn({
          event: "image_extraction.no_api_key",
          filePath: input.filePath,
        });

        return {
          success: false,
          error: "OpenAI API key not configured. Please add your API key in Settings.",
        };
      }

      // Check file extension
      const ext = path.extname(input.filePath).toLowerCase();
      const supportedExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

      if (!supportedExtensions.includes(ext)) {
        return {
          success: false,
          error: `Unsupported image type: ${ext}. Supported: ${supportedExtensions.join(", ")}`,
        };
      }

      // Read image file and encode as base64
      const fileBuffer = await fs.readFile(input.filePath);
      const base64Data = fileBuffer.toString("base64");
      const mimeType = getImageMimeType(input.filePath);

      logger.info({
        event: "image_extraction.calling_api",
        filePath: input.filePath,
        model,
        fileSize: fileBuffer.length,
      });

      // Create OpenAI client
      const openai = new OpenAI({ apiKey });

      const prompt = `Analyze this image thoroughly and extract all relevant information. Pay special attention to ANY text visible in the image - perform careful OCR on all text including:
- Signs, labels, and banners
- Text on screens, documents, or papers
- Handwritten text
- Text on products, packaging, or clothing
- Watermarks or logos with text
- Any other readable text, no matter how small

Provide a comprehensive analysis including:

1. Overall description of what the image shows
2. List all objects visible in the image
3. Describe any people visible (without identifying specific individuals) and their actions
4. Extract ALL visible text with EXACT wording - be extremely thorough with OCR
5. Identify any diagrams, charts, or technical drawings and describe their content
6. Describe the location/setting if determinable
7. Note any technical information (if this is a screenshot, code, schematic, etc.)
8. Describe the overall mood or atmosphere
9. List the dominant colors

Respond in JSON format matching this schema:
{
  "description": "string - overall description",
  "objects": ["string - list of objects"],
  "people": [{"description": "string", "action": "string (optional)"}],
  "visibleTexts": [{"text": "string - exact text visible (be thorough!)", "source": "string - where the text appears (sign, document, screen, label, etc.)"}],
  "diagrams": [{"type": "string - type of diagram", "description": "string", "elements": ["string"]}],
  "location": {"description": "string (optional)", "type": "string (optional)", "landmarks": ["string"]},
  "technicalInfo": {"type": "string (optional)", "details": "string (optional)"},
  "mood": "string (optional)",
  "colors": ["string - dominant colors"]
}`;

      // Use the Responses API with input_image type for vision
      const response = await openai.responses.create({
        model,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_image",
                image_url: `data:${mimeType};base64,${base64Data}`,
                detail: "high", // Use high detail for better OCR
              },
              {
                type: "input_text",
                text: prompt,
              },
            ],
          },
        ],
      });

      const content = response.output_text;

      logger.info({
        event: "image_extraction.response_received",
        filePath: input.filePath,
        responseLength: content?.length ?? 0,
      });

      // Parse the JSON response
      try {
        const jsonMatch = content?.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]) as ImageExtractionResult;

          logger.info({
            event: "image_extraction.complete",
            filePath: input.filePath,
            hasDescription: !!result.description,
            visibleTextsCount: result.visibleTexts?.length ?? 0,
            objectsCount: result.objects?.length ?? 0,
          });

          return {
            success: true,
            output: result,
          };
        }
        throw new Error("No JSON found in response");
      } catch (parseErr) {
        logger.warn({
          event: "image_extraction.parse_failed",
          filePath: input.filePath,
          error: parseErr instanceof Error ? parseErr.message : String(parseErr),
        });

        // Return a basic result if parsing fails
        return {
          success: true,
          output: {
            description: content?.slice(0, 500) ?? "",
            objects: [],
            people: [],
            visibleTexts: [],
            diagrams: [],
            colors: [],
          },
        };
      }
    } catch (err) {
      logger.error({
        event: "image_extraction.error",
        filePath: input.filePath,
        error: err instanceof Error ? err.message : String(err),
      });

      return {
        success: false,
        error: `Failed to extract image: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

/**
 * Text LLM provider type
 */
type TextLlmProvider = "anthropic" | "openai";

/**
 * Call the configured text LLM for URL analysis
 */
async function callTextLlm(
  prompt: string,
  provider: TextLlmProvider,
  apiKey: string,
  model: string
): Promise<string> {
  if (provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${errorBody}`);
    }

    const data = await response.json();
    return data.content?.[0]?.text || "";
  } else if (provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorBody}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  }

  throw new Error(`Unsupported text LLM provider: ${provider}`);
}

/**
 * Extract information from URLs using headless Chromium
 * Falls back to simple fetch if browser is unavailable
 *
 * Uses headless Chromium by default which:
 * - Renders JavaScript (handles SPAs)
 * - Uses cookies from UI Chromium sessions (handles authenticated content)
 * - Waits for network idle before extracting content
 */
export const extractUrlTool = defineTool({
  name: "extract-url",
  description: "Fetch and extract information from a URL using headless browser (handles SPAs and authenticated content)",
  category: "ai-extraction",
  parameters: [
    {
      name: "url",
      type: "string",
      description: "The URL to fetch and extract information from",
      required: true,
    },
    {
      name: "textLlmProvider",
      type: "string",
      description: "Text LLM provider (anthropic or openai)",
      required: false,
    },
    {
      name: "textLlmApiKey",
      type: "string",
      description: "API key for the text LLM provider",
      required: false,
    },
    {
      name: "textLlmModel",
      type: "string",
      description: "Model to use for text analysis",
      required: false,
    },
    {
      name: "useHeadlessBrowser",
      type: "boolean",
      description: "Use headless Chromium for JavaScript rendering (default: true)",
      required: false,
    },
    {
      name: "waitForSelector",
      type: "string",
      description: "CSS selector to wait for before extracting content",
      required: false,
    },
    {
      name: "timeout",
      type: "number",
      description: "Timeout in milliseconds (default: 30000)",
      required: false,
    },
  ],
  inputSchema: z.object({
    url: z.string(),
    textLlmProvider: z.enum(["anthropic", "openai"]).optional(),
    textLlmApiKey: z.string().optional(),
    textLlmModel: z.string().optional(),
    useHeadlessBrowser: z.boolean().default(true),
    waitForSelector: z.string().optional(),
    timeout: z.number().default(30000),
  }),
  outputSchema: UrlExtractionResultSchema,
  execute: async (input, context): Promise<ToolResult<UrlExtractionResult>> => {
    const useHeadlessBrowser = input.useHeadlessBrowser ?? true;

    try {
      context.logger.info("Extracting URL content", {
        url: input.url,
        provider: input.textLlmProvider ?? "anthropic (default)",
        useHeadlessBrowser,
      });

      let html: string;
      let fetchMethod: "browser" | "fetch" = "fetch";
      let isAuthenticated = false;

      // Try headless browser first if enabled
      if (useHeadlessBrowser) {
        try {
          const browserService = getBrowserService();
          const result = await browserService.fetchPage(input.url, {
            waitForSelector: input.waitForSelector,
            waitForNetworkIdle: true,
            timeout: input.timeout ?? 30000,
          });

          if (result.success) {
            html = result.html;
            fetchMethod = "browser";
            isAuthenticated = result.isAuthenticated;

            logger.info({
              event: "url_extraction.browser_success",
              url: input.url,
              finalUrl: result.finalUrl,
              isAuthenticated,
              htmlLength: html.length,
            });
          } else {
            // Browser failed, fall back to fetch
            logger.warn({
              event: "url_extraction.browser_failed",
              url: input.url,
              error: result.error,
            });
            throw new Error(result.error ?? "Browser fetch failed");
          }
        } catch (browserError) {
          // Browser not available or failed, fall back to simple fetch
          logger.info({
            event: "url_extraction.browser_fallback",
            url: input.url,
            error: browserError instanceof Error ? browserError.message : String(browserError),
          });

          // Fall through to simple fetch
          const response = await fetch(input.url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; ob-share/1.0; +https://github.com/ob-share)",
            },
          });

          if (response.status === 401 || response.status === 403) {
            logger.info({
              event: "url_extraction.auth_error",
              url: input.url,
              status: response.status,
              statusText: response.statusText,
            });

            return {
              success: true,
              output: {
                url: input.url,
                title: "Content Behind Authentication Wall",
                description: `This URL requires authentication (HTTP ${response.status})`,
                mainContent: `This content is behind an authentication wall and cannot be accessed automatically.\n\nURL: ${input.url}\nStatus: ${response.status} ${response.statusText}\n\nTo access this content:\n1. Connect to VNC (port 5900)\n2. Open Chromium browser and log into the website\n3. Try sharing the URL again - your session cookies will be used`,
                summary: `Content requires authentication (HTTP ${response.status}). Log in via VNC to enable access.`,
                keyPoints: [
                  `Authentication required (HTTP ${response.status})`,
                  "Log into the website via VNC to enable authenticated fetching",
                ],
                type: "authentication-required",
                images: [],
                links: [],
              },
            };
          }

          if (!response.ok) {
            throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
          }

          html = await response.text();
        }
      } else {
        // Simple fetch without browser
        const response = await fetch(input.url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; ob-share/1.0; +https://github.com/ob-share)",
          },
        });

        if (response.status === 401 || response.status === 403) {
          return {
            success: true,
            output: {
              url: input.url,
              title: "Content Behind Authentication Wall",
              description: `This URL requires authentication (HTTP ${response.status})`,
              mainContent: `This content is behind an authentication wall.\n\nURL: ${input.url}\nStatus: ${response.status} ${response.statusText}\n\nTry enabling headless browser mode to use saved sessions.`,
              summary: `Content requires authentication (HTTP ${response.status}).`,
              keyPoints: [`Authentication required (HTTP ${response.status})`],
              type: "authentication-required",
              images: [],
              links: [],
            },
          };
        }

        if (!response.ok) {
          throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
        }

        html = await response.text();
      }

      // Determine which provider and API key to use
      const provider: TextLlmProvider = input.textLlmProvider ?? "anthropic";
      let apiKey = input.textLlmApiKey;
      let model = input.textLlmModel;

      // Fall back to environment variables if no user settings provided
      if (!apiKey) {
        if (provider === "anthropic") {
          apiKey = process.env.ANTHROPIC_API_KEY;
          model = model ?? "claude-sonnet-4-20250514";
        } else if (provider === "openai") {
          apiKey = process.env.OPENAI_API_KEY;
          model = model ?? "gpt-4o";
        }
      }

      // Set default models if not specified
      if (!model) {
        model = provider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o";
      }

      if (!apiKey) {
        // Basic extraction without AI
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);

        logger.warn({
          event: "url_extraction.no_api_key",
          url: input.url,
          provider,
          fetchMethod,
        });

        return {
          success: true,
          output: {
            url: input.url,
            title: titleMatch?.[1]?.trim(),
            description: descMatch?.[1]?.trim(),
            mainContent: `[Configure ${provider.toUpperCase()} API key for full content extraction]\n\nFetched via: ${fetchMethod}${isAuthenticated ? " (authenticated)" : ""}`,
            summary: "URL fetched successfully. Configure AI API key in Settings for full extraction.",
            keyPoints: [],
            type: "webpage",
            images: [],
            links: [],
          },
        };
      }

      logger.info({
        event: "url_extraction.using_llm",
        url: input.url,
        provider,
        model,
        fetchMethod,
        isAuthenticated,
      });

      const analysisPrompt = `Analyze the following HTML content from ${input.url} and extract structured information:

HTML Content (first 50000 chars):
${html.slice(0, 50000)}

Please extract:
1. The page title
2. Meta description
3. Main content (cleaned text, without HTML tags)
4. A concise summary
5. Key points or takeaways
6. Type of page (article, documentation, product page, social media, etc.)
7. Author if available
8. Publish date if available
9. Important images (src and alt text)
10. Important links (text and URL)

Respond in JSON format matching this schema:
{
  "url": "string",
  "title": "string (optional)",
  "description": "string (optional)",
  "mainContent": "string - cleaned main content",
  "summary": "string - concise summary",
  "keyPoints": ["string - key points"],
  "type": "string - type of page",
  "author": "string (optional)",
  "publishDate": "string (optional)",
  "images": [{"src": "string", "alt": "string (optional)"}],
  "links": [{"text": "string", "url": "string"}]
}`;

      const content = await callTextLlm(analysisPrompt, provider, apiKey, model);

      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]) as UrlExtractionResult;
          result.url = input.url; // Ensure URL is set
          return {
            success: true,
            output: result,
          };
        }
        throw new Error("No JSON found in response");
      } catch {
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        return {
          success: true,
          output: {
            url: input.url,
            title: titleMatch?.[1]?.trim(),
            mainContent: content.slice(0, 1000),
            summary: "Content extracted but parsing failed",
            keyPoints: [],
            type: "webpage",
            images: [],
            links: [],
          },
        };
      }
    } catch (err) {
      return {
        success: false,
        error: `Failed to extract URL: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

/**
 * Get MIME type for document files
 */
function getDocumentMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".csv": "text/csv",
    ".rtf": "application/rtf",
    ".odt": "application/vnd.oasis.opendocument.text",
    ".rst": "text/x-rst",
  };
  return mimeTypes[ext] ?? "application/octet-stream";
}

/**
 * Extract information from document files using OpenAI's file input capabilities
 * Supports PDF, DOC, DOCX, TXT, and other document formats via GPT-4o/GPT-5 vision
 */
export const extractDocumentTool = defineTool({
  name: "extract-document",
  description: "Extract text, structure, and metadata from document files (PDF, DOC, DOCX, TXT) using OpenAI's document understanding",
  category: "ai-extraction",
  parameters: [
    {
      name: "filePath",
      type: "string",
      description: "Path to the document file",
      required: true,
    },
    {
      name: "openaiApiKey",
      type: "string",
      description: "OpenAI API key for document analysis",
      required: false,
    },
    {
      name: "openaiModel",
      type: "string",
      description: "OpenAI model to use (default: gpt-4o)",
      required: false,
    },
  ],
  inputSchema: z.object({
    filePath: z.string(),
    openaiApiKey: z.string().optional(),
    openaiModel: z.string().optional(),
  }),
  outputSchema: DocumentExtractionResultSchema,
  execute: async (input, context): Promise<ToolResult<DocumentExtractionResult>> => {
    try {
      context.logger.info("Extracting document content", { filePath: input.filePath });

      // Get API key from input or environment
      const apiKey = input.openaiApiKey ?? process.env.OPENAI_API_KEY;
      const model = input.openaiModel ?? "gpt-4o";

      if (!isValidApiKey(apiKey)) {
        logger.warn({
          event: "document_extraction.no_api_key",
          filePath: input.filePath,
        });

        return {
          success: false,
          error: "OpenAI API key not configured. Please add your API key in Settings.",
        };
      }

      // Check file extension
      const ext = path.extname(input.filePath).toLowerCase();
      const supportedExtensions = [".pdf", ".doc", ".docx", ".txt", ".md", ".markdown", ".csv", ".rtf", ".odt", ".rst"];
      
      if (!supportedExtensions.includes(ext)) {
        return {
          success: false,
          error: `Unsupported document type: ${ext}. Supported: ${supportedExtensions.join(", ")}`,
        };
      }

      // For text-based files, we can read directly and use chat completions
      const textExtensions = [".txt", ".md", ".markdown", ".csv", ".rst"];
      if (textExtensions.includes(ext)) {
        const fileContent = await fs.readFile(input.filePath, "utf-8");
        const documentType = ext === ".txt" ? "text file" : ext === ".csv" ? "csv file" : "markdown";

        // Use OpenAI client for text analysis
        const openai = new OpenAIClient({ apiKey });
        const analysisPrompt = `Analyze the following ${documentType} content and extract the essential meaning:

Document Content:
${fileContent.slice(0, 50000)}

${fileContent.length > 50000 ? "\n[Content truncated...]" : ""}

Please extract:
1. Document title (if identifiable from content)
2. A CONCISE summary (2-3 sentences max) that captures the PURPOSE and MEANING of the document, not a description of its contents. Focus on: What is this about? Why does it matter? What's the main takeaway?
3. Key points (3-5 bullet points max) - only the most important actionable or memorable insights

Respond in JSON format matching this schema:
{
  "title": "string (optional)",
  "summary": "string - concise summary capturing meaning and purpose (2-3 sentences)",
  "keyPoints": ["string - key point 1", "string - key point 2", ...],
  "documentType": "string - type of document"
}`;

        const response = await openai.chatCompletion(
          [{ role: "user", content: analysisPrompt }],
          { model, maxTokens: 8000, temperature: 0.3 }
        );

        const content = response.content;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]) as DocumentExtractionResult;
          return {
            success: true,
            output: {
              ...result,
              extractedText: result.extractedText || fileContent.slice(0, 10000),
              documentType: result.documentType || documentType,
            },
          };
        }

        return {
          success: true,
          output: {
            extractedText: fileContent.slice(0, 10000),
            summary: content.slice(0, 1000),
            keyPoints: [],
            sections: [{ content: fileContent.slice(0, 5000) }],
            documentType,
            topics: [],
          },
        };
      }

      // For binary documents (PDF, DOC, DOCX, etc.), use OpenAI's Responses API with file upload
      logger.info({
        event: "document_extraction.uploading_file",
        filePath: input.filePath,
        model,
      });

      // Read file and encode as base64
      const fileBuffer = await fs.readFile(input.filePath);
      const base64Data = fileBuffer.toString("base64");
      const mimeType = getDocumentMimeType(input.filePath);
      const filename = path.basename(input.filePath);

      // Create OpenAI client
      const openai = new OpenAI({ apiKey });

      // Use the Responses API with file input
      const analysisPrompt = `Analyze this document and extract its essential meaning.

Please extract:
1. Document title (if identifiable)
2. A CONCISE summary (2-3 sentences max) that captures the PURPOSE and MEANING of the document, not a description of its contents. Focus on: What is this about? Why does it matter? What's the main takeaway?
3. Key points (3-5 bullet points max) - only the most important actionable or memorable insights

Respond in JSON format matching this schema:
{
  "title": "string (optional)",
  "summary": "string - concise summary capturing meaning and purpose (2-3 sentences)",
  "keyPoints": ["string - key point 1", "string - key point 2", ...],
  "documentType": "string - type of document"
}`;

      logger.info({
        event: "document_extraction.calling_responses_api",
        filePath: input.filePath,
        model,
        fileSize: fileBuffer.length,
      });

      const response = await openai.responses.create({
        model,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_file",
                filename,
                file_data: `data:${mimeType};base64,${base64Data}`,
              },
              {
                type: "input_text",
                text: analysisPrompt,
              },
            ],
          },
        ],
      });

      const content = response.output_text;

      logger.info({
        event: "document_extraction.response_received",
        filePath: input.filePath,
        responseLength: content?.length ?? 0,
      });

      try {
        const jsonMatch = content?.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]) as DocumentExtractionResult;

          logger.info({
            event: "document_extraction.complete",
            filePath: input.filePath,
            hasTitle: !!result.title,
            hasSummary: !!result.summary,
            keyPointsCount: result.keyPoints?.length ?? 0,
          });

          return {
            success: true,
            output: {
              ...result,
              documentType: result.documentType || ext.slice(1),
            },
          };
        }
        throw new Error("No JSON found in response");
      } catch (parseErr) {
        logger.warn({
          event: "document_extraction.parse_failed",
          filePath: input.filePath,
          error: parseErr instanceof Error ? parseErr.message : String(parseErr),
        });

        return {
          success: true,
          output: {
            extractedText: content?.slice(0, 10000) ?? "",
            summary: content?.slice(0, 1000) ?? "Document analyzed but structured parsing failed",
            keyPoints: [],
            sections: [{ content: content?.slice(0, 5000) ?? "" }],
            documentType: ext.slice(1),
            topics: [],
          },
        };
      }
    } catch (err) {
      logger.error({
        event: "document_extraction.error",
        filePath: input.filePath,
        error: err instanceof Error ? err.message : String(err),
      });

      return {
        success: false,
        error: `Failed to extract document: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

/**
 * All AI extraction tools
 */
export const aiExtractionTools = [
  extractAudioTool,
  extractVideoTool,
  extractImageTool,
  extractUrlTool,
  extractDocumentTool,
];
