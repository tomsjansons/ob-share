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

// Debug client types - functions are lazily imported in ai-extraction-tools.ts
// to avoid potential module load issues affecting the main workflow system
export type {
  DebugTranscriptionResult,
  DebugTranscriptionOptions,
} from "./debug-client";
