/**
 * Content Processing Workflow - Example workflow
 *
 * Demonstrates a multi-step workflow that:
 * 1. Receives content as a trigger
 * 2. Uses LLM to analyze and classify the content
 * 3. Makes a decision on how to process it
 * 4. Executes the appropriate action (in parallel if needed)
 * 5. Generates a summary
 *
 * This is an example of a workflow with:
 * - Static structure (defined steps and general flow)
 * - Dynamic parts (LLM decides processing path)
 */

import { z } from "zod";
import {
  workflow,
  defineLLMStep,
  defineDecisionStep,
  defineToolStep,
  defineTransformStep,
  defineParallelStep,
  WorkflowPriority,
} from "../index";
import type { WorkflowContext } from "../types";

// =============================================================================
// Schemas
// =============================================================================

/**
 * Trigger schema - what data starts the workflow
 */
export const ContentTriggerSchema = z.object({
  content: z.string().describe("The content to process"),
  contentType: z.enum(["text", "url", "file"]).optional(),
  metadata: z
    .object({
      source: z.string().optional(),
      timestamp: z.string().optional(),
      userId: z.string().optional(),
    })
    .optional(),
});

export type ContentTrigger = z.infer<typeof ContentTriggerSchema>;

/**
 * Classification result schema
 */
const ClassificationSchema = z.object({
  category: z.enum([
    "article",
    "note",
    "task",
    "reference",
    "quote",
    "media",
    "other",
  ]),
  confidence: z.number().min(0).max(1),
  suggestedTags: z.array(z.string()),
  summary: z.string(),
  sentiment: z.enum(["positive", "neutral", "negative"]).optional(),
  isActionable: z.boolean(),
});

/**
 * Result schema
 */
export const ContentResultSchema = z.object({
  classification: ClassificationSchema,
  processedContent: z.string(),
  actions: z.array(z.string()),
  finalSummary: z.string(),
});

export type ContentResult = z.infer<typeof ContentResultSchema>;

// =============================================================================
// Workflow Definition
// =============================================================================

/**
 * Content Processing Workflow
 *
 * A workflow that analyzes, classifies, and processes incoming content
 * using LLM-driven decision making.
 */
