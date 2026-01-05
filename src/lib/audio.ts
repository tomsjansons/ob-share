"use client";

/**
 * Audio recording utilities for capturing voice notes
 */

export interface AudioRecordingResult {
  success: boolean;
  blob?: Blob;
  dataUrl?: string;
  duration?: number;
  error?: string;
}

/**
 * Checks if audio recording is supported by the browser
 */
export function isAudioRecordingSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "mediaDevices" in navigator &&
    "getUserMedia" in navigator.mediaDevices
  );
}

/**
 * Requests audio recording permission from the browser
 * Returns true if permission is granted, false if denied
 */
export async function requestAudioPermission(): Promise<boolean> {
  if (!isAudioRecordingSupported()) {
    return false;
  }

  try {
    // Request microphone access - this triggers the permission prompt
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Stop all tracks to release the microphone
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch (error) {
    const err = error as DOMException;
    // NotAllowedError means permission was denied
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      return false;
    }
    // Other errors (like NotFoundError) still mean we don't have access
    return false;
  }
}

/**
 * Checks the current audio permission status using the Permissions API
 * Note: Not all browsers support this, so we fall back to unknown
 */
export async function checkAudioPermission(): Promise<
  "granted" | "denied" | "prompt" | "unknown"
> {
  if (!isAudioRecordingSupported()) {
    return "denied";
  }

  try {
    if ("permissions" in navigator) {
      const result = await navigator.permissions.query({
        name: "microphone" as PermissionName,
      });
      return result.state as "granted" | "denied" | "prompt";
    }
  } catch {
    // Permissions API not supported for microphone
  }

  return "unknown";
}

/**
 * Audio recorder class for managing recording sessions
 */
export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private startTime: number = 0;

  /**
   * Starts recording audio
   * @returns Promise that resolves when recording starts
   */
  async start(): Promise<{ success: boolean; error?: string }> {
    if (!isAudioRecordingSupported()) {
      return {
        success: false,
        error: "Audio recording is not supported in this browser",
      };
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioChunks = [];

      // Prefer webm for broader support, fall back to other formats
      const mimeType = this.getSupportedMimeType();

      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType,
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.startTime = Date.now();
      this.mediaRecorder.start(1000); // Collect data every second

      return { success: true };
    } catch (error) {
      const err = error as DOMException;
      let errorMessage: string;

      switch (err.name) {
        case "NotAllowedError":
        case "PermissionDeniedError":
          errorMessage = "Microphone permission was denied";
          break;
        case "NotFoundError":
          errorMessage = "No microphone found";
          break;
        case "NotReadableError":
          errorMessage = "Microphone is already in use";
          break;
        default:
          errorMessage = err.message || "Failed to start recording";
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Stops recording and returns the audio data
   * @returns Promise with the recorded audio as a blob and data URL
   */
  async stop(): Promise<AudioRecordingResult> {
    if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") {
      return {
        success: false,
        error: "No active recording to stop",
      };
    }

    return new Promise((resolve) => {
      if (!this.mediaRecorder) {
        resolve({ success: false, error: "No media recorder" });
        return;
      }

      this.mediaRecorder.onstop = async () => {
        const duration = (Date.now() - this.startTime) / 1000;
        const mimeType = this.mediaRecorder?.mimeType || "audio/webm";
        const blob = new Blob(this.audioChunks, { type: mimeType });

        // Convert to data URL for storage
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result as string;
          resolve({
            success: true,
            blob,
            dataUrl,
            duration,
          });
        };
        reader.onerror = () => {
          resolve({
            success: false,
            error: "Failed to convert audio to data URL",
          });
        };
        reader.readAsDataURL(blob);

        // Clean up
        this.cleanup();
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * Cancels the current recording without saving
   */
  cancel(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }
    this.cleanup();
  }

  /**
   * Gets the current recording state
   */
  getState(): "inactive" | "recording" | "paused" {
    return this.mediaRecorder?.state || "inactive";
  }

  /**
   * Gets the current recording duration in seconds
   */
  getDuration(): number {
    if (!this.startTime || this.mediaRecorder?.state !== "recording") {
      return 0;
    }
    return (Date.now() - this.startTime) / 1000;
  }

  /**
   * Cleans up resources
   */
  private cleanup(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.startTime = 0;
  }

  /**
   * Gets a supported MIME type for audio recording
   */
  private getSupportedMimeType(): string {
    const types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return "audio/webm"; // Fallback
  }
}

/**
 * Gets the file extension for an audio MIME type
 */
export function getAudioExtension(mimeType: string): string {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  return "webm"; // Default fallback
}
