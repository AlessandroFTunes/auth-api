import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { temBanco, prepararBanco, novoProjeto, novoEmail, limparTestes, envelhecerRevogacao } from "../test/helpers";

// porta 0 = o sistema escolhe uma livre; precisa ser definida antes do import
process.env.PORT = "0";
const { app } = await import("./index");
const base = app.url.origin;

const chamar = (metodo: string, caminho: string, corpo?: unknown, headers: Record<string, string> = {}) =>
  fetch(base + caminho, {
    method: metodo,
    headers: { "content-type": "application/json", ...headers },
    body: corpo === undefined ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
const post = (caminho: string, corpo?: unknown, headers?: Record<string, string>) =>
  chamar("POST", caminho, corpo, headers);

afterAll(() => app.stop(true));

describe("rotas que não precisam de banco", () => {
  test("GET /api/status responde ok", async () => {
    const res = await chamar("GET", "/api/status");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  test("rota inexistente dá 404", async () => {
    expect((await chamar("GET", "/api/nao-existe")).status).toBe(404);
  });

  test.each(["/api/user", "/api/login", "/api/refresh", "/api/logout"])(
    "POST %s com JSON inválido dá 400, não 500",
    async (rota) => {
      const res = await post(rota, "{quebrado");
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
    },
  );

  test.each([
    ["/api/user", {}],
    ["/api/user", { email: "ruim", senha: "12345678", project: "p" }],
    ["/api/user", { email: "a@b.com", senha: "curta", project: "p" }],
    ["/api/login", {}],
    ["/api/login", { email: "a@b.com", senha: "", project: "p" }],
    ["/api/refresh", {}],
    ["/api/refresh", { refreshToken: "" }],
    ["/api/logout", {}],
  ])("POST %s com corpo inválido %j dá 400", async (rota, corpo) => {
    const res = await post(rota, corpo);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
  });

  describe("GET /api/me sem credencial válida", () => {
    const naoAutorizado = async (headers?: Record<string, string>) => {
      const res = await chamar("GET", "/api/me", undefined, headers);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "INVALID_TOKEN" } });
    };

    test("sem header Authorization", () => naoAutorizado());
    test("esquema que não é Bearer", () => naoAutorizado({ authorization: "Basic abc" }));
    test("Bearer sem token", () => naoAutorizado({ authorization: "Bearer" }));
    test("token inválido", () => naoAutorizado({ authorization: "Bearer abc.def.ghi" }));
  });
});

describe.skipIf(!temBanco)("fluxo completo com banco", () => {
  beforeAll(prepararBanco);
  afterAll(limparTestes);

  const senha = "senha-segura-123";
  async function cadastrar() {
    const dados = { email: novoEmail(), senha, project: novoProjeto() };
    const res = await post("/api/user", dados);
    return { dados, res, corpo: (await res.json()) as any };
  }

  test("POST /api/user cria o usuário e não vaza o hash da senha", async () => {
    const { dados, res, corpo } = await cadastrar();
    expect(res.status).toBe(201);
    expect(corpo.user).toEqual({ id: expect.any(String), email: dados.email, project: dados.project });
    expect(corpo.accessToken).toBeString();
    expect(corpo.refreshToken).toBeString();
    expect(JSON.stringify(corpo)).not.toContain("argon2");
    expect(JSON.stringify(corpo)).not.toContain("passwordHash");
  });

  test("POST /api/user repetido dá 409", async () => {
    const { dados } = await cadastrar();
    const res = await post("/api/user", { ...dados, email: dados.email.toUpperCase() });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "EMAIL_TAKEN" } });
  });

  test("POST /api/login devolve usuário e tokens", async () => {
    const { dados, corpo: criado } = await cadastrar();
    const res = await post("/api/login", dados);
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as any;
    expect(corpo.user.id).toBe(criado.user.id);
    expect(corpo.refreshToken).not.toBe(criado.refreshToken);
  });

  test("POST /api/login com senha errada dá 401", async () => {
    const { dados } = await cadastrar();
    const res = await post("/api/login", { ...dados, senha: "errada" });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "INVALID_CREDENTIALS" } });
  });

  test("GET /api/me devolve o dono do access token", async () => {
    const { dados, corpo } = await cadastrar();
    const res = await chamar("GET", "/api/me", undefined, { authorization: `Bearer ${corpo.accessToken}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: { id: corpo.user.id, email: dados.email, project: dados.project } });
  });

  test("o esquema Bearer não diferencia maiúsculas", async () => {
    const { corpo } = await cadastrar();
    const res = await chamar("GET", "/api/me", undefined, { authorization: `bearer ${corpo.accessToken}` });
    expect(res.status).toBe(200);
  });

  test("POST /api/refresh rotaciona; o antigo é tolerado por 10s e depois vale como reuso", async () => {
    const { corpo } = await cadastrar();
    const res = await post("/api/refresh", { refreshToken: corpo.refreshToken });
    expect(res.status).toBe(200);
    const novo = (await res.json()) as any;
    expect(novo.user.id).toBe(corpo.user.id);
    expect(novo.refreshToken).not.toBe(corpo.refreshToken);

    // logo depois: tolerado (outra aba mandando o mesmo token)
    expect((await post("/api/refresh", { refreshToken: corpo.refreshToken })).status).toBe(200);

    // passada a tolerância: reuso, 401
    await envelhecerRevogacao(corpo.refreshToken, 60_000);
    const reuso = await post("/api/refresh", { refreshToken: corpo.refreshToken });
    expect(reuso.status).toBe(401);
    expect(await reuso.json()).toMatchObject({ error: { code: "INVALID_REFRESH_TOKEN" } });
  });

  test("POST /api/logout devolve 204 sem corpo e invalida o refresh token", async () => {
    const { corpo } = await cadastrar();
    const res = await post("/api/logout", { refreshToken: corpo.refreshToken });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect((await post("/api/refresh", { refreshToken: corpo.refreshToken })).status).toBe(401);
  });

  test("POST /api/logout com token desconhecido também dá 204", async () => {
    expect((await post("/api/logout", { refreshToken: "nao-existe" })).status).toBe(204);
  });

  describe("rate limit do login", () => {
    const errado = (dados: { email: string; project: string }, headers?: Record<string, string>) =>
      post("/api/login", { ...dados, senha: "errada" }, headers);

    test("a 4ª tentativa seguida dá 429 com Retry-After, até com a senha certa", async () => {
      const { dados } = await cadastrar();
      for (let i = 0; i < 3; i++) expect((await errado(dados)).status).toBe(401);

      const bloqueado = await errado(dados);
      expect(bloqueado.status).toBe(429);
      expect(Number(bloqueado.headers.get("retry-after"))).toBeGreaterThan(290);
      expect(await bloqueado.json()).toMatchObject({ error: { code: "TOO_MANY_ATTEMPTS" } });

      expect((await post("/api/login", dados)).status).toBe(429);
    });

    test("login com sucesso zera a contagem", async () => {
      const { dados } = await cadastrar();
      await errado(dados);
      await errado(dados);
      expect((await post("/api/login", dados)).status).toBe(200);
      await errado(dados);
      await errado(dados);
      expect((await errado(dados)).status).toBe(401); // 3ª falha depois do reset, ainda não bloqueou
    });

    test("bloquear uma conta não afeta outra", async () => {
      const a = (await cadastrar()).dados;
      const b = (await cadastrar()).dados;
      for (let i = 0; i < 4; i++) await errado(a);
      expect((await post("/api/login", b)).status).toBe(200);
    });

    test("com TRUST_CLOUDFLARE, o bloqueio é por IP real (CF-Connecting-IP)", async () => {
      process.env.TRUST_CLOUDFLARE = "true";
      try {
        const { dados } = await cadastrar();
        for (let i = 0; i < 3; i++) await errado(dados, { "cf-connecting-ip": "203.0.113.7" });
        expect((await errado(dados, { "cf-connecting-ip": "203.0.113.7" })).status).toBe(429);
        // outro visitante errando a mesma conta não está bloqueado
        expect((await errado(dados, { "cf-connecting-ip": "198.51.100.9" })).status).toBe(401);
      } finally {
        delete process.env.TRUST_CLOUDFLARE;
      }
    });

    test("sem TRUST_CLOUDFLARE, o header CF-Connecting-IP é ignorado (não dá para burlar)", async () => {
      const { dados } = await cadastrar();
      for (let i = 0; i < 3; i++) await errado(dados, { "cf-connecting-ip": `203.0.113.${i}` });
      expect((await errado(dados, { "cf-connecting-ip": "203.0.113.99" })).status).toBe(429);
    });
  });
});
