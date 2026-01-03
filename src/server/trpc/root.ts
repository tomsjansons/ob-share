import { router } from "./trpc";
import { userRouter } from "./routers/user";
import { vaultRouter } from "./routers/vault";

export const appRouter = router({
  user: userRouter,
  vault: vaultRouter,
});

export type AppRouter = typeof appRouter;
