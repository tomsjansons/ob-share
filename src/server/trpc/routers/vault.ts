import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { saveToVault, dataUrlToBuffer, type LocationInfo, type VaultFile } from "@/lib/vault";
import { db } from "@/server/db";
import { userSettings } from "@/server/db/schema";
import { eq } from "drizzle-orm";

const LocationSchema = z.object({
  country: z.string().optional(),
  city: z.string().optional(),
  area: z.string().optional(),
  street: z.string().optional(),
});

const FileSchema = z.object({
  name: z.string(),
  type: z.string(),
  dataUrl: z.string(),
});

export const vaultRouter = router({
  saveSharedContent: protectedProcedure
    .input(
      z.object({
        title: z.string().optional(),
        text: z.string().optional(),
        url: z.string().optional(),
        files: z.array(FileSchema).optional(),
        location: LocationSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get user's vault settings
      const settings = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, ctx.session.user.id))
        .limit(1);

      if (settings.length === 0 || !settings[0].vaultName || !settings[0].incomingFolder) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Vault settings not configured. Please configure your vault settings first.",
        });
      }

      const vaultConfig = {
        vaultName: settings[0].vaultName,
        incomingFolder: settings[0].incomingFolder,
      };

      // Convert data URLs to buffers for file saving
      const vaultFiles: VaultFile[] = [];

      if (input.files) {
        for (const file of input.files) {
          try {
            const { buffer, mimeType } = dataUrlToBuffer(file.dataUrl);
            vaultFiles.push({
              name: file.name,
              type: mimeType,
              data: buffer,
            });
          } catch (error) {
            console.error(`Error converting file ${file.name}:`, error);
          }
        }
      }

      const result = await saveToVault({
        title: input.title,
        text: input.text,
        url: input.url,
        files: vaultFiles,
        location: input.location as LocationInfo | undefined,
        vaultConfig,
      });

      return result;
    }),
});
