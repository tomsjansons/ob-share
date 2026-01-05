import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { db } from "@/server/db";
import { userSettings, type LocationPermissionStatus, type AudioPermissionStatus } from "@/server/db/schema";
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
        createdAt: now,
        updatedAt: now,
      });

      return {
        vaultName: null,
        incomingFolder: null,
        locationPermission: "not_asked" as LocationPermissionStatus,
        audioPermission: "not_asked" as AudioPermissionStatus,
        isComplete: false,
      };
    }

    const { vaultName, incomingFolder, locationPermission, audioPermission } = settings[0];
    const isComplete = Boolean(vaultName && incomingFolder);

    logger.debug({
      event: "settings.get.complete",
      isComplete,
      locationPermission,
      audioPermission,
    });

    return {
      vaultName,
      incomingFolder,
      locationPermission,
      audioPermission,
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
});
