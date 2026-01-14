import { router } from "./trpc";
import { userRouter } from "./routers/user";
import { vaultRouter } from "./routers/vault";
import { settingsRouter } from "./routers/settings";
import { queueRouter } from "./routers/queue";
import { browserRouter } from "./routers/browser";

export const appRouter = router({
  user: userRouter,
  vault: vaultRouter,
  settings: settingsRouter,
  queue: queueRouter,
  browser: browserRouter,
});

export type AppRouter = typeof appRouter;
