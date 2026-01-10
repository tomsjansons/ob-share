import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/server/db";
import * as schema from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { logger, getElapsedMs } from "./logger";

// Create a child logger for auth operations
const authLogger = logger.child({ module: "auth" });

const authModuleStart = Date.now();
authLogger.info({ event: "auth.module.loading", elapsedMs: getElapsedMs() }, "Auth module loading");

// Helper function to create default settings for a new user
async function createDefaultSettings(userId: string): Promise<void> {
  const now = new Date();
  try {
    await db.insert(schema.userSettings).values({
      userId,
      vaultName: null,
      incomingFolder: null,
      createdAt: now,
      updatedAt: now,
    });
    authLogger.info({
      event: "auth.user.settings_created",
      userId,
    });
  } catch (error) {
    // Check if this is a unique constraint violation (settings already exist)
    const isUniqueConstraintError =
      error instanceof Error &&
      (error.message.includes("UNIQUE constraint failed") ||
        error.message.includes("SQLITE_CONSTRAINT_UNIQUE") ||
        error.message.includes("duplicate key"));

    if (isUniqueConstraintError) {
      // Settings already exist, this is expected
      authLogger.debug({
        event: "auth.user.settings_exists",
        userId,
      });
    } else {
      // Unexpected error - log and re-throw
      authLogger.error({
        event: "auth.user.settings_error",
        userId,
        error: error instanceof Error ? error.message : String(error),
      }, "Unexpected error creating user settings");
      throw error;
    }
  }
}

// Helper function to check if a GitHub username is allowed
async function isUsernameAllowed(username: string): Promise<boolean> {
  const result = await db
    .select()
    .from(schema.allowList)
    .where(eq(schema.allowList.githubUsername, username.toLowerCase()))
    .limit(1);

  return result.length > 0;
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["github"],
    },
  },
  denySignIn: async ({ user, account }: { user: { id: string; name: string; email: string }; account: { providerId: string; accountId: string } | null }) => {
    // Only check for GitHub provider
    if (account?.providerId !== "github") {
      return false; // Allow non-GitHub providers (though we only have GitHub)
    }

    // Get the GitHub username from the account
    // The account.accountId is the GitHub user ID
    // We can fetch the username from GitHub's API
    try {
      const response = await fetch(
        `https://api.github.com/user/${account.accountId}`,
        {
          headers: {
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "ob-share",
          },
        }
      );

      if (!response.ok) {
        authLogger.error({
          event: "auth.github.api_error",
          status: response.status,
          accountId: account.accountId,
        });
        return true; // Deny if we can't verify
      }

      const githubUser = await response.json();
      const username = githubUser.login;

      const allowed = await isUsernameAllowed(username);

      if (!allowed) {
        authLogger.warn({
          event: "auth.signin.denied",
          reason: "not_in_allowlist",
          githubUsername: username,
        });
        return true; // Deny sign in
      }

      authLogger.info({
        event: "auth.signin.allowed",
        githubUsername: username,
      });

      return false; // Allow sign in
    } catch (error) {
      authLogger.error({
        event: "auth.allowlist.check_error",
        error: error instanceof Error ? error.message : "Unknown error",
        accountId: account.accountId,
      });
      return true; // Deny on error
    }
  },
  advanced: {
    cookiePrefix: "ob-share",
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Create default settings for the new user
          await createDefaultSettings(user.id);
        },
      },
    },
  },
});

const authModuleDuration = Date.now() - authModuleStart;
authLogger.info({
  event: "auth.module.ready",
  elapsedMs: getElapsedMs(),
  initDurationMs: authModuleDuration,
}, "Auth module initialized");

export { isUsernameAllowed };
export type Session = typeof auth.$Infer.Session;
