import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { db } from "@/server/db";
import { userSettings } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export const settingsRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const settings = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, ctx.session.user.id))
      .limit(1);

    if (settings.length === 0) {
      // Create default settings if they don't exist
      const now = new Date();
      await db.insert(userSettings).values({
        userId: ctx.session.user.id,
        vaultName: null,
        incomingFolder: null,
        createdAt: now,
        updatedAt: now,
      });

      return {
        vaultName: null,
        incomingFolder: null,
        isComplete: false,
      };
    }

    const { vaultName, incomingFolder } = settings[0];

    return {
      vaultName,
      incomingFolder,
      isComplete: Boolean(vaultName && incomingFolder),
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
      // Clean up the input values
      const vaultName = input.vaultName.trim().replace(/^\/+|\/+$/g, "");
      const incomingFolder = input.incomingFolder.trim().replace(/^\/+|\/+$/g, "");

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
      } else {
        await db
          .update(userSettings)
          .set({
            vaultName,
            incomingFolder,
            updatedAt: now,
          })
          .where(eq(userSettings.userId, ctx.session.user.id));
      }

      return {
        success: true,
        vaultName,
        incomingFolder,
      };
    }),
});
