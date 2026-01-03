// Temporary in-memory storage for shared files
// In production, consider using Redis or a database

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

function cleanup() {
  const now = Date.now();
  for (const [id, data] of shareStore.entries()) {
    if (now - data.createdAt > EXPIRY_MS) {
      shareStore.delete(id);
    }
  }
}

// Run cleanup every minute
if (typeof setInterval !== "undefined") {
  setInterval(cleanup, 60 * 1000);
}

export function generateShareId(): string {
  return crypto.randomUUID();
}

export function storeSharedData(id: string, data: SharedData): void {
  cleanup();
  shareStore.set(id, data);
}

export function getSharedData(id: string): SharedData | undefined {
  const data = shareStore.get(id);
  if (data) {
    // Delete after retrieval (one-time use)
    shareStore.delete(id);
  }
  return data;
}
