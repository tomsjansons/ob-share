/**
 * OpenAI API Client - Handles all OpenAI API interactions
 *
 * Provides a configurable client for:
 * - Audio transcription (Whisper)
 * - Multimodal content analysis (GPT-4o with audio/vision)
 */

import { promises as fs } from "fs";
import { createReadStream } from "fs";
import path from "path";
import { logger as baseLogger } from "@/lib/logger";
import OpenAI from "openai";

const logger = baseLogger.child({ module: "openai-client" });

// Default models
export const DEFAULT_WHISPER_MODEL = "whisper-1";
export const DEFAULT_AUDIO_MODEL = "gpt-4o-audio-preview";
export const DEFAULT_VISION_MODEL = "gpt-4o";

/**
 * OpenAI API configuration
 */
export interface OpenAIConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeout?: number;
}

/**
 * Audio transcription options
 */
export interface TranscriptionOptions {
  model?: string;
  language?: string;
  prompt?: string;
  responseFormat?: "json" | "text" | "srt" | "verbose_json" | "vtt";
  temperature?: number;
}

/**
 * Transcription result
 */
export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
  segments?: Array<{
    id: number;
    start: number;
    end: number;
    text: string;
  }>;
}

/**
 * Chat completion message
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<ChatContentPart>;
}

/**
 * Content part for multimodal messages
 */
export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }
  | { type: "input_audio"; input_audio: { data: string; format: "wav" | "mp3" } };

/**
 * Chat completion options
 */
export interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: "text" | "json_object" };
}

/**
 * Chat completion result
 */
export interface ChatCompletionResult {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
}

/**
 * OpenAI API Client
 */
export class OpenAIClient {
  private config: Required<Omit<OpenAIConfig, "model">> & { model?: string };

