import "server-only";

import { createTRPCContext } from "@/server/trpc/trpc";
import { appRouter } from "@/server/trpc/root";
import { cache } from "react";

const createContext = cache(createTRPCContext);

export const api = {
  user: {
    me: async () => {
      const ctx = await createContext();
      return appRouter.createCaller(ctx).user.me();
    },
  },
};
