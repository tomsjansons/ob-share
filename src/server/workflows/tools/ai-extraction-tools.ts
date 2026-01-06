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
import { OpenAIClient, isValidApiKey } from "@/server/openai";

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
    {
      name: "openaiApiKey",
      type: "string",
      description: "OpenAI API key for transcription",
      required: false,
    },
    {
      name: "openaiModel",
      type: "string",
      description: "OpenAI model to use (default: whisper-1)",
      required: false,
    },
  ],
  inputSchema: z.object({
    filePath: z.string(),
    openaiApiKey: z.string().optional(),
    openaiModel: z.string().optional(),
  }),
  outputSchema: AudioExtractionResultSchema,
  execute: async (input, context): Promise<ToolResult<AudioExtractionResult>> => {
    try {
      context.logger.info("Extracting audio content", { filePath: input.filePath });

      // Get API key from input or environment
      const apiKey = input.openaiApiKey ?? process.env.OPENAI_API_KEY;
      const model = input.openaiModel ?? "whisper-1";

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

      // Create OpenAI client
      const openai = new OpenAIClient({ apiKey, model });

      // Transcribe the audio file
      const transcriptionResult = await openai.transcribe(input.filePath, {
        model,
        responseFormat: "verbose_json",
      });

      const transcriptionText = transcriptionResult.text;

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
              language: transcriptionResult.language || "unknown",
            };
          }
        } else {
          analysisResult = {
            speakers: [],
            transcription: [{ text: transcriptionText }],
            summary: transcriptionText.slice(0, 200) + "...",
            intentions: [],
            backgroundNoises: [],
            language: transcriptionResult.language || "unknown",
          };
        }
      } else {
        analysisResult = {
          speakers: [],
          transcription: [{ text: transcriptionText }],
          summary: transcriptionText.slice(0, 200) + "...",
          intentions: [],
          backgroundNoises: [],
          language: transcriptionResult.language || "unknown",
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
  ],
  inputSchema: z.object({
    url: z.string(),
    textLlmProvider: z.enum(["anthropic", "openai"]).optional(),
    textLlmApiKey: z.string().optional(),
    textLlmModel: z.string().optional(),
  }),
  outputSchema: UrlExtractionResultSchema,
  execute: async (input, context): Promise<ToolResult<UrlExtractionResult>> => {
    try {
      context.logger.info("Extracting URL content", {
        url: input.url,
        provider: input.textLlmProvider ?? "anthropic (default)",
      });

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
        });

        return {
          success: true,
          output: {
            url: input.url,
            title: titleMatch?.[1]?.trim(),
            description: descMatch?.[1]?.trim(),
            mainContent: `[Configure ${provider.toUpperCase()} API key for full content extraction]`,
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
 * Extract information from document files (PDF, DOC, TXT, etc.)
 */
export const extractDocumentTool = defineTool({
  name: "extract-document",
  description: "Extract text, structure, and metadata from document files (PDF, DOC, DOCX, TXT)",
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

      // Read the document file
      const ext = path.extname(input.filePath).toLowerCase();
      let fileContent: string;
      let documentType: string;

      // Determine document type and read content
      if ([".txt", ".md", ".markdown", ".rst", ".csv"].includes(ext)) {
        // Text-based files - read directly
        fileContent = await fs.readFile(input.filePath, "utf-8");
        documentType = ext === ".txt" ? "text file" : ext === ".csv" ? "csv file" : "markdown";
      } else if ([".pdf", ".doc", ".docx", ".rtf", ".odt"].includes(ext)) {
        // Binary document files - read as base64 and use OpenAI Files API
        const buffer = await fs.readFile(input.filePath);
        const base64Data = buffer.toString("base64");

        // For PDF and other binary docs, we'll need to use vision capabilities
        // or the Assistants API. For now, we use vision model with the file
        documentType = ext === ".pdf" ? "pdf" : ext === ".docx" ? "word document" : ext === ".doc" ? "word document (legacy)" : "document";

        // Use OpenAI's vision model to analyze the document
        // Send as base64 encoded data URL
        const mimeTypes: Record<string, string> = {
          ".pdf": "application/pdf",
          ".doc": "application/msword",
          ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          ".rtf": "application/rtf",
          ".odt": "application/vnd.oasis.opendocument.text",
        };
        const mimeType = mimeTypes[ext] || "application/octet-stream";

        // Create OpenAI client and analyze using chat with file upload
        const analysisPrompt = `You are a document analysis assistant. Analyze this ${documentType} file and extract:

1. Document title (if identifiable)
2. Author (if mentioned)
3. Complete text content - extract ALL readable text from the document
4. A comprehensive summary (2-4 paragraphs)
5. Key points (5-10 bullet points)
6. Document sections with their content
7. Main topics covered
8. Language of the document

Respond in JSON format matching this schema:
{
  "title": "string (optional)",
  "author": "string (optional)",
  "pageCount": number (optional),
  "extractedText": "string - full extracted text",
  "summary": "string - comprehensive summary",
  "keyPoints": ["string - key point 1", "string - key point 2", ...],
  "sections": [{"title": "string (optional)", "content": "string"}],
  "documentType": "string - type of document",
  "language": "string (optional)",
  "topics": ["string - topic 1", "string - topic 2", ...]
}`;

        // Make API request with file
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "file",
                    file: {
                      filename: path.basename(input.filePath),
                      file_data: `data:${mimeType};base64,${base64Data}`,
                    },
                  },
                  {
                    type: "text",
                    text: analysisPrompt,
                  },
                ],
              },
            ],
            max_tokens: 16000,
            temperature: 0.3,
          }),
        });

        if (!response.ok) {
          const errorBody = await response.text();

          // If file upload fails, try with a simpler approach - read text if possible
          logger.warn({
            event: "document_extraction.file_upload_failed",
            filePath: input.filePath,
            error: errorBody,
          });

          // Fallback: Try to extract text from PDF using basic approach
          return {
            success: false,
            error: `Failed to analyze document: ${response.status}. This may require pdf-parse library for text extraction. Error: ${errorBody.slice(0, 200)}`,
          };
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || "{}";

        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]) as DocumentExtractionResult;
            return {
              success: true,
              output: {
                ...result,
                documentType: result.documentType || documentType,
              },
            };
          }
          throw new Error("No JSON found in response");
        } catch (parseErr) {
          return {
            success: true,
            output: {
              extractedText: content.slice(0, 5000),
              summary: "Document analyzed but structured parsing failed",
              keyPoints: [],
              sections: [{ content: content.slice(0, 5000) }],
              documentType,
              topics: [],
            },
          };
        }
      } else {
        return {
          success: false,
          error: `Unsupported document type: ${ext}. Supported: .pdf, .doc, .docx, .txt, .md, .csv, .rtf, .odt`,
        };
      }

      // For text-based files, analyze with OpenAI
      const analysisPrompt = `Analyze the following ${documentType} content and extract structured information:

Document Content:
${fileContent.slice(0, 50000)}

${fileContent.length > 50000 ? "\n[Content truncated...]" : ""}

Please extract:
1. Document title (if identifiable from content)
2. Author (if mentioned)
3. A comprehensive summary (2-4 paragraphs)
4. Key points (5-10 bullet points)
5. Document sections with their content
6. Main topics covered
7. Language of the document

Respond in JSON format matching this schema:
{
  "title": "string (optional)",
  "author": "string (optional)",
  "extractedText": "string - the original text (first 10000 chars)",
  "summary": "string - comprehensive summary",
  "keyPoints": ["string - key point 1", "string - key point 2", ...],
  "sections": [{"title": "string (optional)", "content": "string"}],
  "documentType": "string - type of document",
  "language": "string (optional)",
  "topics": ["string - topic 1", "string - topic 2", ...]
}`;

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: analysisPrompt }],
          max_tokens: 8000,
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorBody}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "{}";

      try {
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
        throw new Error("No JSON found in response");
      } catch (parseErr) {
        // Return basic result if parsing fails
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
    } catch (err) {
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
