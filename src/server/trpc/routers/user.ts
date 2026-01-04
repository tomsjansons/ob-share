import { router, protectedProcedure } from "../trpc";

export const userRouter = router({
  me: protectedProcedure.query(async ({ ctx }) => {
    ctx.logger.debug({
      event: "user.me.query",
    });

    return {
      id: ctx.session.user.id,
      name: ctx.session.user.name,
      email: ctx.session.user.email,
      image: ctx.session.user.image,
    };
  }),
});
