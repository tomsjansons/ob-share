/**
 * AI Extraction Tools - Tools for extracting information from media files
 *
 * These tools use AI models to extract structured information from
 * audio, video, images, and URLs.
 */

import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { defineTool } from "../steps/tool-step";
import type { ToolResult } from "../types";
import { logger as baseLogger } from "@/lib/logger";

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

export type AudioExtractionResult = z.infer<typeof AudioExtractionResultSchema>;
export type VideoExtractionResult = z.infer<typeof VideoExtractionResultSchema>;
export type ImageExtractionResult = z.infer<typeof ImageExtractionResultSchema>;
export type UrlExtractionResult = z.infer<typeof UrlExtractionResultSchema>;

/**
 * Read file as base64 for API upload
 */
async function readFileAsBase64(filePath: string): Promise<{ data: string; mimeType: string }> {
  const buffer = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();

  const mimeTypes: Record<string, string> = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".webm": "audio/webm",
    ".m4a": "audio/mp4",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
  };

  return {
    data: buffer.toString("base64"),
    mimeType: mimeTypes[ext] || "application/octet-stream",
  };
}

/**
 * Call Anthropic Claude API with media content
 */
async function callClaudeWithMedia(
  prompt: string,
  mediaType: "audio" | "video" | "image",
  base64Data: string,
  mimeType: string
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  // Build the content based on media type
  let content: Array<Record<string, unknown>>;

  if (mediaType === "image") {
    content = [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: mimeType,
          data: base64Data,
        },
      },
      {
        type: "text",
        text: prompt,
      },
    ];
  } else {
    // For audio and video, Claude doesn't directly support them
    // We'll need to use the document processing approach or external transcription
    // For now, we'll return a placeholder that indicates we need external processing
    throw new Error(`${mediaType} processing requires external transcription service. Please configure an audio/video transcription provider.`);
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Anthropic API error: ${response.status} - ${errorBody}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || "";
}

/**
 * Extract information from audio files
 */