  constructor(config: OpenAIConfig) {
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? "https://api.openai.com/v1",
      model: config.model,
      timeout: config.timeout ?? 120000,
    };
  }

  /**
   * Transcribe audio file using Whisper API
   * Uses the official OpenAI SDK with fs.createReadStream for proper file upload
   */
  async transcribe(
    filePath: string,
    options?: TranscriptionOptions
  ): Promise<TranscriptionResult> {
    const model = options?.model ?? DEFAULT_WHISPER_MODEL;

    logger.info({
      event: "openai.transcribe.start",
      filePath,
      model,
    });

    try {
      // Create official OpenAI client
      const openai = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseUrl,
        timeout: this.config.timeout,
      });

      // Use the official SDK with fs.createReadStream (the recommended approach)
      const transcriptionOptions: OpenAI.Audio.TranscriptionCreateParams = {
        file: createReadStream(filePath),
        model,
        response_format: options?.responseFormat ?? "verbose_json",
      };

      if (options?.language) {
        transcriptionOptions.language = options.language;
      }
      if (options?.prompt) {
        transcriptionOptions.prompt = options.prompt;
      }
      if (options?.temperature !== undefined) {
        transcriptionOptions.temperature = options.temperature;
      }

      const data = await openai.audio.transcriptions.create(transcriptionOptions);

      // Handle different response formats
      // For verbose_json, we get an object with text, language, duration, segments
      // For text, we get just a string
      // Cast to record to access verbose_json fields that aren't in the basic type
      const verboseData = data as unknown as {
        text: string;
        language?: string;
        duration?: number;
        segments?: Array<{ id: number; start: number; end: number; text: string }>;
      };

      logger.info({
        event: "openai.transcribe.complete",
        language: verboseData.language,
        duration: verboseData.duration,
        textLength: verboseData.text?.length,
      });

      return {
        text: verboseData.text || "",
        language: verboseData.language,
        duration: verboseData.duration,
        segments: verboseData.segments?.map((s) => ({
          id: s.id,
          start: s.start,
          end: s.end,
          text: s.text,
        })),
      };
    } catch (err) {
      logger.error({
        event: "openai.transcribe.error",
        filePath,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Analyze audio using multimodal model (GPT-4o with audio)
   */
  async analyzeAudio(
    filePath: string,
    prompt: string,
    options?: ChatCompletionOptions
  ): Promise<ChatCompletionResult> {
    const model = options?.model ?? this.config.model ?? DEFAULT_AUDIO_MODEL;

    logger.info({
      event: "openai.analyzeAudio.start",
      filePath,
      model,
    });

    try {
      // Read and encode audio file
      const audioBuffer = await fs.readFile(filePath);
      const base64Audio = audioBuffer.toString("base64");
      const audioFormat = this.getAudioFormat(filePath);

      // Build message with audio input
      const messages: ChatMessage[] = [
        {
          role: "user",
          content: [
            {
              type: "input_audio",
              input_audio: {
                data: base64Audio,
                format: audioFormat,
              },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ];

      return this.chatCompletion(messages, { ...options, model });
    } catch (err) {
      logger.error({
        event: "openai.analyzeAudio.error",
        filePath,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Analyze image using vision model
   */
  async analyzeImage(
    filePath: string,
    prompt: string,
    options?: ChatCompletionOptions
  ): Promise<ChatCompletionResult> {
    const model = options?.model ?? this.config.model ?? DEFAULT_VISION_MODEL;

    logger.info({
      event: "openai.analyzeImage.start",
      filePath,
      model,
    });

    try {
      // Read and encode image file
      const imageBuffer = await fs.readFile(filePath);
      const base64Image = imageBuffer.toString("base64");
      const mimeType = this.getMimeType(filePath);

      // Build message with image
      const messages: ChatMessage[] = [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
                detail: "high",
              },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ];

      return this.chatCompletion(messages, { ...options, model });
    } catch (err) {
      logger.error({
        event: "openai.analyzeImage.error",
        filePath,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Make a chat completion request
   */
  async chatCompletion(
    messages: ChatMessage[],
    options?: ChatCompletionOptions
  ): Promise<ChatCompletionResult> {
    const model = options?.model ?? this.config.model ?? DEFAULT_VISION_MODEL;

    logger.debug({
      event: "openai.chatCompletion.start",
      model,
      messageCount: messages.length,
    });

    try {
      const body: Record<string, unknown> = {
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      };

      if (options?.temperature !== undefined) {
        body.temperature = options.temperature;
      }
      if (options?.maxTokens !== undefined) {
        body.max_tokens = options.maxTokens;
      }
      if (options?.responseFormat) {
        body.response_format = options.responseFormat;
      }

      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorBody}`);
      }

      const data = await response.json();
      const choice = data.choices?.[0];

      logger.debug({
        event: "openai.chatCompletion.complete",
        model: data.model,
        usage: data.usage,
        finishReason: choice?.finish_reason,
      });

      return {
        content: choice?.message?.content ?? "",
        model: data.model,
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
            }
          : undefined,
        finishReason: choice?.finish_reason,
      };
    } catch (err) {
      logger.error({
        event: "openai.chatCompletion.error",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Get MIME type for a file
   */
  private getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".ogg": "audio/ogg",
      ".webm": "audio/webm",
      ".m4a": "audio/mp4",
      ".mp4": "video/mp4",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
    };
    return mimeTypes[ext] ?? "application/octet-stream";
  }

  /**
   * Get audio format for multimodal API
   */
  private getAudioFormat(filePath: string): "wav" | "mp3" {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".wav") return "wav";
    return "mp3"; // Default to mp3 for other formats
  }
}

/**
 * Create an OpenAI client from user settings
 */
export function createOpenAIClient(
  apiKey: string,
  model?: string
): OpenAIClient {
  return new OpenAIClient({
    apiKey,
    model,
  });
}

/**
 * Validate OpenAI API key format
 */
export function isValidApiKey(apiKey: string | null | undefined): apiKey is string {
  if (!apiKey) return false;
  // OpenAI API keys typically start with "sk-" and are 51 characters
  return apiKey.startsWith("sk-") && apiKey.length >= 20;
}
