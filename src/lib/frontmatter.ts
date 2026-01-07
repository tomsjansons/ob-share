/**
 * Frontmatter Utilities
 *
 * Shared utilities for parsing and building YAML frontmatter in markdown files.
 * Uses the gray-matter library for robust YAML handling.
 *
 * IMPORTANT: Always use these utilities for frontmatter operations.
 * Do not implement custom frontmatter parsing/building.
 */

import matter, { type GrayMatterFile } from "gray-matter";

// Re-export gray-matter types for convenience
export type { GrayMatterFile };

/**
 * Parse YAML frontmatter from markdown content
 * Returns the gray-matter result object with data (frontmatter) and content (body)
 */
export function parseFrontmatter(content: string): GrayMatterFile<string> {
  return matter(content);
}

/**
 * Build a markdown string from frontmatter data and body content
 */
export function buildMarkdown(
  data: Record<string, unknown>,
  content: string
): string {
  return matter.stringify(content, data);
}

/**
 * Update frontmatter in markdown content while preserving the body
 */
export function updateFrontmatter(
  content: string,
  updates: Record<string, unknown>
): string {
  const parsed = matter(content);
  const updatedData = { ...parsed.data, ...updates };
  return matter.stringify(parsed.content, updatedData);
}

/**
 * Check if content has frontmatter
 */
export function hasFrontmatter(content: string): boolean {
  return matter.test(content);
}
