import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { db } from "@/server/db";
import { userSettings, type LocationPermissionStatus, type AudioPermissionStatus, type TextLlmProvider } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export const settingsRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const { logger } = ctx;

    logger.debug({
      event: "settings.get.start",
    });

    const settings = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, ctx.session.user.id))
      .limit(1);

    if (settings.length === 0) {
      logger.info({
        event: "settings.get.creating_default",
      });

      // Create default settings if they don't exist
      const now = new Date();
      await db.insert(userSettings).values({
        userId: ctx.session.user.id,
        vaultName: null,
        incomingFolder: null,
        locationPermission: "not_asked",
        audioPermission: "not_asked",
        fileCheckInterval: 10,
        openaiApiKey: null,
        openaiModel: "gpt-4o-audio-preview",
        textLlmProvider: "anthropic",
        textLlmApiKey: null,
        textLlmModel: "claude-sonnet-4-20250514",
        maxRetries: 5,
        createdAt: now,
        updatedAt: now,
      });

      return {
        vaultName: null,
        incomingFolder: null,
        locationPermission: "not_asked" as LocationPermissionStatus,
        audioPermission: "not_asked" as AudioPermissionStatus,
        fileCheckInterval: 10,
        openaiApiKey: null,
        openaiModel: "gpt-4o-audio-preview",
        textLlmProvider: "anthropic" as TextLlmProvider,
        textLlmApiKey: null,
        textLlmModel: "claude-sonnet-4-20250514",
        maxRetries: 5,
        isComplete: false,
      };
    }

    const { vaultName, incomingFolder, locationPermission, audioPermission, fileCheckInterval, openaiApiKey, openaiModel, textLlmProvider, textLlmApiKey, textLlmModel, maxRetries } = settings[0];
    const isComplete = Boolean(vaultName && incomingFolder && (openaiApiKey || textLlmApiKey));

    logger.debug({
      event: "settings.get.complete",
      isComplete,
      locationPermission,
      audioPermission,
      fileCheckInterval,
      textLlmProvider,
    });

    return {
      vaultName,
      incomingFolder,
      locationPermission,
      audioPermission,
      fileCheckInterval,
      openaiApiKey,
      openaiModel,
      textLlmProvider,
      textLlmApiKey,
      textLlmModel,
      maxRetries,
      isComplete,
    };
  }),

  update: protectedProcedure
    .input(
      z.object({
        vaultName: z.string().min(1, "Vault name is required"),
        incomingFolder: z.string().min(1, "Incoming folder is required"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { logger } = ctx;

      // Clean up the input values
      const vaultName = input.vaultName.trim().replace(/^\/+|\/+$/g, "");
      const incomingFolder = input.incomingFolder.trim().replace(/^\/+|\/+$/g, "");

      logger.info({
        event: "settings.update.start",
        vaultName,
        incomingFolder,
      });

      const existingSettings = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, ctx.session.user.id))
        .limit(1);

      const now = new Date();

      if (existingSettings.length === 0) {
        await db.insert(userSettings).values({
          userId: ctx.session.user.id,
          vaultName,
          incomingFolder,
          createdAt: now,
          updatedAt: now,
        });

        logger.info({
          event: "settings.update.created",
          vaultName,
          incomingFolder,
        });
      } else {
        await db
          .update(userSettings)
          .set({
            vaultName,
            incomingFolder,
            updatedAt: now,
          })
          .where(eq(userSettings.userId, ctx.session.user.id));

        logger.info({
          event: "settings.update.updated",
          vaultName,
          incomingFolder,
        });
      }

      return {
        success: true,
        vaultName,
        incomingFolder,
      };
    }),

  updateLocationPermission: protectedProcedure
    .input(
      z.object({
        locationPermission: z.enum(["not_asked", "granted", "denied"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { logger } = ctx;

      logger.info({
        event: "settings.updateLocationPermission.start",
        locationPermission: input.locationPermission,
      });

      const existingSettings = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, ctx.session.user.id))
        .limit(1);

      const now = new Date();

      if (existingSettings.length === 0) {
        await db.insert(userSettings).values({
          userId: ctx.session.user.id,
          vaultName: null,
          incomingFolder: null,
          locationPermission: input.locationPermission,
          createdAt: now,
          updatedAt: now,
        });

        logger.info({
          event: "settings.updateLocationPermission.created",
          locationPermission: input.locationPermission,
        });
      } else {
        await db
          .update(userSettings)
          .set({
            locationPermission: input.locationPermission,
            updatedAt: now,
          })
          .where(eq(userSettings.userId, ctx.session.user.id));

        logger.info({
          event: "settings.updateLocationPermission.updated",
          locationPermission: input.locationPermission,
        });
      }

      return {
        success: true,
        locationPermission: input.locationPermission,
      };
    }),

  updateAudioPermission: protectedProcedure
    .input(
      z.object({
        audioPermission: z.enum(["not_asked", "granted", "denied"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { logger } = ctx;

      logger.info({
        event: "settings.updateAudioPermission.start",
        audioPermission: input.audioPermission,
      });

      const existingSettings = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, ctx.session.user.id))
        .limit(1);

      const now = new Date();

      if (existingSettings.length === 0) {
        await db.insert(userSettings).values({
          userId: ctx.session.user.id,
          vaultName: null,
          incomingFolder: null,
          locationPermission: "not_asked",
          audioPermission: input.audioPermission,
          createdAt: now,
          updatedAt: now,
        });

        logger.info({
          event: "settings.updateAudioPermission.created",
          audioPermission: input.audioPermission,
        });
      } else {
        await db
          .update(userSettings)
          .set({
            audioPermission: input.audioPermission,
            updatedAt: now,
          })
          .where(eq(userSettings.userId, ctx.session.user.id));

        logger.info({
          event: "settings.updateAudioPermission.updated",
          audioPermission: input.audioPermission,
        });
      }

      return {
        success: true,
        audioPermission: input.audioPermission,
      };
    }),

  updateFileCheckInterval: protectedProcedure
    .input(
      z.object({
        fileCheckInterval: z.number().min(5).max(3600),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { logger } = ctx;

      logger.info({
        event: "settings.updateFileCheckInterval.start",
        fileCheckInterval: input.fileCheckInterval,
      });

      const existingSettings = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, ctx.session.user.id))
        .limit(1);

      const now = new Date();

      if (existingSettings.length === 0) {
        await db.insert(userSettings).values({
          userId: ctx.session.user.id,
          vaultName: null,
          incomingFolder: null,
          locationPermission: "not_asked",
          audioPermission: "not_asked",
          fileCheckInterval: input.fileCheckInterval,
          createdAt: now,
          updatedAt: now,
        });

        logger.info({
          event: "settings.updateFileCheckInterval.created",
          fileCheckInterval: input.fileCheckInterval,
        });
      } else {
        await db
          .update(userSettings)
          .set({
            fileCheckInterval: input.fileCheckInterval,
            updatedAt: now,
          })
          .where(eq(userSettings.userId, ctx.session.user.id));

        logger.info({
          event: "settings.updateFileCheckInterval.updated",
          fileCheckInterval: input.fileCheckInterval,
        });
      }

      return {
        success: true,
        fileCheckInterval: input.fileCheckInterval,
      };
    }),

  updateOpenaiSettings: protectedProcedure
    .input(
      z.object({
        openaiApiKey: z.string().nullable(),
        openaiModel: z.string().min(1),
        maxRetries: z.number().min(1).max(20),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { logger } = ctx;

      logger.info({
        event: "settings.updateOpenaiSettings.start",
        openaiModel: input.openaiModel,
        maxRetries: input.maxRetries,
        hasApiKey: Boolean(input.openaiApiKey),
      });

      const existingSettings = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, ctx.session.user.id))
        .limit(1);

      const now = new Date();

      if (existingSettings.length === 0) {
        await db.insert(userSettings).values({
          userId: ctx.session.user.id,
          vaultName: null,
          incomingFolder: null,
          locationPermission: "not_asked",
          audioPermission: "not_asked",
          fileCheckInterval: 10,
          openaiApiKey: input.openaiApiKey,
          openaiModel: input.openaiModel,
          maxRetries: input.maxRetries,
          createdAt: now,
          updatedAt: now,
        });

        logger.info({
          event: "settings.updateOpenaiSettings.created",
          openaiModel: input.openaiModel,
          maxRetries: input.maxRetries,
        });
      } else {
        await db
          .update(userSettings)
          .set({
            openaiApiKey: input.openaiApiKey,
            openaiModel: input.openaiModel,
            maxRetries: input.maxRetries,
            updatedAt: now,
          })
          .where(eq(userSettings.userId, ctx.session.user.id));

        logger.info({
          event: "settings.updateOpenaiSettings.updated",
          openaiModel: input.openaiModel,
          maxRetries: input.maxRetries,
        });
      }

      return {
        success: true,
        openaiModel: input.openaiModel,
        maxRetries: input.maxRetries,
      };
    }),

  updateTextLlmSettings: protectedProcedure
    .input(
      z.object({
        textLlmProvider: z.enum(["anthropic", "openai"]),
        textLlmApiKey: z.string().nullable(),
        textLlmModel: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { logger } = ctx;

      logger.info({
        event: "settings.updateTextLlmSettings.start",
        textLlmProvider: input.textLlmProvider,
        textLlmModel: input.textLlmModel,
        hasApiKey: Boolean(input.textLlmApiKey),
      });

      const existingSettings = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, ctx.session.user.id))
        .limit(1);

      const now = new Date();

      if (existingSettings.length === 0) {
        await db.insert(userSettings).values({
          userId: ctx.session.user.id,
          vaultName: null,
          incomingFolder: null,
          locationPermission: "not_asked",
          audioPermission: "not_asked",
          fileCheckInterval: 10,
          textLlmProvider: input.textLlmProvider,
          textLlmApiKey: input.textLlmApiKey,
          textLlmModel: input.textLlmModel,
          createdAt: now,
          updatedAt: now,
        });

        logger.info({
          event: "settings.updateTextLlmSettings.created",
          textLlmProvider: input.textLlmProvider,
          textLlmModel: input.textLlmModel,
        });
      } else {
        await db
          .update(userSettings)
          .set({
            textLlmProvider: input.textLlmProvider,
            textLlmApiKey: input.textLlmApiKey,
            textLlmModel: input.textLlmModel,
            updatedAt: now,
          })
          .where(eq(userSettings.userId, ctx.session.user.id));

        logger.info({
          event: "settings.updateTextLlmSettings.updated",
          textLlmProvider: input.textLlmProvider,
          textLlmModel: input.textLlmModel,
        });
      }

      return {
        success: true,
        textLlmProvider: input.textLlmProvider,
        textLlmModel: input.textLlmModel,
      };
    }),
});
