import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { saveToVault, dataUrlToBuffer, type LocationInfo, type VaultFile } from "@/lib/vault";
import { db } from "@/server/db";
import { userSettings } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { sanitizeFileForLogging } from "@/lib/logger";

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
      const { logger } = ctx;

      // Log the save attempt with safe metadata only
      logger.info({
        event: "vault.save.start",
        hasTitle: Boolean(input.title),
        hasText: Boolean(input.text),
        hasUrl: Boolean(input.url),
        fileCount: input.files?.length ?? 0,
        hasLocation: Boolean(input.location),
      });

      // Get user's vault settings
      const settings = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, ctx.session.user.id))
        .limit(1);

      if (settings.length === 0 || !settings[0].vaultName || !settings[0].incomingFolder) {
        logger.warn({
          event: "vault.save.settings_missing",
          userId: ctx.session.user.id,
        });

        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Vault settings not configured. Please configure your vault settings first.",
        });
      }

      const vaultConfig = {
        vaultName: settings[0].vaultName,
        incomingFolder: settings[0].incomingFolder,
      };

      logger.debug({
        event: "vault.save.config_loaded",
        vaultName: vaultConfig.vaultName,
        incomingFolder: vaultConfig.incomingFolder,
      });

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

            logger.debug({
              event: "vault.save.file_converted",
              file: sanitizeFileForLogging({ name: file.name, type: mimeType, size: buffer.length }),
            });
          } catch (error) {
            logger.error({
              event: "vault.save.file_conversion_error",
              file: sanitizeFileForLogging(file),
              error: error instanceof Error ? error.message : "Unknown error",
            });
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

      if (result.success) {
        logger.info({
          event: "vault.save.complete",
          notePath: result.notePath,
          savedFilesCount: result.savedFiles?.length ?? 0,
        });
      } else {
        logger.error({
          event: "vault.save.failed",
          error: result.error,
        });
      }

      return result;
    }),
});
