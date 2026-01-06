/**
 * Agentic Workflow System - Type Definitions
 *
 * This module defines the core types for the agentic workflow system,
 * which enables multi-step, LLM-driven task execution with parallel
 * processing and tool integration.
 */

import type { z } from "zod";

// =============================================================================
// Core Enums
// =============================================================================

/**
 * Status of a workflow instance
 */
export type WorkflowStatus =
  | "pending" // Waiting to start
  | "running" // Currently executing
  | "paused" // Temporarily paused (awaiting input)
  | "completed" // Successfully finished
  | "failed" // Failed with error
  | "cancelled"; // Manually cancelled

/**
 * Status of an individual step execution
 */
export type StepStatus =
  | "pending" // Not yet started
  | "running" // Currently executing
  | "completed" // Successfully finished
  | "failed" // Failed with error
  | "skipped"; // Skipped due to condition

/**
 * Types of steps in a workflow
 */
export type StepType =
  | "llm-call" // Makes an LLM API call
  | "tool-call" // Calls a registered tool
  | "decision" // LLM decides next step(s)
  | "parallel" // Runs multiple steps concurrently
  | "transform" // Transforms data without LLM
  | "condition" // Conditional branching
  | "loop"; // Iterative execution

/**
 * Priority levels for workflow execution
 */
export enum WorkflowPriority {
  LOW = 0,
  NORMAL = 10,
  HIGH = 20,
  URGENT = 100,
}

// =============================================================================
// LLM Configuration
// =============================================================================

/**
 * Configuration for LLM provider
 */
export interface LLMConfig {
  provider: "anthropic" | "openai" | "ollama" | "custom";
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

/**
 * Message format for LLM calls
 */
export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Response from an LLM call
 */
export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
  raw?: unknown;
}

/**
 * Structured output configuration for LLM calls
 */
export interface LLMStructuredOutput<T = unknown> {
  schema: z.ZodSchema<T>;
  name?: string;
  description?: string;
}

// =============================================================================
// Tool Definitions
// =============================================================================

/**
 * Parameter definition for a tool
 */
export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
  default?: unknown;
  schema?: z.ZodSchema;
}

/**
 * Definition of a tool that can be called by workflows
 */
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  category?: string;
  parameters: ToolParameter[];
  inputSchema?: z.ZodSchema<TInput>;
  outputSchema?: z.ZodSchema<TOutput>;
  execute: (input: TInput, context: ToolContext) => Promise<ToolResult<TOutput>>;
}

/**
 * Context passed to tool execution
 */
export interface ToolContext {
  workflowId: string;
  stepId: string;
  userId?: string;
  signal: AbortSignal;
  logger: ToolLogger;
}

/**
 * Logger interface for tools
 */
export interface ToolLogger {
  debug: (msg: string, data?: Record<string, unknown>) => void;
  info: (msg: string, data?: Record<string, unknown>) => void;
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
}

/**
 * Result of a tool execution
 */
