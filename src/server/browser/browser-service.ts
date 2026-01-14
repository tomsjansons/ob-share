/**
 * Browser Service - Manages headless Chromium for web fetching
 *
 * Launches a headless browser and injects cookies from the UI Chrome profile.
 * This enables fetching authenticated content from services the user has
 * logged into via VNC, without locking conflicts.
 */
import puppeteer, { type Browser, type Page, type CookieParam } from "puppeteer-core";
import path from "path";
import Database from "better-sqlite3";
import { logger as baseLogger } from "@/lib/logger";

const logger = baseLogger.child({ module: "browser-service" });

// Paths from environment or defaults
const CHROMIUM_PATH = process.env.CHROMIUM_EXECUTABLE_PATH ?? "/usr/bin/google-chrome-stable";
const PROFILE_PATH = process.env.CHROMIUM_PROFILE_PATH ?? "/data/chromium-profile";

/**
 * Options for fetching a page
 */
export interface BrowserFetchOptions {
  /** CSS selector to wait for before extracting content */
  waitForSelector?: string;
  /** Wait for network to be idle before extracting */
  waitForNetworkIdle?: boolean;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Take a screenshot of the page */
  screenshot?: boolean;
  /** Custom user agent string */
  userAgent?: string;
}

/**
 * Result of fetching a page with the browser
 */
