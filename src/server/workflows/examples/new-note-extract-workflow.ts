/**
 * New Note Extract Workflow
 *
 * Processes incoming notes and extracts information from attached media:
 * - Audio: Extract speakers, transcription, intentions, background noises
 * - Video: Extract audio content + visual information (scenes, texts, locations)
 * - Image: Extract visual info, text, diagrams, technical info
 * - URL: Fetch and extract web content
 *
 * The workflow updates the original file with extracted information and
 * changes the status from "extracting" to "extracted".
 */

import { z } from "zod";
import { promises as fs } from "fs";
import path from "path";
import {
  workflow,
  defineLLMStep,
  defineToolStep,
  defineTransformStep,
  defineConditionStep,
  WorkflowPriority,
} from "../index";
import type { WorkflowContext } from "../types";
import { updateFileStatus, updateFileWithError, getAttachmentPath } from "@/server/file-checker";
import { logger as baseLogger } from "@/lib/logger";
import { parseFrontmatter, buildMarkdown } from "@/lib/frontmatter";
import type {
  AudioExtractionResult,
  VideoExtractionResult,
  ImageExtractionResult,
  UrlExtractionResult,
  DocumentExtractionResult,
} from "../tools/ai-extraction-tools";

const logger = baseLogger.child({ module: "new-note-extract-workflow" });

// =============================================================================
// Schemas
// =============================================================================

/**
 * Text LLM provider type
 */
type TextLlmProvider = "anthropic" | "openai";

/**
 * Trigger schema - what data starts the workflow
 */
export const NewNoteExtractTriggerSchema = z.object({
  filePath: z.string().describe("Path to the markdown file to process"),
  contentType: z.enum(["audio", "video", "image", "url", "document", "text"]).describe("Type of content in the note"),
  userId: z.string().describe("ID of the user who owns this note"),
  openaiApiKey: z.string().optional().describe("OpenAI API key for transcription"),
  openaiModel: z.string().optional().describe("OpenAI model for transcription"),
  textLlmProvider: z.enum(["anthropic", "openai"]).optional().describe("Text LLM provider for URL summarization"),
  textLlmApiKey: z.string().optional().describe("API key for text LLM provider"),
  textLlmModel: z.string().optional().describe("Model for text LLM provider"),
  documentAnalysisModel: z.string().optional().describe("OpenAI model for document analysis"),
  maxRetries: z.number().optional().describe("Maximum retry attempts"),
  isRetry: z.boolean().optional().describe("Whether this is a retry attempt"),
  retryNum: z.number().optional().describe("Current retry attempt number"),
});

export type NewNoteExtractTrigger = z.infer<typeof NewNoteExtractTriggerSchema>;

/**
 * Result schema
 */
export const NewNoteExtractResultSchema = z.object({
  success: z.boolean(),
  filePath: z.string(),
  contentType: z.string(),
  extractedContent: z.unknown().optional(),
  error: z.string().optional(),
});

export type NewNoteExtractResult = z.infer<typeof NewNoteExtractResultSchema>;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract attachment filenames from markdown content
 */
function extractAttachments(body: string): string[] {
  const attachments: string[] = [];
  const wikiLinkRegex = /!?\[\[([^\]]+)\]\]/g;
  const matches = [...body.matchAll(wikiLinkRegex)];

  for (const match of matches) {
    attachments.push(match[1]);
  }

  return attachments;
}

/**
 * Extract URLs from markdown content
 */
function extractUrls(body: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>\]"']+/gi;
  const matches = body.match(urlRegex) || [];
  return [...new Set(matches)]; // Remove duplicates
}

/**
 * Format audio extraction result as markdown
 */
