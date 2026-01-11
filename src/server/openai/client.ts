/**
 * OpenAI API Client - Handles all OpenAI API interactions
 *
 * Provides a configurable client for:
 * - Audio transcription with diarization (GPT-4o-transcribe-diarize)
 * - Chat completions (GPT-4o)
 */

import { createReadStream } from "fs";
import { logger as baseLogger } from "@/lib/logger";
import OpenAI from "openai";

const logger = baseLogger.child({ module: "openai-client" });

// Default models
export const DEFAULT_AUDIO_MODEL = "gpt-4o-transcribe-diarize";
export const DEFAULT_VISION_MODEL = "gpt-4o";

/**
 * OpenAI API configuration
 */
export interface OpenAIConfig {
  apiKey: string;
}

/**
 * Diarized transcription segment with speaker information
 * Matches the OpenAI diarized_json response format for gpt-4o-transcribe-diarize
 */
export interface DiarizedSegment {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

/**
 * Diarized transcription result from gpt-4o-transcribe-diarize
 * Response format when using response_format: "diarized_json"
 */
export interface DiarizedTranscriptionResult {
  text: string;
  segments: DiarizedSegment[];
  duration?: number; // Duration in seconds (may not always be present)
}

/**
 * Diarization transcription options
 */
export interface DiarizeTranscriptionOptions {
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
   * Transcribe audio with diarization using gpt-4o-transcribe-diarize
   * Uses the official OpenAI audio transcriptions endpoint with diarized_json response format
   *
   * According to OpenAI docs:
   * - gpt-4o-transcribe-diarize supports json, text, and diarized_json response formats
   * - chunking_strategy is required when audio is longer than 30 seconds ("auto" is recommended)
   * - diarized_json response includes segments with speaker, text, start, and end
   */
  async transcribeWithDiarization(
    filePath: string,
    options?: DiarizeTranscriptionOptions
  ): Promise<DiarizedTranscriptionResult> {
    const model = options?.model ?? DEFAULT_AUDIO_MODEL;

    logger.info({
      event: "openai.transcribeDiarize.start",
      filePath,
      model,
    });

    try {
      const openai = this.createClient();

      // Use the SDK with createReadStream for proper file upload
      // response_format: "diarized_json" returns segments with speaker labels
      // chunking_strategy: "auto" is required for audio longer than 30 seconds
      // Note: SDK types don't include diarized_json yet, but API accepts it
      const response = await (openai.audio.transcriptions.create as (params: unknown) => Promise<unknown>)({
        file: createReadStream(filePath),
        model,
        response_format: "diarized_json",
        chunking_strategy: "auto", // Required for audio > 30 seconds
        ...(options?.language && { language: options.language }),
      }) as DiarizedTranscriptionResult;

      logger.info({
        event: "openai.transcribeDiarize.complete",
        filePath,
        segmentCount: response.segments?.length ?? 0,
        textLength: response.text?.length ?? 0,
      });

      return response;
    } catch (err) {
      logger.error({
        event: "openai.transcribeDiarize.error",
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
