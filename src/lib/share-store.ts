/**
 * Share Store - Temporary in-memory storage for shared files
 *
 * IMPORTANT: This is in-memory storage and will be lost on process restart.
 * In production with multiple instances, consider using Redis or a database.
 *
 * Data lifecycle:
 * 1. Data is stored via storeSharedData() when receiving a share
 * 2. Data is retrieved via getSharedData() when displaying the share page
 * 3. Data is explicitly deleted via deleteSharedData() after successful save to vault
 * 4. Expired data is cleaned up automatically after EXPIRY_MS
 */

export interface SharedFile {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

export interface SharedData {
  title: string;
  text: string;
  url: string;
  files: SharedFile[];
  createdAt: number;
}

// Simple in-memory store with automatic cleanup
const shareStore = new Map<string, SharedData>();

// Clean up entries older than 5 minutes
const EXPIRY_MS = 5 * 60 * 1000;

// Cleanup interval reference for proper cleanup
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function cleanup(): void {
  const now = Date.now();
  for (const [id, data] of shareStore.entries()) {
    if (now - data.createdAt > EXPIRY_MS) {
      shareStore.delete(id);
    }
  }
}

/**
 * Start the cleanup interval. Called automatically on first store.
 * Interval is unref'd to not keep the process alive.
 */
function ensureCleanupRunning(): void {
  if (cleanupInterval !== null) {
    return;
  }

  if (typeof setInterval !== "undefined") {
    cleanupInterval = setInterval(cleanup, 60 * 1000);
    // Don't keep the process alive just for cleanup
    if (cleanupInterval.unref) {
      cleanupInterval.unref();
    }
  }
}

/**
 * Stop the cleanup interval (useful for testing or shutdown).
 */
export function stopCleanup(): void {
  if (cleanupInterval !== null) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

export function generateShareId(): string {
  return crypto.randomUUID();
}

export function storeSharedData(id: string, data: SharedData): void {
  ensureCleanupRunning();
  cleanup(); // Also clean on store to prevent unbounded growth
  shareStore.set(id, data);
}

/**
 * Get shared data by ID. Does NOT delete the data.
 * Use deleteSharedData() after successful processing.
 */
export function getSharedData(id: string): SharedData | undefined {
  return shareStore.get(id);
}

/**
 * Explicitly delete shared data after successful processing.
 * Call this after the data has been successfully saved to vault.
 */
export function deleteSharedData(id: string): boolean {
  return shareStore.delete(id);
}

/**
 * Check if shared data exists (useful for validation).
 */
export function hasSharedData(id: string): boolean {
  return shareStore.has(id);
}

/**
 * Get the current size of the store (useful for monitoring).
 */
export function getStoreSize(): number {
  return shareStore.size;
}
