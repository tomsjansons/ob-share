import { router } from "./trpc";
import { userRouter } from "./routers/user";
import { vaultRouter } from "./routers/vault";
import { settingsRouter } from "./routers/settings";
import { queueRouter } from "./routers/queue";

export const appRouter = router({
  user: userRouter,
  vault: vaultRouter,
  settings: settingsRouter,
  queue: queueRouter,
});

export type AppRouter = typeof appRouter;