export const contentProcessingWorkflow = workflow("content-processing", "Content Processing Workflow")
  .description("Analyzes and processes incoming content using AI")
  .version("1.0.0")
  .priority(WorkflowPriority.NORMAL)
  .trigger(ContentTriggerSchema)
  .result(ContentResultSchema)
  .llmConfig({
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    temperature: 0.5,
  })

  // Entry step: Analyze and classify the content
  .step(
    defineLLMStep({
      id: "classify",
      name: "Classify Content",
      description: "Analyze and classify the incoming content",
      systemPrompt: `You are a content classification assistant. Analyze the provided content and classify it according to the schema.

Consider:
- What type of content is this? (article, note, task, reference, quote, media, other)
- What are relevant tags for organizing this content?
- Is this content actionable (requires follow-up)?
- What is the overall sentiment?

Be thorough but concise in your analysis.`,
      userPrompt: (ctx) => `
Please analyze and classify the following content:

---
${(ctx.trigger as ContentTrigger).content}
---

${(ctx.trigger as ContentTrigger).metadata?.source ? `Source: ${(ctx.trigger as ContentTrigger).metadata?.source}` : ""}
${(ctx.trigger as ContentTrigger).contentType ? `Content Type: ${(ctx.trigger as ContentTrigger).contentType}` : ""}
`,
      structuredOutput: {
        schema: ClassificationSchema,
        name: "classify_content",
        description: "Classify the content",
      },
    })
  )

  // Store classification in variables
  .step(
    defineTransformStep({
      id: "store-classification",
      name: "Store Classification",
      transform: (ctx) => {
        const classification = (ctx.stepOutputs["classify"] as { content: z.infer<typeof ClassificationSchema> })?.content;
        return classification;
      },
      outputKey: "classification",
    })
  )

  // Decision step: Decide what processing to do
  .step(
    defineDecisionStep({
      id: "decide-action",
      name: "Decide Processing Action",
      prompt: (ctx) => {
        const classification = ctx.variables.classification as z.infer<typeof ClassificationSchema>;
        return `Based on the content classification, decide what processing actions to take.

Classification:
- Category: ${classification.category}
- Confidence: ${classification.confidence}
- Is Actionable: ${classification.isActionable}
- Sentiment: ${classification.sentiment}
- Tags: ${classification.suggestedTags.join(", ")}

What actions should we take?`;
      },
      options: [
        {
          id: "enrich",
          name: "Enrich Content",
          description: "Add additional context and metadata to the content",
          nextStepId: "enrich-content",
        },
        {
          id: "extract-tasks",
          name: "Extract Tasks",
          description: "Extract actionable tasks from the content",
          nextStepId: "extract-tasks",
        },
        {
          id: "summarize-only",
          name: "Summarize Only",
          description: "Just create a summary without additional processing",
          nextStepId: "summarize",
        },
        {
          id: "full-processing",
          name: "Full Processing",
          description: "Run all processing steps in parallel",
          nextStepId: "parallel-process",
        },
      ],
      allowMultiple: false,
    })
  )

  // Enrich content step
  .step(
    defineLLMStep({
      id: "enrich-content",
      name: "Enrich Content",
      systemPrompt: "You are a content enrichment assistant. Add context, related concepts, and helpful annotations to the content.",
      userPrompt: (ctx) => `
Enrich the following content with additional context:

${(ctx.trigger as ContentTrigger).content}

Add:
1. Key concepts explained
2. Related topics
3. Historical context if relevant
4. Helpful annotations
`,
    })
  )

  // Extract tasks step
  .step(
    defineLLMStep({
      id: "extract-tasks",
      name: "Extract Tasks",
      systemPrompt: "You are a task extraction assistant. Identify actionable items from content.",
      userPrompt: (ctx) => `
Extract actionable tasks from the following content:

${(ctx.trigger as ContentTrigger).content}

For each task, provide:
- Task description
- Priority (high/medium/low)
- Suggested deadline if applicable
`,
      structuredOutput: {
        schema: z.object({
          tasks: z.array(
            z.object({
              description: z.string(),
              priority: z.enum(["high", "medium", "low"]),
              deadline: z.string().optional(),
            })
          ),
        }),
        name: "extract_tasks",
      },
    })
  )

  // Parallel processing step
  .step(
    defineParallelStep({
      id: "parallel-process",
      name: "Parallel Processing",
      steps: ["enrich-content", "extract-tasks"],
      waitForAll: true,
      failFast: false,
    })
  )

  // Summarize step
  .step(
    defineLLMStep({
      id: "summarize",
      name: "Generate Summary",
      systemPrompt: "You are a summarization assistant. Create concise, informative summaries.",
      userPrompt: (ctx) => {
        const trigger = ctx.trigger as ContentTrigger;
        const classification = ctx.variables.classification as z.infer<typeof ClassificationSchema>;
        const enrichment = ctx.stepOutputs["enrich-content"];
        const tasks = ctx.stepOutputs["extract-tasks"];

        return `
Create a final summary of the processed content.

Original Content:
${trigger.content}

Classification: ${classification.category}
Tags: ${classification.suggestedTags.join(", ")}

${enrichment ? `Enrichment: ${JSON.stringify(enrichment)}` : ""}
${tasks ? `Extracted Tasks: ${JSON.stringify(tasks)}` : ""}

Provide a comprehensive but concise summary.
`;
      },
      structuredOutput: {
        schema: z.object({
          summary: z.string(),
          keyPoints: z.array(z.string()),
          nextSteps: z.array(z.string()).optional(),
        }),
        name: "create_summary",
      },
    })
  )

  // Final transform to create result
  .step(
    defineTransformStep({
      id: "finalize",
      name: "Finalize Result",
      transform: (ctx): ContentResult => {
        const trigger = ctx.trigger as ContentTrigger;
        const classification = ctx.variables.classification as z.infer<typeof ClassificationSchema>;
        const summary = ctx.stepOutputs["summarize"] as { content: { summary: string; keyPoints: string[] } };
        const enrichment = ctx.stepOutputs["enrich-content"] as { content: string } | undefined;
        const tasks = ctx.stepOutputs["extract-tasks"] as { content: { tasks: Array<{ description: string }> } } | undefined;

        const actions: string[] = [];
        if (enrichment) actions.push("enriched");
        if (tasks?.content?.tasks?.length) {
          actions.push(`extracted ${tasks.content.tasks.length} tasks`);
        }
        actions.push("summarized");

        return {
          classification,
          processedContent: enrichment?.content ?? trigger.content,
          actions,
          finalSummary: summary?.content?.summary ?? classification.summary,
        };
      },
    })
  )

  // Set entry step
  .entryStep("classify")

  // Define transitions
  .transition("classify", "store-classification")
  .transition("store-classification", "decide-action")
  // Decision step handles its own transitions via options
  .transition("enrich-content", "summarize")
  .transition("extract-tasks", "summarize")
  .transition("parallel-process", "summarize")
  .transition("summarize", "finalize")

  // Lifecycle hooks
  .onStart(async (instance) => {
    console.log(`[Content Workflow] Started: ${instance.id}`);
  })
  .onComplete(async (instance, result) => {
    console.log(`[Content Workflow] Completed: ${instance.id}`);
    console.log(`[Content Workflow] Result:`, result);
  })
  .onFailed(async (instance, error) => {
    console.error(`[Content Workflow] Failed: ${instance.id}`, error);
  })

  // Build the workflow
  .build();

export default contentProcessingWorkflow;
