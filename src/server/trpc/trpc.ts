import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { createLogger, sanitizeForLogging, type Logger } from "@/lib/logger";

// Generate a unique request ID
function generateRequestId(): string {
  return `trpc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export const createTRPCContext = async () => {
  const requestId = generateRequestId();
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  // Create a child logger with request context
  const logger = createLogger({
    requestId,
    userId: session?.user?.id,
  });

  return {
    session,
    logger,
    requestId,
  };
};

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
});

/**
 * Logging middleware that wraps all procedures
 * Logs procedure start, completion, and errors without exposing sensitive data
 */
const loggerMiddleware = t.middleware(async ({ path, type, next, ctx, getRawInput }) => {
  const startTime = Date.now();

  ctx.logger.info({
    event: "trpc.request.start",
    procedure: path,
    type,
  });

  try {
    const result = await next();
    const durationMs = Date.now() - startTime;

    ctx.logger.info({
      event: "trpc.request.complete",
      procedure: path,
      type,
      durationMs,
      success: result.ok,
    });

    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;

    // Log error details without exposing sensitive information
    ctx.logger.error({
      event: "trpc.request.error",
      procedure: path,
      type,
      durationMs,
      error: error instanceof TRPCError ? {
        code: error.code,
        message: error.message,
      } : {
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });

    throw error;
  }
});

export const router = t.router;

// All procedures use the logging middleware
export const publicProcedure = t.procedure.use(loggerMiddleware);

export const protectedProcedure = t.procedure
  .use(loggerMiddleware)
  .use(async ({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "You must be logged in to access this resource",
      });
    }

    return next({
      ctx: {
        session: ctx.session,
        logger: ctx.logger,
        requestId: ctx.requestId,
      },
    });
  });

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;
