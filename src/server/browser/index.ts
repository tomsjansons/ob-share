/**
 * Browser Module - Headless Chromium for web fetching
 *
 * This module provides:
 * - BrowserService: Headless Chromium for fetching JavaScript-rendered pages
 * - Cookie Store: Check session status for known domains
 *
 * The browser shares its profile with the UI Chromium (accessible via VNC),
 * allowing users to log into websites and have those sessions used for
 * automated content extraction.
 */

export {
  BrowserService,
  getBrowserService,
  closeBrowserService,
  type BrowserFetchOptions,
  type BrowserFetchResult,
} from "./browser-service";

export {
  getSessionStatus,
  getDomainSessionStatus,
  hasBrowserBeenUsed,
  getAllDomainsWithCookies,
  type SessionStatus,
} from "./cookie-store";