export interface ToolResult<T = unknown> {
  success: boolean;
  output?: T;
  error?: string;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Step Definitions
// =============================================================================

/**
 * Base configuration for all step types
 */
export interface BaseStepConfig {
  id: string;
  name: string;
  description?: string;
  type: StepType;
  retryConfig?: StepRetryConfig;
  timeout?: number;
  condition?: StepCondition;
}

/**
 * Retry configuration for steps
 */
export interface StepRetryConfig {
  maxRetries: number;
  backoffMs?: number;
  backoffMultiplier?: number;
  maxBackoffMs?: number;
}

/**
 * Condition for step execution
 */
export interface StepCondition {
  /**
   * JavaScript expression evaluated against workflow context
   * e.g., "context.variables.shouldProcess === true"
   */
  expression?: string;
  /**
   * Function to evaluate condition
   */
  evaluate?: (context: WorkflowContext) => boolean;
}

/**
 * Configuration for LLM call steps
 */
export interface LLMStepConfig extends BaseStepConfig {
  type: "llm-call";
  llmConfig?: Partial<LLMConfig>;
  systemPrompt?: string | ((context: WorkflowContext) => string);
  userPrompt: string | ((context: WorkflowContext) => string);
  structuredOutput?: LLMStructuredOutput;
  tools?: string[]; // Tool names to make available to LLM
}

/**
 * Configuration for tool call steps
 */
export interface ToolStepConfig extends BaseStepConfig {
  type: "tool-call";
  toolName: string;
  input: Record<string, unknown> | ((context: WorkflowContext) => Record<string, unknown>);
}

/**
 * Configuration for decision steps (LLM picks next step(s))
 */
export interface DecisionStepConfig extends BaseStepConfig {
  type: "decision";
  llmConfig?: Partial<LLMConfig>;
  prompt: string | ((context: WorkflowContext) => string);
  options: DecisionOption[];
  allowMultiple?: boolean; // Can select multiple next steps
}

/**
 * An option for a decision step
 */
export interface DecisionOption {
  id: string;
  name: string;
  description: string;
  nextStepId: string | string[];
}

/**
 * Configuration for parallel steps
 */
export interface ParallelStepConfig extends BaseStepConfig {
  type: "parallel";
  steps: string[]; // IDs of steps to run in parallel
  waitForAll?: boolean; // Wait for all to complete (default true)
  failFast?: boolean; // Fail if any step fails
}

/**
 * Configuration for transform steps
 */
export interface TransformStepConfig extends BaseStepConfig {
  type: "transform";
  transform: (context: WorkflowContext) => unknown | Promise<unknown>;
  outputKey?: string; // Key to store result in variables
}

/**
 * Configuration for condition steps
 */
export interface ConditionStepConfig extends BaseStepConfig {
  type: "condition";
  condition: StepCondition;
  thenStepId: string;
  elseStepId?: string;
}

/**
 * Configuration for loop steps
 */
export interface LoopStepConfig extends BaseStepConfig {
  type: "loop";
  itemsKey: string; // Key in variables containing items to iterate
  itemKey: string; // Key to store current item
  bodyStepId: string;
  maxIterations?: number;
}

/**
 * Union type for all step configurations
 */
export type StepConfig =
  | LLMStepConfig
  | ToolStepConfig
  | DecisionStepConfig
  | ParallelStepConfig
  | TransformStepConfig
  | ConditionStepConfig
  | LoopStepConfig;

// =============================================================================
// Step Execution
// =============================================================================

/**
 * Result of step execution
 */
export interface StepResult<T = unknown> {
  success: boolean;
  output?: T;
  error?: string;
  nextStepIds?: string[]; // Explicitly set next steps
  shouldRetry?: boolean;
  skipRemaining?: boolean; // End workflow early
  variables?: Record<string, unknown>; // Variables to add to context
}

/**
 * Record of a step execution in the database
 */
export interface StepExecutionRecord {
  id: string;
  workflowInstanceId: string;
  stepId: string;
  stepName: string;
  stepType: StepType;
  status: StepStatus;
  input: string | null; // JSON
  output: string | null; // JSON
  error: string | null;
  retryCount: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// Workflow Definition
// =============================================================================

/**
 * Transition between steps
 */
export interface StepTransition {
  from: string;
  to: string | string[];
  condition?: StepCondition;
}

/**
 * Definition of a workflow
 */
export interface WorkflowDefinition<TTrigger = unknown, TResult = unknown> {
  id: string;
  name: string;
  description?: string;
  version?: string;
  defaultPriority?: WorkflowPriority;
  defaultTimeout?: number;

  // Trigger configuration
  triggerSchema?: z.ZodSchema<TTrigger>;

  // Result configuration
  resultSchema?: z.ZodSchema<TResult>;

  // Step definitions
  steps: Map<string, StepConfig> | Record<string, StepConfig>;

  // Workflow structure
  entryStepId: string;
  transitions?: StepTransition[];

  // Default LLM configuration for all steps
  defaultLLMConfig?: Partial<LLMConfig>;

