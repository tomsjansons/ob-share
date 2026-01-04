/**
 * Job Registry
 *
 * Central registry for all job definitions.
 * Job types must be registered before they can be processed.
 */

import type { JobDefinition } from "./types";
import { BaseJob } from "./base-job";

class JobRegistryImpl {
  private definitions = new Map<string, JobDefinition>();

  /**
   * Register a job definition
   */
  register<TPayload = unknown>(job: JobDefinition<TPayload> | BaseJob<TPayload>): void {
    const definition = job instanceof BaseJob ? job.toDefinition() : job;

    if (this.definitions.has(definition.type)) {
      console.warn(`Job type "${definition.type}" is already registered, overwriting`);
    }

    this.definitions.set(definition.type, definition as JobDefinition);
  }

  /**
   * Unregister a job type
   */
  unregister(type: string): boolean {
    return this.definitions.delete(type);
  }

  /**
   * Get a job definition by type
   */
  get(type: string): JobDefinition | undefined {
    return this.definitions.get(type);
  }

  /**
   * Check if a job type is registered
   */
  has(type: string): boolean {
    return this.definitions.has(type);
  }

  /**
   * Get all registered job definitions
   */
  getAll(): Map<string, JobDefinition> {
    return new Map(this.definitions);
  }

  /**
   * Get all registered job types
   */
  getTypes(): string[] {
    return Array.from(this.definitions.keys());
  }

  /**
   * Clear all registered jobs
   */
  clear(): void {
    this.definitions.clear();
  }
}

/**
 * Global job registry instance
 */
export const JobRegistry = new JobRegistryImpl();
