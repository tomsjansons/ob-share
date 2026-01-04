import { router } from "./trpc";
import { userRouter } from "./routers/user";
import { vaultRouter } from "./routers/vault";
import { settingsRouter } from "./routers/settings";

export const appRouter = router({
  user: userRouter,
  vault: vaultRouter,
  settings: settingsRouter,
});

export type AppRouter = typeof appRouter;
