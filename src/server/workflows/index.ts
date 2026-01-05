/**
 * Agentic Workflow System
 *
 * A system for building and executing multi-step, LLM-driven workflows
 * with parallel execution, tool integration, and fault tolerance.
 *
 * @module workflows
 */

// =============================================================================
// Types
// =============================================================================

export type {
  // Core types
  WorkflowStatus,
  StepStatus,
  StepType,
  LLMConfig,
  LLMMessage,
  LLMResponse,
  LLMStructuredOutput,

  // Tool types
  ToolParameter,
  ToolDefinition,
  ToolContext,
  ToolLogger,
  ToolResult,

  // Step configuration types
  BaseStepConfig,
  StepRetryConfig,
  StepCondition,
  LLMStepConfig,
  ToolStepConfig,
  DecisionStepConfig,
  DecisionOption,
  ParallelStepConfig,
  TransformStepConfig,
  ConditionStepConfig,
  LoopStepConfig,
  StepConfig,

  // Step execution types
  StepResult,
  StepExecutionRecord,

  // Workflow types
  StepTransition,
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowContext,
  WorkflowMetadata,

  // Orchestrator types
  OrchestratorConfig,

  // Event types
  WorkflowEvent,
  WorkflowEventHandler,

  // Database types
  WorkflowInstanceRecord,

  // Helper types
  CreateWorkflowInstanceConfig,
  ListWorkflowInstancesOptions,
  WorkflowStats,
} from "./types";

export { WorkflowPriority } from "./types";

// =============================================================================
// Steps
// =============================================================================

export {
  // Base step
  BaseStep,
  DEFAULT_STEP_RETRY_CONFIG,
  DEFAULT_STEP_TIMEOUT,
  evaluateConditionExpression,
  createCondition,
  createConditionFn,
  defineStep,
  isStepType,
  type StepExecutionContext,

  // LLM step
  LLMStep,
  DEFAULT_LLM_CONFIG,
  AnthropicProvider,
  OpenAIProvider,
  registerLLMProvider,
  getLLMProvider,
  defineLLMStep,
  LLMOutputSchemas,
  type LLMProvider,
  type LLMCallOptions,
  type LLMToolDefinition,
  type LLMToolCall,
  type LLMResponseWithTools,

  // Tool step
  ToolStep,
  ToolRegistry,
  defineToolStep,
  defineTool,
  ToolSchemas,
  echoTool,
  delayTool,
  randomTool,
  jsonParseTool,
  jsonStringifyTool,
  registerBuiltInTools,

  // Decision step
  DecisionStep,
  defineDecisionStep,
  defineDecisionOption,

  // Control steps
  ParallelStep,
  TransformStep,
  ConditionStep,
  LoopStep,
  defineParallelStep,
  defineTransformStep,
  defineConditionStep,
  defineLoopStep,
  createStep,
} from "./steps";

// =============================================================================
// Workflow Definition
// =============================================================================

export {
  BaseWorkflow,
  WorkflowBuilder,
  workflow,
  defineWorkflow,
  WorkflowTemplates,
} from "./base-workflow";

// =============================================================================
// Orchestrator
// =============================================================================

export {
  WorkflowOrchestrator,
  DEFAULT_ORCHESTRATOR_CONFIG,
  getOrchestrator,
  resetOrchestrator,
} from "./orchestrator";

// =============================================================================
// Registry
// =============================================================================

export {
  WorkflowRegistry,
  RegisterWorkflow,
  initializeWorkflows,
} from "./registry";

// =============================================================================
// Job Integration
// =============================================================================

export {
  workflowExecutionJob,
  createWorkflowJob,
  executeWorkflow,
  scheduleWorkflow,
  type WorkflowJobPayload,
  type WorkflowJobResult,
} from "./workflow-job";

// =============================================================================
// Initialization
// =============================================================================

import { JobRegistry } from "@/server/jobs";
import { workflowExecutionJob } from "./workflow-job";
import { registerBuiltInTools } from "./steps";

/**
 * Initialize the workflow system
 *
 * Call this during application startup to:
 * - Register the workflow execution job
 * - Register built-in tools
 */
export function initializeWorkflowSystem(): void {
  // Register workflow job with job queue
  JobRegistry.register(workflowExecutionJob);

  // Register built-in tools
  registerBuiltInTools();
}
