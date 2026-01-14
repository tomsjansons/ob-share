/**
 * Cookie Store - Manages browser session status
 *
 * Reads from the shared Chromium profile to check login status
 * for various websites.
 */
import { promises as fs } from "fs";
import path from "path";
import Database from "better-sqlite3";
import { logger as baseLogger } from "@/lib/logger";

const logger = baseLogger.child({ module: "cookie-store" });

const PROFILE_PATH = process.env.CHROMIUM_PROFILE_PATH ?? "/data/chromium-profile";

/**
 * Known domains and their display names
 */
const KNOWN_DOMAINS = [
  { domain: ".twitter.com", displayName: "Twitter" },
  { domain: ".x.com", displayName: "X (Twitter)" },
  { domain: ".reddit.com", displayName: "Reddit" },
  { domain: ".linkedin.com", displayName: "LinkedIn" },
  { domain: ".facebook.com", displayName: "Facebook" },
  { domain: ".instagram.com", displayName: "Instagram" },
  { domain: ".github.com", displayName: "GitHub" },
  { domain: ".youtube.com", displayName: "YouTube" },
  { domain: ".medium.com", displayName: "Medium" },
  { domain: ".substack.com", displayName: "Substack" },
] as const;

/**
 * Session status for a domain
 */
export interface SessionStatus {
  /** Domain pattern (e.g., ".twitter.com") */
  domain: string;
  /** Human-readable name */
  displayName: string;
  /** Whether cookies exist for this domain */
  hasCookies: boolean;
  /** Number of cookies for this domain */
  cookieCount: number;
  /** When this status was last checked */
  lastChecked: Date;
}

/**
 * Get the path to the Chromium cookies database
 */
function getCookiesDbPath(): string {
  return path.join(PROFILE_PATH, "Default", "Cookies");
}

/**
 * Check if the cookies database exists
 */
async function cookiesDbExists(): Promise<boolean> {
  try {
    await fs.access(getCookiesDbPath());
    return true;
  } catch {
    return false;
  }
}

/**
 * Get session status for all known domains
 */
export async function getSessionStatus(): Promise<SessionStatus[]> {
  const results: SessionStatus[] = [];
  const lastChecked = new Date();

  // Check if cookies database exists
  const dbExists = await cookiesDbExists();

  if (!dbExists) {
    logger.info({
      event: "cookie_store.no_database",
      path: getCookiesDbPath(),
    });

    // Return empty status for all domains
    return KNOWN_DOMAINS.map(({ domain, displayName }) => ({
      domain,
      displayName,
      hasCookies: false,
      cookieCount: 0,
      lastChecked,
    }));
  }

  try {
    // Open the cookies database in read-only mode
    // Note: Chromium's cookies DB may be locked if browser is running
    const db = new Database(getCookiesDbPath(), { readonly: true, fileMustExist: true });

    try {
      for (const { domain, displayName } of KNOWN_DOMAINS) {
        try {
          // Query for cookies matching this domain
          const stmt = db.prepare(
            "SELECT COUNT(*) as count FROM cookies WHERE host_key LIKE ?"
          );
          const result = stmt.get(`%${domain}%`) as { count: number } | undefined;
          const cookieCount = result?.count ?? 0;

          results.push({
            domain,
            displayName,
            hasCookies: cookieCount > 0,
            cookieCount,
            lastChecked,
          });
        } catch (queryError) {
          // Individual query failed
          logger.warn({
            event: "cookie_store.query_error",
            domain,
            error: queryError instanceof Error ? queryError.message : String(queryError),
          });

          results.push({
            domain,
            displayName,
            hasCookies: false,
            cookieCount: 0,
            lastChecked,
          });
        }
      }
    } finally {
      db.close();
    }

    logger.info({
      event: "cookie_store.status_retrieved",
      domainCount: results.length,
      domainsWithCookies: results.filter((r) => r.hasCookies).length,
    });
  } catch (error) {
    logger.error({
      event: "cookie_store.database_error",
      error: error instanceof Error ? error.message : String(error),
    });

    // Return empty status on error
    return KNOWN_DOMAINS.map(({ domain, displayName }) => ({
      domain,
      displayName,
      hasCookies: false,
      cookieCount: 0,
      lastChecked,
    }));
  }

  return results;
}

/**
 * Get session status for a specific domain
 */
export async function getDomainSessionStatus(targetDomain: string): Promise<SessionStatus | null> {
  const allStatus = await getSessionStatus();
  return allStatus.find((s) => s.domain === targetDomain) ?? null;
}

/**
 * Check if any cookies exist (browser has been used)
 */
export async function hasBrowserBeenUsed(): Promise<boolean> {
  const dbExists = await cookiesDbExists();
  if (!dbExists) return false;

  try {
    const db = new Database(getCookiesDbPath(), { readonly: true, fileMustExist: true });
    try {
      const stmt = db.prepare("SELECT COUNT(*) as count FROM cookies LIMIT 1");
      const result = stmt.get() as { count: number } | undefined;
      return (result?.count ?? 0) > 0;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

/**
 * Get all domains that have cookies (for debugging)
 */
export async function getAllDomainsWithCookies(): Promise<string[]> {
  const dbExists = await cookiesDbExists();
  if (!dbExists) return [];

  try {
    const db = new Database(getCookiesDbPath(), { readonly: true, fileMustExist: true });
    try {
      const stmt = db.prepare("SELECT DISTINCT host_key FROM cookies ORDER BY host_key");
      const rows = stmt.all() as Array<{ host_key: string }>;
      return rows.map((r) => r.host_key);
    } finally {
      db.close();
    }
  } catch (error) {
    logger.error({
      event: "cookie_store.get_domains_error",
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
