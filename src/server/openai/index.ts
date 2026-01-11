/**
 * OpenAI Module
 *
 * Provides OpenAI API client and utilities for audio/text processing.
 */

export {
  OpenAIClient,
  isValidApiKey,
  DEFAULT_AUDIO_MODEL,
  DEFAULT_VISION_MODEL,
  type OpenAIConfig,
  type DiarizedSegment,
  type DiarizedTranscriptionResult,
  type DiarizeTranscriptionOptions,
  type ChatMessage,
  type ChatContentPart,
  type ChatCompletionOptions,
  type ChatCompletionResult,
} from "./client";

// Debug client exports for testing different transcription approaches
export {
  debugTranscribe,
  getDebugTypeDescription,
  getAvailableDebugTypes,
  DEBUG_MODELS,
  type DebugTranscriptionResult,
  type DebugTranscriptionOptions,
} from "./debug-client";
