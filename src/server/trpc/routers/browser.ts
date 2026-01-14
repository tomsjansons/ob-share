/**
 * Browser Router - tRPC endpoints for browser session management
 *
 * Provides endpoints to:
 * - Check session status for known domains
 * - Get browser usage status
 * - List all domains with cookies
 */
import { router, protectedProcedure } from "../trpc";
import {
  getSessionStatus,
  hasBrowserBeenUsed,
  getAllDomainsWithCookies,
} from "@/server/browser";

export const browserRouter = router({
  /**
   * Get session status for all known domains
   * Shows which websites have cookies/sessions stored
   */
  getSessions: protectedProcedure.query(async ({ ctx }) => {
    ctx.logger.debug({ event: "browser.getSessions.start" });

    const sessions = await getSessionStatus();

    ctx.logger.info({
      event: "browser.getSessions.complete",
      sessionCount: sessions.length,
      loggedInCount: sessions.filter((s) => s.hasCookies).length,
    });

    return sessions;
  }),

  /**
   * Check if the browser has been used (any cookies exist)
   */
  hasBeenUsed: protectedProcedure.query(async ({ ctx }) => {
    ctx.logger.debug({ event: "browser.hasBeenUsed.start" });

    const used = await hasBrowserBeenUsed();

    ctx.logger.info({
      event: "browser.hasBeenUsed.complete",
      used,
    });

    return { used };
  }),

  /**
   * Get all domains with cookies (for debugging)
   */
  getAllDomains: protectedProcedure.query(async ({ ctx }) => {
    ctx.logger.debug({ event: "browser.getAllDomains.start" });

    const domains = await getAllDomainsWithCookies();

    ctx.logger.info({
      event: "browser.getAllDomains.complete",
      domainCount: domains.length,
    });

    return domains;
  }),
});
