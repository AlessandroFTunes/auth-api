import { CreateUserInput, LoginInput, LogoutInput, RefreshInput, User } from "../domain/user/user";
import { AttemptLimiter } from "../domain/user/rate-limit";
import { AppError, errorHandle } from "../error";

// 3 falhas de login => bloqueio de 5 minutos para aquele IP + conta
const loginLimiter = new AttemptLimiter(3, 5 * 60 * 1000);

// JSON malformado é erro do cliente (400), não do servidor.
async function lerJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError(400, "INVALID_INPUT", "Corpo da requisição não é um JSON válido");
  }
}

// Atrás do Cloudflare + Traefik o IP do socket é o do proxy; o IP real vem em
// CF-Connecting-IP. Só confie nele com TRUST_CLOUDFLARE=true e a API acessível
// apenas pelo Traefik, senão o header pode ser forjado.
function ipDoCliente(req: Request, server: Bun.Server<undefined>): string {
  if (process.env.TRUST_CLOUDFLARE === "true") {
    const ipCloudflare = req.headers.get("cf-connecting-ip");
    if (ipCloudflare) return ipCloudflare;
  }
  return server.requestIP(req)?.address ?? "unknown";
}

export const app = Bun.serve({
  routes: {
    "/api/status": new Response("ok"),

    "/api/user": {
      POST: async (req) => {
        try {
          const parsed = CreateUserInput.safeParse(await lerJson(req));
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

    "/api/login": {
      POST: async (req, server) => {
        try {
          const parsed = LoginInput.safeParse(await lerJson(req));
          if (!parsed.success) {
            throw new AppError(
              400,
              "INVALID_INPUT",
              parsed.error.issues.map((i) => i.message).join("; "),
            );
          }

          const ip = ipDoCliente(req, server);
          const key = `${ip}|${parsed.data.project}|${parsed.data.email.toLowerCase()}`;
          loginLimiter.verificarBloqueio(key);

          let result;
          try {
            result = await User.login(parsed.data);
          } catch (e) {
            if (e instanceof AppError && e.code === "INVALID_CREDENTIALS") {
              loginLimiter.registrarFalha(key);
            }
            throw e;
          }
          loginLimiter.zerarFalhas(key);

          const { user, accessToken, refreshToken } = result;
          return Response.json({
            user: { id: user.id, email: user.email, project: user.project },
            accessToken,
            refreshToken,
          });
        } catch (e) {
          return errorHandle(e);
        }
      },
    },

    "/api/refresh": {
      POST: async (req) => {
        try {
          const parsed = RefreshInput.safeParse(await lerJson(req));
          if (!parsed.success) {
            throw new AppError(
              400,
              "INVALID_INPUT",
              parsed.error.issues.map((i) => i.message).join("; "),
            );
          }

          const { user, accessToken, refreshToken } = await User.refresh(
            parsed.data,
          );

          return Response.json({
            user: { id: user.id, email: user.email, project: user.project },
            accessToken,
            refreshToken,
          });
        } catch (e) {
          return errorHandle(e);
        }
      },
    },

    "/api/me": {
      GET: async (req) => {
        try {
          const [esquema, token] = (req.headers.get("authorization") ?? "").split(" ");
          if (esquema?.toLowerCase() !== "bearer" || !token) {
            throw new AppError(401, "INVALID_TOKEN", "Envie o header Authorization: Bearer <accessToken>");
          }

          const user = await User.me(token);

          return Response.json({
            user: { id: user.id, email: user.email, project: user.project },
          });
        } catch (e) {
          return errorHandle(e);
        }
      },
    },

    "/api/logout": {
      POST: async (req) => {
        try {
          const parsed = LogoutInput.safeParse(await lerJson(req));
          if (!parsed.success) {
            throw new AppError(
              400,
              "INVALID_INPUT",
              parsed.error.issues.map((i) => i.message).join("; "),
            );
          }

          await User.logout(parsed.data);

          return new Response(null, { status: 204 });
        } catch (e) {
          return errorHandle(e);
        }
      },
    },
  },
});
