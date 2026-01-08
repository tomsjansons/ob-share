/**
 * OpenAI Module
 *
 * Provides OpenAI API client and utilities for audio/image processing.
 */

export {
  OpenAIClient,
  createOpenAIClient,
  isValidApiKey,
  DEFAULT_WHISPER_MODEL,
  DEFAULT_AUDIO_MODEL,
  DEFAULT_VISION_MODEL,
  DEFAULT_TRANSCRIBE_DIARIZE_MODEL,
  type OpenAIConfig,
  type TranscriptionOptions,
  type TranscriptionResult,
  type DiarizedSegment,
  type DiarizedTranscriptionResult,
  type DiarizeTranscriptionOptions,
  type ChatMessage,
  type ChatContentPart,
  type ChatCompletionOptions,
  type ChatCompletionResult,
} from "./client";
