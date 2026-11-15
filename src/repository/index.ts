import { CreateUserInput, User } from "../domain/user/user";
import { AppError, errorHandle } from "../error";

const app = Bun.serve({
  routes: {
    "/api/status": new Response("ok"),

    "/api/user": {
      POST: async (req) => {
        try {
          const parsed = CreateUserInput.safeParse(await req.json());
          if (!parsed.success) {
            throw new AppError(
              400,
              "INVALID_INPUT",
              parsed.error.issues.map((i) => i.message).join("; "),
            );
          }

          const { user, accessToken, refreshToken } = await User.create(
            parsed.data,
          );

          return Response.json(
            {
              user: { id: user.id, email: user.email, project: user.project },
              accessToken,
              refreshToken,
            },
            { status: 201 },
          );
        } catch (e) {
          return errorHandle(e);
        }
      },
    },
  },
});
