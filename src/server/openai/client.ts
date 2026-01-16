/**
 * OpenAI API Client - Handles all OpenAI API interactions
 *
 * Uses Whisper-1 model for audio transcription with verbose_json format.
 */

import { createReadStream } from "fs";
import { logger as baseLogger } from "@/lib/logger";
import OpenAI from "openai";

const logger = baseLogger.child({ module: "openai-client" });

// Default models
export const DEFAULT_AUDIO_MODEL = "whisper-1";
export const DEFAULT_VISION_MODEL = "gpt-4o";

/**
 * OpenAI API configuration
 */
export interface OpenAIConfig {
  apiKey: string;
}

/**
 * Transcription segment from whisper-1 verbose_json format
 */
export interface TranscriptionSegment {
  text: string;
  start: number;
  end: number;
}

/**
 * Transcription result from whisper-1 with verbose_json
 */
export interface TranscriptionResult {
  text: string;
  segments: TranscriptionSegment[];
  duration?: number;
}

/**
 * Transcription options
 */
export interface TranscriptionOptions {
  model?: string;
  language?: string;
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
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

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

// Default timeout for API requests (2 minutes)
const DEFAULT_TIMEOUT = 120000;

/**
 * OpenAI API Client
 */
export class OpenAIClient {
  private apiKey: string;

  constructor(config: OpenAIConfig) {
    this.apiKey = config.apiKey;
  }

  /**
   * Create an OpenAI SDK client instance
   */
  private createClient(): OpenAI {
    return new OpenAI({
      apiKey: this.apiKey,
      timeout: DEFAULT_TIMEOUT,
    });
  }

  /**
   * Transcribe audio using whisper-1 with verbose_json format
   */
  async transcribe(
    filePath: string,
    options?: TranscriptionOptions
  ): Promise<TranscriptionResult> {
    const model = options?.model ?? DEFAULT_AUDIO_MODEL;

    logger.info({
      event: "openai.transcribe.start",
      filePath,
      model,
    });

    try {
      const openai = this.createClient();

      const response = await openai.audio.transcriptions.create({
        file: createReadStream(filePath),
        model,
        response_format: "verbose_json",
        ...(options?.language && { language: options.language }),
      });

      logger.info({
        event: "openai.transcribe.complete",
        filePath,
        textLength: response.text?.length ?? 0,
      });

      return {
        text: response.text,
        segments: response.segments?.map(s => ({
          text: s.text,
          start: s.start,
          end: s.end,
        })) ?? [],
        duration: response.duration,
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
   * Make a chat completion request using the official OpenAI SDK
   */
  async chatCompletion(
    messages: ChatMessage[],
    options?: ChatCompletionOptions
  ): Promise<ChatCompletionResult> {
    const model = options?.model ?? DEFAULT_VISION_MODEL;

    logger.debug({
      event: "openai.chatCompletion.start",
      model,
      messageCount: messages.length,
    });

    try {
      const openai = this.createClient();

      // Build request parameters
      const params: OpenAI.ChatCompletionCreateParams = {
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content as OpenAI.ChatCompletionContentPart[] | string,
        })) as OpenAI.ChatCompletionMessageParam[],
      };

      if (options?.temperature !== undefined) {
        params.temperature = options.temperature;
      }
      if (options?.maxTokens !== undefined) {
        params.max_tokens = options.maxTokens;
      }
      if (options?.responseFormat) {
        params.response_format = options.responseFormat;
      }

      const response = await openai.chat.completions.create(params);
      const choice = response.choices?.[0];

      logger.debug({
        event: "openai.chatCompletion.complete",
        model: response.model,
        usage: response.usage,
        finishReason: choice?.finish_reason,
      });

      return {
        content: choice?.message?.content ?? "",
        model: response.model,
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
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
}

/**
 * Validate OpenAI API key format
 */
export function isValidApiKey(apiKey: string | null | undefined): apiKey is string {
  if (!apiKey) return false;
  // OpenAI API keys typically start with "sk-" and are 51 characters
  return apiKey.startsWith("sk-") && apiKey.length >= 20;
}