export interface BrowserFetchResult {
  /** Original URL requested */
  url: string;
  /** Final URL after redirects */
  finalUrl: string;
  /** Page title */
  title: string;
  /** Full HTML content */
  html: string;
  /** Text content (innerText of body) */
  text: string;
  /** Screenshot as base64 data URL (if requested) */
  screenshot?: string;
  /** Whether the page appears to be authenticated */
  isAuthenticated: boolean;
  /** HTTP status code */
  status: number;
  /** Whether the fetch was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Chrome cookie row from SQLite database
 */
interface ChromeCookieRow {
  host_key: string;
  name: string;
  value: string;
  path: string;
  expires_utc: number;
  is_secure: number;
  is_httponly: number;
  samesite: number;
}

/**
 * Read cookies from Chrome's SQLite database for a specific domain
 */
function readCookiesFromProfile(domain: string): CookieParam[] {
  const cookiesDbPath = path.join(PROFILE_PATH, "Default", "Cookies");
  const cookies: CookieParam[] = [];

  try {
    const db = new Database(cookiesDbPath, { readonly: true, fileMustExist: true });

    try {
      // Get cookies for the domain and its subdomains
      const stmt = db.prepare(`
        SELECT host_key, name, value, path, expires_utc, is_secure, is_httponly, samesite
        FROM cookies
        WHERE host_key LIKE ? OR host_key LIKE ?
      `);

      const rows = stmt.all(`%${domain}`, `.${domain}`) as ChromeCookieRow[];

      for (const row of rows) {
        // Chrome stores expiry as microseconds since Windows epoch (Jan 1, 1601)
        // Convert to Unix timestamp in seconds
        const windowsToUnixDiff = 11644473600; // seconds between 1601 and 1970
        const expiresUnix = row.expires_utc > 0
          ? Math.floor(row.expires_utc / 1000000) - windowsToUnixDiff
          : -1;

        // Map Chrome's samesite values to Puppeteer's
        let sameSite: "Strict" | "Lax" | "None" | undefined;
        switch (row.samesite) {
          case 0: sameSite = undefined; break; // Unspecified
          case 1: sameSite = "Lax"; break;
          case 2: sameSite = "Strict"; break;
          case 3: sameSite = "None"; break;
          default: sameSite = undefined;
        }

        cookies.push({
          name: row.name,
          value: row.value,
          domain: row.host_key,
          path: row.path,
          expires: expiresUnix,
          httpOnly: row.is_httponly === 1,
          secure: row.is_secure === 1,
          sameSite,
        });
      }

      logger.info({
        event: "browser.cookies_read",
        domain,
        cookieCount: cookies.length,
      });
    } finally {
      db.close();
    }
  } catch (error) {
    logger.warn({
      event: "browser.cookies_read_error",
      domain,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return cookies;
}

/**
 * Extract the main domain from a URL for cookie lookup
 */
function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    // For domains like "twitter.com", "www.twitter.com", "mobile.twitter.com"
    // we want to get cookies for "twitter.com"
    const parts = hostname.split(".");
    if (parts.length >= 2) {
      // Return last two parts (e.g., "twitter.com")
      return parts.slice(-2).join(".");
    }
    return hostname;
  } catch {
    return "";
  }
}

/**
 * Browser Service class for managing headless Chromium
 */
export class BrowserService {
  private browser: Browser | null = null;
  private isLaunching = false;
  private launchPromise: Promise<void> | null = null;

  /**
   * Launch the browser if not already running
   */
  async launch(): Promise<void> {
    // If already launched, return
    if (this.browser?.connected) {
      return;
    }

    // If currently launching, wait for that to complete
    if (this.isLaunching && this.launchPromise) {
      await this.launchPromise;
      return;
    }

    this.isLaunching = true;
    this.launchPromise = this.doLaunch();

    try {
      await this.launchPromise;
    } finally {
      this.isLaunching = false;
      this.launchPromise = null;
    }
  }

  private async doLaunch(): Promise<void> {
    logger.info({
      event: "browser.launching",
      executablePath: CHROMIUM_PATH,
    });

    try {
      // Launch without userDataDir - we'll inject cookies instead
      // This avoids profile locking conflicts with the UI Chrome
      this.browser = await puppeteer.launch({
        executablePath: CHROMIUM_PATH,
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-software-rasterizer",
          "--disable-extensions",
          "--disable-background-networking",
          "--disable-sync",
          "--disable-translate",
          "--metrics-recording-only",
          "--no-first-run",
          "--safebrowsing-disable-auto-update",
        ],
      });

      logger.info({ event: "browser.launched" });

      // Handle browser disconnect
      this.browser.on("disconnected", () => {
        logger.info({ event: "browser.disconnected" });
        this.browser = null;
      });
    } catch (error) {
      logger.error({
        event: "browser.launch_error",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Fetch a page and extract its content
   */
  async fetchPage(url: string, options: BrowserFetchOptions = {}): Promise<BrowserFetchResult> {
    const timeout = options.timeout ?? 30000;

    try {
      await this.launch();

      if (!this.browser) {
        throw new Error("Browser failed to launch");
      }

      logger.info({
        event: "browser.fetch_start",
        url,
        timeout,
        waitForSelector: options.waitForSelector,
      });

      const page = await this.browser.newPage();

      try {
        // Set viewport
        await page.setViewport({ width: 1280, height: 720 });

        // Set custom user agent if provided
        if (options.userAgent) {
          await page.setUserAgent(options.userAgent);
        }

        // Inject cookies from the UI Chrome profile for this domain
        const domain = extractDomain(url);
        if (domain) {
          const cookies = readCookiesFromProfile(domain);
          if (cookies.length > 0) {
            await page.setCookie(...cookies);
            logger.info({
              event: "browser.cookies_injected",
              url,
              domain,
              cookieCount: cookies.length,
            });
          }
        }

        // Navigate to URL
        const response = await page.goto(url, {
          waitUntil: options.waitForNetworkIdle ? "networkidle0" : "networkidle2",
          timeout,
        });

        const status = response?.status() ?? 0;

        // Check for HTTP errors
        if (status >= 400) {
          logger.warn({
            event: "browser.fetch_http_error",
            url,
            status,
          });

          return {
            url,
            finalUrl: page.url(),
            title: "",
            html: "",
            text: "",
            isAuthenticated: false,
            status,
            success: false,
            error: `HTTP ${status}`,
          };
        }

        // Wait for specific selector if provided
        if (options.waitForSelector) {
          try {
            await page.waitForSelector(options.waitForSelector, { timeout });
          } catch {
            logger.warn({
              event: "browser.selector_timeout",
              url,
              selector: options.waitForSelector,
            });
            // Continue anyway - page may still have content
          }
        }

        // Extract page content
        const title = await page.title();
        const html = await page.content();
        const text = await page.evaluate(() => document.body?.innerText ?? "");
        const finalUrl = page.url();

        // Check if page appears authenticated
        const isAuthenticated = await this.detectAuthentication(page, url);

        // Take screenshot if requested
        let screenshot: string | undefined;
        if (options.screenshot) {
          const screenshotData = await page.screenshot({ type: "png", fullPage: false });
          const buffer = Buffer.from(screenshotData);
          screenshot = `data:image/png;base64,${buffer.toString("base64")}`;
        }

        logger.info({
          event: "browser.fetch_complete",
          url,
          finalUrl,
          status,
          titleLength: title.length,
          htmlLength: html.length,
          textLength: text.length,
          isAuthenticated,
        });

        return {
          url,
          finalUrl,
          title,
          html,
          text,
          screenshot,
          isAuthenticated,
          status,
          success: true,
        };
      } finally {
        await page.close();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error({
        event: "browser.fetch_error",
        url,
        error: errorMessage,
      });

      return {
        url,
        finalUrl: url,
        title: "",
        html: "",
        text: "",
        isAuthenticated: false,
        status: 0,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Detect if the page appears to show authenticated content
   */
  private async detectAuthentication(page: Page, url: string): Promise<boolean> {
    try {
      const hostname = new URL(url).hostname;

      // Twitter/X detection
      if (hostname.includes("twitter.com") || hostname.includes("x.com")) {
        return await page.evaluate(() => {
          // Check for account switcher button (indicates logged in)
          return !!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
        });
      }

      // Reddit detection
      if (hostname.includes("reddit.com")) {
        return await page.evaluate(() => {
          // Check for user drawer button or logged-in indicators
          return (
            !!document.querySelector('[data-testid="user-drawer-button"]') ||
            !!document.querySelector('button[id*="USER_DROPDOWN"]')
          );
        });
      }

      // LinkedIn detection
      if (hostname.includes("linkedin.com")) {
        return await page.evaluate(() => {
          return !!document.querySelector(".global-nav__me-photo");
        });
      }

      // Generic detection: check for common logged-in indicators
      return await page.evaluate(() => {
        // Look for logout/signout links
        const logoutLinks = document.querySelectorAll(
          'a[href*="logout"], a[href*="signout"], button[class*="logout"], button[class*="signout"]'
        );
        if (logoutLinks.length > 0) return true;

        // Look for "My Account" type links
        const accountLinks = document.querySelectorAll(
          'a[href*="/account"], a[href*="/profile"], a[href*="/settings"]'
        );
        if (accountLinks.length > 0) return true;

        return false;
      });
    } catch {
      // If detection fails, assume not authenticated
      return false;
    }
  }

  /**
   * Check if the browser is currently running
   */
  isRunning(): boolean {
    return this.browser?.connected ?? false;
  }

  /**
   * Close the browser
   */
  async close(): Promise<void> {
    if (this.browser) {
      logger.info({ event: "browser.closing" });
      await this.browser.close();
      this.browser = null;
    }
  }
}

// Singleton instance
let browserService: BrowserService | null = null;

/**
 * Get the singleton browser service instance
 */
export function getBrowserService(): BrowserService {
  if (!browserService) {
    browserService = new BrowserService();
  }
  return browserService;
}

/**
 * Cleanup function for graceful shutdown
 */
export async function closeBrowserService(): Promise<void> {
  if (browserService) {
    await browserService.close();
    browserService = null;
  }
}