  // Lifecycle hooks
  onStart?: (instance: WorkflowInstance) => Promise<void>;
  onComplete?: (instance: WorkflowInstance, result: TResult) => Promise<void>;
  onFailed?: (instance: WorkflowInstance, error: string) => Promise<void>;
  onStepComplete?: (instance: WorkflowInstance, step: StepExecutionRecord) => Promise<void>;
}

// =============================================================================
// Workflow Instance
// =============================================================================

/**
 * Runtime instance of a workflow
 */
export interface WorkflowInstance<TTrigger = unknown> {
  id: string;
  workflowId: string;
  status: WorkflowStatus;
  priority: number;
  trigger: TTrigger;
  context: WorkflowContext;
  currentStepIds: string[];
  result: unknown | null;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  userId?: string;
  jobId?: string; // Reference to async job
}

/**
 * Context that flows through the workflow
 */
export interface WorkflowContext<TTrigger = unknown> {
  trigger: TTrigger;
  variables: Record<string, unknown>;
  stepOutputs: Record<string, unknown>;
  metadata: WorkflowMetadata;
}

/**
 * Metadata about the workflow execution
 */
export interface WorkflowMetadata {
  workflowId: string;
  instanceId: string;
  startedAt: Date;
  currentStep?: string;
  previousSteps: string[];
  executionPath: string[];
  iterationCount?: number;
}

// =============================================================================
// Orchestrator Configuration
// =============================================================================

/**
 * Configuration for the workflow orchestrator
 */
export interface OrchestratorConfig {
  defaultLLMConfig: LLMConfig;
  maxConcurrentWorkflows?: number;
  maxConcurrentStepsPerWorkflow?: number;
  defaultStepTimeout?: number;
  defaultRetryConfig?: StepRetryConfig;
}

// =============================================================================
// Events
// =============================================================================

/**
 * Events emitted during workflow execution
 */
export type WorkflowEvent =
  | { type: "workflow:started"; instance: WorkflowInstance }
  | { type: "workflow:completed"; instance: WorkflowInstance; result: unknown }
  | { type: "workflow:failed"; instance: WorkflowInstance; error: string }
  | { type: "workflow:paused"; instance: WorkflowInstance }
  | { type: "workflow:resumed"; instance: WorkflowInstance }
  | { type: "step:started"; instance: WorkflowInstance; step: StepExecutionRecord }
  | { type: "step:completed"; instance: WorkflowInstance; step: StepExecutionRecord; output: unknown }
  | { type: "step:failed"; instance: WorkflowInstance; step: StepExecutionRecord; error: string }
  | { type: "step:retrying"; instance: WorkflowInstance; step: StepExecutionRecord; attempt: number }
  | { type: "llm:called"; instance: WorkflowInstance; stepId: string; prompt: string }
  | { type: "llm:responded"; instance: WorkflowInstance; stepId: string; response: LLMResponse }
  | { type: "tool:called"; instance: WorkflowInstance; stepId: string; toolName: string; input: unknown }
  | { type: "tool:completed"; instance: WorkflowInstance; stepId: string; toolName: string; result: ToolResult }
  | { type: "decision:made"; instance: WorkflowInstance; stepId: string; selectedOptions: string[] };

export type WorkflowEventHandler = (event: WorkflowEvent) => void | Promise<void>;

// =============================================================================
// Database Records
// =============================================================================

/**
 * Workflow instance record in database
 */
export interface WorkflowInstanceRecord {
  id: string;
  workflowId: string;
  status: WorkflowStatus;
  priority: number;
  trigger: string; // JSON
  context: string; // JSON
  currentStepIds: string; // JSON array
  result: string | null; // JSON
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  userId: string | null;
  jobId: string | null;
}

// =============================================================================
// Helper Types
// =============================================================================

/**
 * Configuration for creating a new workflow instance
 */
export interface CreateWorkflowInstanceConfig<TTrigger = unknown> {
  workflowId: string;
  trigger: TTrigger;
  priority?: WorkflowPriority;
  userId?: string;
  variables?: Record<string, unknown>;
}

/**
 * Options for listing workflow instances
 */
export interface ListWorkflowInstancesOptions {
  workflowId?: string;
  status?: WorkflowStatus | WorkflowStatus[];
  userId?: string;
  limit?: number;
  offset?: number;
  orderBy?: "createdAt" | "updatedAt" | "priority";
  order?: "asc" | "desc";
}

/**
 * Statistics about workflow executions
 */
export interface WorkflowStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  paused: number;
  cancelled: number;
  total: number;
  byWorkflow: Record<string, number>;
}