export const extractAudioTool = defineTool({
  name: "extract-audio",
  description: "Extract speakers, transcription, intentions, and background noises from an audio file",
  category: "ai-extraction",
  parameters: [
    {
      name: "filePath",
      type: "string",
      description: "Path to the audio file",
      required: true,
    },
  ],
  inputSchema: z.object({
    filePath: z.string(),
  }),
  outputSchema: AudioExtractionResultSchema,
  execute: async (input, context): Promise<ToolResult<AudioExtractionResult>> => {
    try {
      context.logger.info("Extracting audio content", { filePath: input.filePath });

      // For audio, we'll use OpenAI Whisper for transcription if available
      // Otherwise, provide a structured placeholder with instructions
      const apiKey = process.env.OPENAI_API_KEY;

      if (!apiKey) {
        // Return a placeholder result with manual transcription instructions
        logger.warn({
          event: "audio_extraction.no_api_key",
          filePath: input.filePath,
        });

        return {
          success: true,
          output: {
            speakers: [],
            transcription: [{
              text: "[Audio file requires manual transcription or OpenAI API key configuration]",
            }],
            summary: "Audio file detected. Configure OPENAI_API_KEY for automatic transcription.",
            intentions: [],
            backgroundNoises: [],
            language: "unknown",
          },
        };
      }

      // Read audio file
      const { data: base64Data, mimeType } = await readFileAsBase64(input.filePath);

      // Use OpenAI Whisper for transcription
      const formData = new FormData();
      const audioBuffer = Buffer.from(base64Data, "base64");
      const blob = new Blob([audioBuffer], { type: mimeType });
      formData.append("file", blob, path.basename(input.filePath));
      formData.append("model", "whisper-1");
      formData.append("response_format", "verbose_json");

      const whisperResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });

      if (!whisperResponse.ok) {
        const errorBody = await whisperResponse.text();
        throw new Error(`Whisper API error: ${whisperResponse.status} - ${errorBody}`);
      }

      const whisperData = await whisperResponse.json();
      const transcriptionText = whisperData.text || "";

      // Now use Claude to analyze the transcription for speakers, intentions, etc.
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      let analysisResult: AudioExtractionResult;

      if (anthropicKey) {
        const analysisPrompt = `Analyze the following audio transcription and extract structured information:

Transcription:
${transcriptionText}

Please provide:
1. Identify different speakers if multiple are present (give them IDs like "Speaker 1", "Speaker 2")
2. Break down the transcription by speaker if possible
3. Summarize the main content
4. List any apparent intentions or purposes of the conversation
5. Note any mentioned background noises or audio elements
6. Identify the language

Respond in JSON format matching this schema:
{
  "speakers": [{"id": "string", "name": "string (optional)", "description": "string (optional)"}],
  "transcription": [{"speaker": "string (optional)", "text": "string", "timestamp": "string (optional)"}],
  "summary": "string",
  "intentions": ["string"],
  "backgroundNoises": ["string"],
  "mood": "string (optional)",
  "language": "string"
}`;

        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4096,
            messages: [{ role: "user", content: analysisPrompt }],
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const content = data.content?.[0]?.text || "{}";
          try {
            // Extract JSON from response
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              analysisResult = JSON.parse(jsonMatch[0]);
            } else {
              throw new Error("No JSON found in response");
            }
          } catch {
            analysisResult = {
              speakers: [],
              transcription: [{ text: transcriptionText }],
              summary: transcriptionText.slice(0, 200) + "...",
              intentions: [],
              backgroundNoises: [],
              language: whisperData.language || "unknown",
            };
          }
        } else {
          analysisResult = {
            speakers: [],
            transcription: [{ text: transcriptionText }],
            summary: transcriptionText.slice(0, 200) + "...",
            intentions: [],
            backgroundNoises: [],
            language: whisperData.language || "unknown",
          };
        }
      } else {
        analysisResult = {
          speakers: [],
          transcription: [{ text: transcriptionText }],
          summary: transcriptionText.slice(0, 200) + "...",
          intentions: [],
          backgroundNoises: [],
          language: whisperData.language || "unknown",
        };
      }

      return {
        success: true,
        output: analysisResult,
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to extract audio: ${err instanceof Error ? err.message : String(err)}`,
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
 * Extract information from image files
 */
export const extractImageTool = defineTool({
  name: "extract-image",
  description: "Extract visual information, text, diagrams, and descriptions from an image file",
  category: "ai-extraction",
  parameters: [
    {
      name: "filePath",
      type: "string",
      description: "Path to the image file",
      required: true,
    },
  ],
  inputSchema: z.object({
    filePath: z.string(),
  }),
  outputSchema: ImageExtractionResultSchema,
  execute: async (input, context): Promise<ToolResult<ImageExtractionResult>> => {
    try {
      context.logger.info("Extracting image content", { filePath: input.filePath });

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return {
          success: false,
          error: "ANTHROPIC_API_KEY not configured for image extraction",
        };
      }

      // Read image file
      const { data: base64Data, mimeType } = await readFileAsBase64(input.filePath);

      const prompt = `Analyze this image thoroughly and extract all relevant information. Provide a comprehensive analysis including:

1. Overall description of what the image shows
2. List all objects visible in the image
3. Describe any people visible (without identifying specific individuals) and their actions
4. Extract ALL visible text (from signs, documents, screens, labels, etc.) - be thorough
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
  "visibleTexts": [{"text": "string - exact text visible", "source": "string - where the text appears (sign, document, screen, etc.)"}],
  "diagrams": [{"type": "string - type of diagram", "description": "string", "elements": ["string"]}],
  "location": {"description": "string (optional)", "type": "string (optional)", "landmarks": ["string"]},
  "technicalInfo": {"type": "string (optional)", "details": "string (optional)"},
  "mood": "string (optional)",
  "colors": ["string - dominant colors"]
}`;

      const responseText = await callClaudeWithMedia(prompt, "image", base64Data, mimeType);

      // Parse the JSON response
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]) as ImageExtractionResult;
          return {
            success: true,
            output: result,
          };
        }
        throw new Error("No JSON found in response");
      } catch (parseErr) {
        // Return a basic result if parsing fails
        return {
          success: true,
          output: {
            description: responseText.slice(0, 500),
            objects: [],
            people: [],
            visibleTexts: [],
            diagrams: [],
            colors: [],
          },
        };
      }
    } catch (err) {
      return {
        success: false,
        error: `Failed to extract image: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

/**
 * Extract information from URLs
 */
export const extractUrlTool = defineTool({
  name: "extract-url",
  description: "Fetch and extract information from a URL",
  category: "ai-extraction",
  parameters: [
    {
      name: "url",
      type: "string",
      description: "The URL to fetch and extract information from",
      required: true,
    },
  ],
  inputSchema: z.object({
    url: z.string(),
  }),
  outputSchema: UrlExtractionResultSchema,
  execute: async (input, context): Promise<ToolResult<UrlExtractionResult>> => {
    try {
      context.logger.info("Extracting URL content", { url: input.url });

      // Fetch the URL content
      const response = await fetch(input.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ob-share/1.0; +https://github.com/ob-share)",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
      }

      const html = await response.text();

      // Use Claude to analyze the HTML content
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        // Basic extraction without AI
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);

        return {
          success: true,
          output: {
            url: input.url,
            title: titleMatch?.[1]?.trim(),
            description: descMatch?.[1]?.trim(),
            mainContent: "[Configure ANTHROPIC_API_KEY for full content extraction]",
            summary: "URL fetched successfully. Configure AI API key for full extraction.",
            keyPoints: [],
            type: "webpage",
            images: [],
            links: [],
          },
        };
      }

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

      const analysisResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          messages: [{ role: "user", content: analysisPrompt }],
        }),
      });

      if (!analysisResponse.ok) {
        const errorBody = await analysisResponse.text();
        throw new Error(`Claude API error: ${analysisResponse.status} - ${errorBody}`);
      }

      const data = await analysisResponse.json();
      const content = data.content?.[0]?.text || "{}";

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
 * All AI extraction tools
 */
export const aiExtractionTools = [
  extractAudioTool,
  extractVideoTool,
  extractImageTool,
  extractUrlTool,
];
