/**
 * Example Workflows
 *
 * Example workflow implementations demonstrating different patterns.
 */

export {
  contentProcessingWorkflow,
  ContentTriggerSchema,
  ContentResultSchema,
  type ContentTrigger,
  type ContentResult,
} from "./content-processing-workflow";

export {
  newNoteExtractWorkflow,
  NewNoteExtractTriggerSchema,
  NewNoteExtractResultSchema,
  type NewNoteExtractTrigger,
  type NewNoteExtractResult,
} from "./new-note-extract-workflow";