function formatAudioExtraction(result: AudioExtractionResult): string {
  const sections: string[] = [];

  sections.push("## Extracted Audio Content\n");

  if (result.summary) {
    sections.push(`### Summary\n${result.summary}\n`);
  }

  if (result.speakers.length > 0) {
    sections.push("### Speakers");
    for (const speaker of result.speakers) {
      sections.push(`- **${speaker.id}**${speaker.name ? ` (${speaker.name})` : ""}${speaker.description ? `: ${speaker.description}` : ""}`);
    }
    sections.push("");
  }

  if (result.transcription.length > 0) {
    sections.push("### Transcription");
    for (const segment of result.transcription) {
      const prefix = segment.speaker ? `**${segment.speaker}**: ` : "";
      const timestamp = segment.timestamp ? `[${segment.timestamp}] ` : "";
      sections.push(`${timestamp}${prefix}${segment.text}`);
    }
    sections.push("");
  }

  if (result.intentions.length > 0) {
    sections.push("### Detected Intentions");
    for (const intention of result.intentions) {
      sections.push(`- ${intention}`);
    }
    sections.push("");
  }

  if (result.backgroundNoises.length > 0) {
    sections.push("### Background Noises");
    for (const noise of result.backgroundNoises) {
      sections.push(`- ${noise}`);
    }
    sections.push("");
  }

  if (result.mood) {
    sections.push(`**Mood**: ${result.mood}\n`);
  }

  if (result.language) {
    sections.push(`**Language**: ${result.language}\n`);
  }

  return sections.join("\n");
}

/**
 * Format video extraction result as markdown
 */
function formatVideoExtraction(result: VideoExtractionResult): string {
  const sections: string[] = [];

  sections.push("## Extracted Video Content\n");

  if (result.summary) {
    sections.push(`### Summary\n${result.summary}\n`);
  }

  // Audio components
  if (result.speakers.length > 0) {
    sections.push("### Speakers");
    for (const speaker of result.speakers) {
      sections.push(`- **${speaker.id}**${speaker.name ? ` (${speaker.name})` : ""}${speaker.description ? `: ${speaker.description}` : ""}`);
    }
    sections.push("");
  }

  if (result.transcription.length > 0) {
    sections.push("### Transcription");
    for (const segment of result.transcription) {
      const prefix = segment.speaker ? `**${segment.speaker}**: ` : "";
      const timestamp = segment.timestamp ? `[${segment.timestamp}] ` : "";
      sections.push(`${timestamp}${prefix}${segment.text}`);
    }
    sections.push("");
  }

  // Visual components
  if (result.scenes.length > 0) {
    sections.push("### Scenes");
    for (const scene of result.scenes) {
      sections.push(`#### ${scene.timestamp || "Scene"}`);
      sections.push(scene.description);
      if (scene.location) {
        sections.push(`**Location**: ${scene.location}`);
      }
      if (scene.actions.length > 0) {
        sections.push(`**Actions**: ${scene.actions.join(", ")}`);
      }
      if (scene.objects.length > 0) {
        sections.push(`**Objects**: ${scene.objects.join(", ")}`);
      }
      sections.push("");
    }
  }

  if (result.visibleTexts.length > 0) {
    sections.push("### Visible Text");
    for (const text of result.visibleTexts) {
      sections.push(`- **${text.source}**${text.timestamp ? ` [${text.timestamp}]` : ""}: "${text.text}"`);
    }
    sections.push("");
  }

  if (result.intentions.length > 0) {
    sections.push("### Detected Intentions");
    for (const intention of result.intentions) {
      sections.push(`- ${intention}`);
    }
    sections.push("");
  }

  if (result.backgroundNoises.length > 0) {
    sections.push("### Background Noises");
    for (const noise of result.backgroundNoises) {
      sections.push(`- ${noise}`);
    }
    sections.push("");
  }

  if (result.mood) {
    sections.push(`**Mood**: ${result.mood}\n`);
  }

  if (result.language) {
    sections.push(`**Language**: ${result.language}\n`);
  }

  return sections.join("\n");
}

/**
 * Format image extraction result as markdown
 */
