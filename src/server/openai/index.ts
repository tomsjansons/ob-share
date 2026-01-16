/**
 * OpenAI Module
 *
 * Provides OpenAI API client and utilities for audio/text processing.
 */

export {
  OpenAIClient,
  transcribeAudio,
  isValidApiKey,
  DEFAULT_AUDIO_MODEL,
  DEFAULT_VISION_MODEL,
  type OpenAIConfig,
  type TranscriptionSegment,
  type TranscriptionResult,
  type TranscriptionOptions,
  type ChatMessage,
  type ChatContentPart,
  type ChatCompletionOptions,
  type ChatCompletionResult,
} from "./client";
