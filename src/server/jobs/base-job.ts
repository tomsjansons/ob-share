/**
 * Base Job Class
 *
 * Provides utilities for defining job types with idempotent phases.
 * Extend this class to create specific job implementations.
 */

import type {
  JobDefinition,
  PhaseDefinition,
  PhaseContext,
  PhaseResult,
  JobPriority,
} from "./types";

/**
 * Abstract base class for creating job definitions.
 *
 * Usage:
 * ```typescript
 * class MyJob extends BaseJob<MyPayload> {
 *   type = "my-job";
 *   description = "Processes something async";
 *
 *   protected definePhases() {
 *     return [
 *       this.phase("validate", async (ctx) => {
 *         // Validation logic
 *         return { success: true, output: { validated: true } };
 *       }),
 *       this.phase("process", async (ctx) => {
 *         // Main processing
 *         return { success: true };
 *       }),
 *     ];
 *   }
 * }
 * ```
 */
export abstract class BaseJob<TPayload = unknown>
  implements JobDefinition<TPayload>
{
  abstract readonly type: string;
  description?: string;
  defaultPriority?: JobPriority;
  defaultMaxRetries?: number;

  private _phases: PhaseDefinition<TPayload, unknown, unknown>[] | null = null;

  /**
   * Get the phases for this job type.
   * Phases are lazily initialized on first access.
   */
  get phases(): PhaseDefinition<TPayload, unknown, unknown>[] {
    if (!this._phases) {
      this._phases = this.definePhases();
    }
    return this._phases;
  }

  /**
   * Define the phases for this job.
   * Override this method to specify the job's execution phases.
   */
  protected abstract definePhases(): PhaseDefinition<
    TPayload,
    unknown,
    unknown
  >[];

  /**
   * Helper to create a phase definition with proper typing.
   */
  protected phase<TInput = unknown, TOutput = unknown>(
    name: string,
    execute: (ctx: PhaseContext<TPayload, TInput>) => Promise<PhaseResult<TOutput>>,
    options?: {
      maxRetries?: number;
      transformInput?: (previousOutput: unknown, payload: TPayload) => TInput | null;
      shouldRun?: (ctx: PhaseContext<TPayload, TInput>) => boolean;
    }
  ): PhaseDefinition<TPayload, TInput, TOutput> {
    return {
      name,
      execute: execute as (
        ctx: PhaseContext<TPayload, unknown>
      ) => Promise<PhaseResult<unknown>>,
      maxRetries: options?.maxRetries,
      transformInput: options?.transformInput as
        | ((previousOutput: unknown, payload: TPayload) => unknown | null)
        | undefined,
      shouldRun: options?.shouldRun as
        | ((ctx: PhaseContext<TPayload, unknown>) => boolean)
        | undefined,
    } as unknown as PhaseDefinition<TPayload, TInput, TOutput>;
  }

  /**
   * Optional: Validate the payload before creating the job.
   * Override this to add custom validation.
   */
  validatePayload?(payload: unknown): payload is TPayload;

  /**
   * Optional: Called when all phases complete successfully.
   * Override to add custom completion logic.
   */
  async onComplete?(
    job: { id: string; type: string; payload: string },
    result: unknown
  ): Promise<void>;

  /**
   * Optional: Called when the job fails after all retries.
   * Override to add custom failure handling.
   */
  async onFailed?(
    job: { id: string; type: string; payload: string },
    error: string
  ): Promise<void>;

  /**
   * Convert this job definition to a plain object.
   */
  toDefinition(): JobDefinition<TPayload> {
    return {
      type: this.type,
      description: this.description,
      defaultPriority: this.defaultPriority,
      defaultMaxRetries: this.defaultMaxRetries,
      phases: this.phases,
      validatePayload: this.validatePayload?.bind(this),
      onComplete: this.onComplete?.bind(this),
      onFailed: this.onFailed?.bind(this),
    };
  }
}

/**
 * Helper function to create a simple job definition without using a class.
 *
 * Usage:
 * ```typescript
 * const myJob = defineJob<MyPayload>({
 *   type: "my-job",
 *   phases: [
 *     {
 *       name: "process",
 *       execute: async (ctx) => {
 *         // Processing logic
 *         return { success: true };
 *       },
 *     },
 *   ],
 * });
 * ```
 */
export function defineJob<TPayload = unknown>(
  definition: JobDefinition<TPayload>
): JobDefinition<TPayload> {
  return definition;
}

/**
 * Create a simple phase definition helper
 */
export function createPhase<TPayload, TInput = unknown, TOutput = unknown>(
  name: string,
  execute: (ctx: PhaseContext<TPayload, TInput>) => Promise<PhaseResult<TOutput>>,
  options?: {
    maxRetries?: number;
    transformInput?: (previousOutput: unknown, payload: TPayload) => TInput | null;
    shouldRun?: (ctx: PhaseContext<TPayload, TInput>) => boolean;
  }
): PhaseDefinition<TPayload, TInput, TOutput> {
  return {
    name,
    execute: execute as unknown as (
      ctx: PhaseContext<TPayload, unknown>
    ) => Promise<PhaseResult<unknown>>,
    maxRetries: options?.maxRetries,
    transformInput: options?.transformInput as
      | ((previousOutput: unknown, payload: TPayload) => unknown | null)
      | undefined,
    shouldRun: options?.shouldRun as
      | ((ctx: PhaseContext<TPayload, unknown>) => boolean)
      | undefined,
  } as unknown as PhaseDefinition<TPayload, TInput, TOutput>;
}