function formatImageExtraction(result: ImageExtractionResult): string {
  const sections: string[] = [];

  sections.push("## Extracted Image Content\n");

  if (result.description) {
    sections.push(`### Description\n${result.description}\n`);
  }

  if (result.objects.length > 0) {
    sections.push("### Objects");
    sections.push(result.objects.join(", "));
    sections.push("");
  }

  if (result.people.length > 0) {
    sections.push("### People");
    for (const person of result.people) {
      sections.push(`- ${person.description}${person.action ? ` (${person.action})` : ""}`);
    }
    sections.push("");
  }

  if (result.visibleTexts.length > 0) {
    sections.push("### Visible Text");
    for (const text of result.visibleTexts) {
      sections.push(`- **${text.source}**: "${text.text}"`);
    }
    sections.push("");
  }

  if (result.diagrams.length > 0) {
    sections.push("### Diagrams");
    for (const diagram of result.diagrams) {
      sections.push(`#### ${diagram.type}`);
      sections.push(diagram.description);
      if (diagram.elements.length > 0) {
        sections.push(`**Elements**: ${diagram.elements.join(", ")}`);
      }
      sections.push("");
    }
  }

  if (result.location) {
    sections.push("### Location");
    if (result.location.description) {
      sections.push(result.location.description);
    }
    if (result.location.type) {
      sections.push(`**Type**: ${result.location.type}`);
    }
    if (result.location.landmarks.length > 0) {
      sections.push(`**Landmarks**: ${result.location.landmarks.join(", ")}`);
    }
    sections.push("");
  }

  if (result.technicalInfo) {
    sections.push("### Technical Information");
    if (result.technicalInfo.type) {
      sections.push(`**Type**: ${result.technicalInfo.type}`);
    }
    if (result.technicalInfo.details) {
      sections.push(result.technicalInfo.details);
    }
    sections.push("");
  }

  if (result.mood) {
    sections.push(`**Mood**: ${result.mood}\n`);
  }

  if (result.colors.length > 0) {
    sections.push(`**Colors**: ${result.colors.join(", ")}\n`);
  }

  return sections.join("\n");
}

/**
 * Format URL extraction result as markdown
 */
function formatUrlExtraction(result: UrlExtractionResult): string {
  const sections: string[] = [];

  sections.push("## Extracted Web Content\n");

  if (result.title) {
    sections.push(`### ${result.title}\n`);
  }

  sections.push(`**Source**: [${result.url}](${result.url})`);
  sections.push(`**Type**: ${result.type}`);

  if (result.author) {
    sections.push(`**Author**: ${result.author}`);
  }

  if (result.publishDate) {
    sections.push(`**Published**: ${result.publishDate}`);
  }

  sections.push("");

  if (result.summary) {
    sections.push(`### Summary\n${result.summary}\n`);
  }

  if (result.keyPoints.length > 0) {
    sections.push("### Key Points");
    for (const point of result.keyPoints) {
      sections.push(`- ${point}`);
    }
    sections.push("");
  }

  if (result.mainContent) {
    sections.push("### Content");
    sections.push(result.mainContent.slice(0, 5000)); // Limit content length
    if (result.mainContent.length > 5000) {
      sections.push("\n*[Content truncated...]*");
    }
    sections.push("");
  }

  return sections.join("\n");
}

/**
 * Format document extraction result as markdown
 */
function formatDocumentExtraction(result: DocumentExtractionResult): string {
  const sections: string[] = [];

  sections.push("## Extracted Document Content\n");

  if (result.title) {
    sections.push(`### ${result.title}\n`);
  }

  if (result.summary) {
    sections.push(`### Summary\n${result.summary}\n`);
  }

  if (result.keyPoints && result.keyPoints.length > 0) {
    sections.push("### Key Points");
    for (const point of result.keyPoints) {
      sections.push(`- ${point}`);
    }
    sections.push("");
  }

  return sections.join("\n");
}

// =============================================================================
// Workflow Definition
// =============================================================================

