/**
 * Workflow Registry - Central registry for workflow definitions
 *
 * Manages all registered workflows and provides lookup functionality.
 * Automatically syncs with the orchestrator.
 */

import type { WorkflowDefinition } from "./types";
import { getOrchestrator } from "./orchestrator";
import { logger as baseLogger } from "@/lib/logger";

const logger = baseLogger.child({ module: "workflow-registry" });

/**
 * Workflow Registry implementation
 */
class WorkflowRegistryImpl {
  private workflows = new Map<string, WorkflowDefinition>();
  private initialized = false;

  /**
   * Register a workflow definition
   */
  register<TTrigger = unknown, TResult = unknown>(
    workflow: WorkflowDefinition<TTrigger, TResult>
  ): void {
    if (this.workflows.has(workflow.id)) {
      logger.warn(
        { workflowId: workflow.id },
        "Overwriting existing workflow in registry"
      );
    }

    this.workflows.set(workflow.id, workflow as WorkflowDefinition);

    // Also register with orchestrator
    getOrchestrator().registerWorkflow(workflow as WorkflowDefinition);

    logger.info(
      {
        event: "workflow.registry.registered",
        workflowId: workflow.id,
        name: workflow.name,
      },
      "Workflow registered"
    );
  }

  /**
   * Register multiple workflows at once
   */
  registerAll(workflows: WorkflowDefinition[]): void {
    for (const workflow of workflows) {
      this.register(workflow);
    }
  }

  /**
   * Unregister a workflow
   */
  unregister(workflowId: string): boolean {
    const removed = this.workflows.delete(workflowId);
    if (removed) {
      getOrchestrator().unregisterWorkflow(workflowId);
      logger.info(
        { event: "workflow.registry.unregistered", workflowId },
        "Workflow unregistered"
      );
    }
    return removed;
  }

  /**
   * Get a workflow by ID
   */
  get<TTrigger = unknown, TResult = unknown>(
    workflowId: string
  ): WorkflowDefinition<TTrigger, TResult> | undefined {
    return this.workflows.get(workflowId) as
      | WorkflowDefinition<TTrigger, TResult>
      | undefined;
  }

  /**
   * Check if a workflow exists
   */
  has(workflowId: string): boolean {
    return this.workflows.has(workflowId);
  }

  /**
   * Get all registered workflows
   */
  getAll(): Map<string, WorkflowDefinition> {
    return new Map(this.workflows);
  }

  /**
   * Get all workflow IDs
   */
  getIds(): string[] {
    return Array.from(this.workflows.keys());
  }

  /**
   * Get workflows by criteria
   */
  find(
    predicate: (workflow: WorkflowDefinition) => boolean
  ): WorkflowDefinition[] {
    return Array.from(this.workflows.values()).filter(predicate);
  }

  /**
   * Get workflow count
   */
  get count(): number {
    return this.workflows.size;
  }

  /**
   * Clear all workflows
   */
  clear(): void {
    for (const workflowId of this.workflows.keys()) {
      getOrchestrator().unregisterWorkflow(workflowId);
    }
    this.workflows.clear();
    logger.info(
      { event: "workflow.registry.cleared" },
      "Workflow registry cleared"
    );
  }

  /**
   * Mark registry as initialized
   */
  markInitialized(): void {
    this.initialized = true;
  }

  /**
   * Check if registry is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Singleton workflow registry
 */
export const WorkflowRegistry = new WorkflowRegistryImpl();

/**
 * Decorator for registering workflow classes
 */
export function RegisterWorkflow(): ClassDecorator {
  return ((target: abstract new () => WorkflowDefinition) => {
    const workflowConstructor =
      target as unknown as new () => WorkflowDefinition;

    // Create instance and register
    const instance = new workflowConstructor();
    WorkflowRegistry.register(instance);
  }) as ClassDecorator;
}

/**
 * Initialize workflows from a module
 */
export function initializeWorkflows(
  workflowModules: Record<string, WorkflowDefinition | undefined>
): void {
  for (const workflow of Object.values(workflowModules)) {
    if (workflow && typeof workflow === "object" && "id" in workflow) {
      WorkflowRegistry.register(workflow);
    }
  }
  WorkflowRegistry.markInitialized();
}
