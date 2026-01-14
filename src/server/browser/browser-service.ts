/**
 * Browser Service - Manages browser control for web fetching
 *
 * Connects to the UI Chrome browser via remote debugging to open tabs and fetch content.
 * This uses the same browser session that the user logs into via VNC, so all cookies,
 * localStorage, and sessions are automatically available.
 *
 * Falls back to launching a headless browser if the UI Chrome isn't available.
 */
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { logger as baseLogger } from "@/lib/logger";

const logger = baseLogger.child({ module: "browser-service" });

// Paths from environment or defaults
const CHROMIUM_PATH = process.env.CHROMIUM_EXECUTABLE_PATH ?? "/usr/bin/google-chrome-stable";
const CHROME_DEBUG_URL = "http://127.0.0.1:9222";

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
 * Browser Service class for managing browser connections
 */
export class BrowserService {
  private browser: Browser | null = null;
  private isConnecting = false;
  private connectPromise: Promise<void> | null = null;
  private isOwnedBrowser = false; // true if we launched it, false if we connected to existing

  /**
   * Connect to the UI Chrome browser or launch a new one
   */
  async connect(): Promise<void> {
    // If already connected, return
    if (this.browser?.connected) {
      return;
    }

    // If currently connecting, wait for that to complete
    if (this.isConnecting && this.connectPromise) {
      await this.connectPromise;
      return;
    }

    this.isConnecting = true;
    this.connectPromise = this.doConnect();

    try {
      await this.connectPromise;
    } finally {
      this.isConnecting = false;
      this.connectPromise = null;
    }
  }

  private async doConnect(): Promise<void> {
    // First, try to connect to the running UI Chrome
    try {
      logger.info({
        event: "browser.connecting",
        debugUrl: CHROME_DEBUG_URL,
      });

      this.browser = await puppeteer.connect({
        browserURL: CHROME_DEBUG_URL,
      });

      this.isOwnedBrowser = false;

      logger.info({ event: "browser.connected_to_ui" });

      // Handle browser disconnect
      this.browser.on("disconnected", () => {
        logger.info({ event: "browser.disconnected" });
        this.browser = null;
      });

      return;
    } catch (connectError) {
      logger.warn({
        event: "browser.connect_failed",
        error: connectError instanceof Error ? connectError.message : String(connectError),
      });
    }

    // Fall back to launching a new headless browser
    logger.info({
      event: "browser.launching_fallback",
      executablePath: CHROMIUM_PATH,
    });

    try {
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

      this.isOwnedBrowser = true;

      logger.info({ event: "browser.launched_fallback" });

      // Handle browser disconnect
      this.browser.on("disconnected", () => {
        logger.info({ event: "browser.disconnected" });
        this.browser = null;
      });
    } catch (launchError) {
      logger.error({
        event: "browser.launch_error",
        error: launchError instanceof Error ? launchError.message : String(launchError),
      });
      throw launchError;
    }
  }

  /**
   * Fetch a page and extract its content
   */
  async fetchPage(url: string, options: BrowserFetchOptions = {}): Promise<BrowserFetchResult> {
    const timeout = options.timeout ?? 30000;

    try {
      await this.connect();

      if (!this.browser) {
        throw new Error("Browser failed to connect");
      }

      logger.info({
        event: "browser.fetch_start",
        url,
        timeout,
        waitForSelector: options.waitForSelector,
        connectedToUi: !this.isOwnedBrowser,
      });

      // Open a new tab
      const page = await this.browser.newPage();

      try {
        // Set viewport
        await page.setViewport({ width: 1280, height: 720 });

        // Set custom user agent if provided
        if (options.userAgent) {
          await page.setUserAgent(options.userAgent);
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

        // Wait for SPA content to render based on the site
        await this.waitForSpaContent(page, url, timeout);

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
        // Close the tab
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
   * Wait for SPA content to render
   * Uses a simple fixed delay to let JavaScript render content
   */
  private async waitForSpaContent(page: Page, url: string, timeout: number): Promise<void> {
    // Wait for the full timeout to let SPAs render their content
    // This is simpler and more reliable than trying to detect specific selectors
    const waitTime = Math.min(timeout, 30000);

    logger.info({
      event: "browser.waiting_for_spa",
      url,
      waitTime,
    });

    await new Promise(resolve => setTimeout(resolve, waitTime));
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
   * Check if the browser is currently connected
   */
  isRunning(): boolean {
    return this.browser?.connected ?? false;
  }

  /**
   * Close the browser connection (only if we launched it)
   */
  async close(): Promise<void> {
    if (this.browser) {
      if (this.isOwnedBrowser) {
        // Only close if we launched it
        logger.info({ event: "browser.closing" });
        await this.browser.close();
      } else {
        // Just disconnect, don't close the UI browser
        logger.info({ event: "browser.disconnecting" });
        this.browser.disconnect();
      }
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