export const newNoteExtractWorkflow = workflow("new-note-extract", "New Note Extract Workflow")
  .description("Extracts information from incoming notes with media attachments or URLs")
  .version("1.0.0")
  .priority(WorkflowPriority.NORMAL)
  .trigger(NewNoteExtractTriggerSchema)
  .result(NewNoteExtractResultSchema)
  .llmConfig({
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    temperature: 0.3,
  })

  // Step 1: Read the file and extract attachment info
  .step(
    defineTransformStep({
      id: "read-file",
      name: "Read Note File",
      transform: async (ctx): Promise<{
        content: string;
        data: Record<string, unknown>;
        body: string;
        attachments: string[];
        urls: string[];
      }> => {
        const trigger = ctx.trigger as NewNoteExtractTrigger;

        logger.info({
          event: "workflow.read_file",
          filePath: trigger.filePath,
        });

        const content = await fs.readFile(trigger.filePath, "utf-8");
        const parsed = parseFrontmatter(content);
        const attachments = extractAttachments(parsed.content);
        const urls = extractUrls(parsed.content);

        return {
          content,
          data: parsed.data,
          body: parsed.content,
          attachments,
          urls,
        };
      },
      outputKey: "fileData",
    })
  )

  // Step 2: Process based on content type - Audio
  .step(
    defineToolStep({
      id: "extract-audio",
      name: "Extract Audio Content",
      toolName: "extract-audio",
      input: (ctx) => {
        const trigger = ctx.trigger as NewNoteExtractTrigger;
        const fileData = ctx.variables.fileData as { attachments?: string[] } | undefined;

        if (!fileData?.attachments) {
          throw new Error("No file data available");
        }

        // Find the first audio attachment
        const audioExtensions = [".mp3", ".wav", ".ogg", ".webm", ".m4a"];
        const audioAttachment = fileData.attachments.find((a) =>
          audioExtensions.some((ext) => a.toLowerCase().endsWith(ext))
        );

        if (!audioAttachment) {
          throw new Error("No audio attachment found");
        }

        return {
          filePath: getAttachmentPath(trigger.filePath, audioAttachment),
          openaiApiKey: trigger.openaiApiKey,
          openaiModel: trigger.openaiModel,
        };
      },
      condition: {
        evaluate: (ctx) => (ctx.trigger as NewNoteExtractTrigger).contentType === "audio",
      },
    })
  )

  // Step 3: Process based on content type - Video
  .step(
    defineToolStep({
      id: "extract-video",
      name: "Extract Video Content",
      toolName: "extract-video",
      input: (ctx) => {
        const trigger = ctx.trigger as NewNoteExtractTrigger;
        const fileData = ctx.variables.fileData as { attachments?: string[] } | undefined;

        if (!fileData?.attachments) {
          throw new Error("No file data available");
        }

        const videoExtensions = [".mp4", ".webm", ".mov", ".avi", ".mkv"];
        const videoAttachment = fileData.attachments.find((a) =>
          videoExtensions.some((ext) => a.toLowerCase().endsWith(ext))
        );

        if (!videoAttachment) {
          throw new Error("No video attachment found");
        }

        return {
          filePath: getAttachmentPath(trigger.filePath, videoAttachment),
        };
      },
      condition: {
        evaluate: (ctx) => (ctx.trigger as NewNoteExtractTrigger).contentType === "video",
      },
    })
  )

  // Step 4: Process based on content type - Image
  .step(
    defineToolStep({
      id: "extract-image",
      name: "Extract Image Content",
      toolName: "extract-image",
      input: (ctx) => {
        const trigger = ctx.trigger as NewNoteExtractTrigger;
        const fileData = ctx.variables.fileData as { attachments?: string[] } | undefined;

        if (!fileData?.attachments) {
          throw new Error("No file data available");
        }

        // Note: .svg is not supported by OpenAI vision API
        const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
        const imageAttachment = fileData.attachments.find((a) =>
          imageExtensions.some((ext) => a.toLowerCase().endsWith(ext))
        );

        if (!imageAttachment) {
          throw new Error("No image attachment found");
        }

        return {
          filePath: getAttachmentPath(trigger.filePath, imageAttachment),
          openaiApiKey: trigger.openaiApiKey,
          openaiModel: trigger.openaiModel,
        };
      },
      condition: {
        evaluate: (ctx) => (ctx.trigger as NewNoteExtractTrigger).contentType === "image",
      },
    })
  )

  // Step 5: Process based on content type - URL
  .step(
    defineToolStep({
      id: "extract-url",
      name: "Extract URL Content",
      toolName: "extract-url",
      input: (ctx) => {
        const trigger = ctx.trigger as NewNoteExtractTrigger;
        const fileData = ctx.variables.fileData as { urls?: string[] } | undefined;

        if (!fileData?.urls || fileData.urls.length === 0) {
          throw new Error("No URLs found in content");
        }

        return {
          url: fileData.urls[0], // Process the first URL
          textLlmProvider: trigger.textLlmProvider,
          textLlmApiKey: trigger.textLlmApiKey,
          textLlmModel: trigger.textLlmModel,
        };
      },
      condition: {
        evaluate: (ctx) => (ctx.trigger as NewNoteExtractTrigger).contentType === "url",
      },
    })
  )

  // Step 6: Process based on content type - Document
  .step(
    defineToolStep({
      id: "extract-document",
      name: "Extract Document Content",
      toolName: "extract-document",
      input: (ctx) => {
        const trigger = ctx.trigger as NewNoteExtractTrigger;
        const fileData = ctx.variables.fileData as { attachments?: string[] } | undefined;

        if (!fileData?.attachments) {
          throw new Error("No file data available");
        }

        // Find the first document attachment
        const documentExtensions = [".pdf", ".doc", ".docx", ".txt", ".md", ".markdown", ".rtf", ".odt", ".csv", ".rst"];
        const documentAttachment = fileData.attachments.find((a) =>
          documentExtensions.some((ext) => a.toLowerCase().endsWith(ext))
        );

        if (!documentAttachment) {
          throw new Error("No document attachment found");
        }

        return {
          filePath: getAttachmentPath(trigger.filePath, documentAttachment),
          openaiApiKey: trigger.openaiApiKey,
          openaiModel: trigger.documentAnalysisModel,
        };
      },
      condition: {
        evaluate: (ctx) => (ctx.trigger as NewNoteExtractTrigger).contentType === "document",
      },
    })
  )

  // Step 7: Update the file with extracted content
  .step(
    defineTransformStep({
      id: "update-file",
      name: "Update File with Extracted Content",
      transform: async (ctx): Promise<NewNoteExtractResult> => {
        const trigger = ctx.trigger as NewNoteExtractTrigger;
        const fileData = ctx.variables.fileData as {
          content: string;
          data: Record<string, unknown>;
          body: string;
        } | undefined;

        // Check if fileData is available
        if (!fileData || !fileData.data) {
          logger.error({
            event: "workflow.update_file.no_file_data",
            filePath: trigger.filePath,
            hasFileData: !!fileData,
            hasData: !!(fileData?.data),
          });
          throw new Error("File data not available from read-file step");
        }

        let extractedContent: unknown;
        let formattedExtraction = "";

        // Log available step outputs for debugging
        logger.debug({
          event: "workflow.update_file.step_outputs",
          filePath: trigger.filePath,
          contentType: trigger.contentType,
          availableSteps: Object.keys(ctx.stepOutputs),
          extractStepOutput: ctx.stepOutputs[`extract-${trigger.contentType}`],
        });

        // Get the extracted content based on type
        // Tool step outputs are wrapped as { result: <tool output>, metadata: ... }
        switch (trigger.contentType) {
          case "audio": {
            const audioResult = ctx.stepOutputs["extract-audio"] as { result?: AudioExtractionResult };
            if (audioResult?.result) {
              extractedContent = audioResult.result;
              formattedExtraction = formatAudioExtraction(audioResult.result);
            }
            break;
          }
          case "video": {
            const videoResult = ctx.stepOutputs["extract-video"] as { result?: VideoExtractionResult };
            if (videoResult?.result) {
              extractedContent = videoResult.result;
              formattedExtraction = formatVideoExtraction(videoResult.result);
            }
            break;
          }
          case "image": {
            const imageResult = ctx.stepOutputs["extract-image"] as { result?: ImageExtractionResult };
            if (imageResult?.result) {
              extractedContent = imageResult.result;
              formattedExtraction = formatImageExtraction(imageResult.result);
            }
            break;
          }
          case "url": {
            const urlResult = ctx.stepOutputs["extract-url"] as { result?: UrlExtractionResult };
            if (urlResult?.result) {
              extractedContent = urlResult.result;
              formattedExtraction = formatUrlExtraction(urlResult.result);
            }
            break;
          }
          case "document": {
            const documentResult = ctx.stepOutputs["extract-document"] as { result?: DocumentExtractionResult };
            if (documentResult?.result) {
              extractedContent = documentResult.result;
              formattedExtraction = formatDocumentExtraction(documentResult.result);
            }
            break;
          }
          case "text": {
            // No extraction needed for text
            formattedExtraction = "";
            break;
          }
        }

        // Log warning if no extraction was found for non-text content
        if (trigger.contentType !== "text" && !extractedContent) {
          logger.warn({
            event: "workflow.update_file.no_extraction",
            filePath: trigger.filePath,
            contentType: trigger.contentType,
            stepOutputKeys: Object.keys(ctx.stepOutputs),
          });
        }

        // Update frontmatter
        fileData.data.status = "extracted";
        fileData.data.extractedAt = new Date().toISOString();
        fileData.data.contentType = trigger.contentType;

        // Wrap original content (trimStart to avoid accumulating empty lines)
        const trimmedBody = fileData.body.trimStart();
        let newBody = trimmedBody;
        if (formattedExtraction) {
          // Add extracted content before original
          newBody = `${formattedExtraction}\n\n---\n\n## Original Content\n\n${trimmedBody}`;
        }

        // Build new content using gray-matter
        const newContent = buildMarkdown(fileData.data, newBody);

        // Write updated file
        await fs.writeFile(trigger.filePath, newContent, "utf-8");

        logger.info({
          event: "workflow.file_updated",
          filePath: trigger.filePath,
          contentType: trigger.contentType,
        });

        return {
          success: true,
          filePath: trigger.filePath,
          contentType: trigger.contentType,
          extractedContent,
        };
      },
    })
  )

  // Set entry step
  .entryStep("read-file")

  // Define transitions
  .transition("read-file", ["extract-audio", "extract-video", "extract-image", "extract-url", "extract-document", "update-file"])
  .transition("extract-audio", "update-file")
  .transition("extract-video", "update-file")
  .transition("extract-image", "update-file")
  .transition("extract-url", "update-file")
  .transition("extract-document", "update-file")

  // Lifecycle hooks
  .onStart(async (instance) => {
    logger.info({
      event: "workflow.started",
      instanceId: instance.id,
      trigger: instance.trigger,
    });
  })
  .onComplete(async (instance, result) => {
    logger.info({
      event: "workflow.completed",
      instanceId: instance.id,
      result,
    });
  })
  .onFailed(async (instance, error: unknown) => {
    const trigger = instance.trigger as NewNoteExtractTrigger;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const maxRetries = trigger.maxRetries ?? 5;

    logger.error({
      event: "workflow.failed",
      instanceId: instance.id,
      filePath: trigger.filePath,
      error: errorMessage,
      maxRetries,
    });

    // Update file with error details and schedule retry if applicable
    try {
      const result = await updateFileWithError(trigger.filePath, errorMessage, maxRetries);

      if (result.shouldRetry) {
        logger.info({
          event: "workflow.retry_scheduled",
          instanceId: instance.id,
          filePath: trigger.filePath,
          retryNum: result.retryNum,
          nextRetryAt: result.nextRetryAt?.toISOString(),
        });
      } else {
        logger.warn({
          event: "workflow.max_retries_exceeded",
          instanceId: instance.id,
          filePath: trigger.filePath,
          totalAttempts: result.retryNum,
        });
      }
    } catch (updateErr) {
      logger.error({
        event: "workflow.error_update_failed",
        instanceId: instance.id,
        error: updateErr instanceof Error ? updateErr.message : String(updateErr),
      });
    }
  })

  .build();

export default newNoteExtractWorkflow;
