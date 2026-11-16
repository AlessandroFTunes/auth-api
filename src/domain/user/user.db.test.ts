import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import {
  temBanco, prepararBanco, novoProjeto, novoEmail, criarUsuario, limparTestes, envelhecerRevogacao,
} from "../../test/helpers";
import { getDb } from "../db/db";
import { users } from "./user.sql";
import { refreshTokens } from "./token.sql";
import { verifyAccessToken, hashRefreshToken, signAccessToken } from "./token";
import { User } from "./user";

const SENHA = "senha-segura-123";

describe.skipIf(!temBanco)("User no banco", () => {
  beforeAll(prepararBanco);
  afterAll(limparTestes);

  describe("create", () => {
    test("cria o usuário com email normalizado, hash argon2 e tokens", async () => {
      const project = novoProjeto();
      const email = novoEmail();
      const r = await User.create({ email: email.toUpperCase(), senha: SENHA, project });

      expect(r.user.email).toBe(email);
      expect(r.user.project).toBe(project);
      expect(r.user.createdAt).toBeInstanceOf(Date);
      expect(r.user.passwordHash).toStartWith("$argon2");
      expect(r.user.passwordHash).not.toContain(SENHA);
      expect(await verifyAccessToken(r.accessToken)).toBe(r.user.id);

      const [t] = await getDb().select().from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hashRefreshToken(r.refreshToken)));
      expect(t!.userId).toBe(r.user.id);
    });

    test("email repetido no mesmo projeto dá 409, mesmo com maiúsculas", async () => {
      const project = novoProjeto();
      const email = novoEmail();
      await criarUsuario(project, email);
      await expect(User.create({ email: email.toUpperCase(), senha: SENHA, project }))
        .rejects.toMatchObject({ status: 409, code: "EMAIL_TAKEN" });
    });

    test("o mesmo email pode existir em projetos diferentes", async () => {
      const email = novoEmail();
      const a = await criarUsuario(novoProjeto(), email);
      const b = await criarUsuario(novoProjeto(), email);
      expect(a.user.id).not.toBe(b.user.id);
    });

    test("cadastro que falha não deixa usuário órfão", async () => {
      const project = novoProjeto();
      const email = novoEmail();
      await criarUsuario(project, email);
      await User.create({ email, senha: SENHA, project }).catch(() => {});
      const achados = await getDb().select().from(users).where(eq(users.project, project));
      expect(achados).toHaveLength(1);
    });
  });

  describe("login", () => {
    test("devolve o usuário e tokens novos", async () => {
      const u = await criarUsuario(novoProjeto());
      const r = await User.login({ email: u.email, senha: u.senha, project: u.project });
      expect(r.user.id).toBe(u.user.id);
      expect(await verifyAccessToken(r.accessToken)).toBe(u.user.id);
      expect(r.refreshToken).not.toBe(u.refreshToken); // cada login abre uma sessão nova
    });

    test("aceita o email com outras maiúsculas", async () => {
      const u = await criarUsuario(novoProjeto());
      const r = await User.login({ email: u.email.toLowerCase(), senha: u.senha, project: u.project });
      expect(r.user.id).toBe(u.user.id);
    });

    test("senha errada, email inexistente e projeto errado dão o mesmo 401", async () => {
      const u = await criarUsuario(novoProjeto());
      const esperado = { status: 401, code: "INVALID_CREDENTIALS", message: "Email ou senha inválidos" };

      await expect(User.login({ email: u.email, senha: "errada", project: u.project }))
        .rejects.toMatchObject(esperado);
      await expect(User.login({ email: novoEmail(), senha: u.senha, project: u.project }))
        .rejects.toMatchObject(esperado);
      await expect(User.login({ email: u.email, senha: u.senha, project: novoProjeto() }))
        .rejects.toMatchObject(esperado);
    });
  });

  describe("get / getById / list", () => {
    test("get devolve o usuário do projeto certo", async () => {
      const u = await criarUsuario(novoProjeto());
      const achado = await User.get(u.user.id, u.project);
      expect(achado).toBeInstanceOf(User);
      expect(achado.email).toBe(u.email);
    });

    test("get com projeto errado ou id inexistente dá 404", async () => {
      const u = await criarUsuario(novoProjeto());
      await expect(User.get(u.user.id, novoProjeto())).rejects.toMatchObject({ status: 404, code: "USER_NOT_FOUND" });
      await expect(User.get(crypto.randomUUID(), u.project)).rejects.toMatchObject({ status: 404, code: "USER_NOT_FOUND" });
    });

    test("getById acha por id e dá 404 se não existir", async () => {
      const u = await criarUsuario(novoProjeto());
      expect((await User.getById(u.user.id)).project).toBe(u.project);
      await expect(User.getById(crypto.randomUUID())).rejects.toMatchObject({ status: 404 });
    });

    test("list traz só os usuários do projeto", async () => {
      const project = novoProjeto();
      const a = await criarUsuario(project);
      const b = await criarUsuario(project);
      await criarUsuario(novoProjeto());

      const lista = await User.list(project);
      expect(lista.map((x) => x.id).sort()).toEqual([a.user.id, b.user.id].sort());
      expect(await User.list(novoProjeto())).toEqual([]);
    });
  });

  describe("me", () => {
    test("devolve o dono do access token", async () => {
      const u = await criarUsuario(novoProjeto());
      expect((await User.me(u.accessToken)).id).toBe(u.user.id);
    });

    test("token inválido dá 401", async () => {
      await expect(User.me("lixo")).rejects.toMatchObject({ status: 401, code: "INVALID_TOKEN" });
    });

    test("token válido de usuário apagado dá 401", async () => {
      const token = await signAccessToken(crypto.randomUUID());
      await expect(User.me(token)).rejects.toMatchObject({ status: 401, code: "INVALID_TOKEN" });
    });
  });

  describe("refresh", () => {
    test("troca o refresh token e devolve usuário e access token novos", async () => {
      const u = await criarUsuario(novoProjeto());
      const r = await User.refresh({ refreshToken: u.refreshToken });
      expect(r.user.id).toBe(u.user.id);
      expect(r.refreshToken).not.toBe(u.refreshToken);
      expect(await verifyAccessToken(r.accessToken)).toBe(u.user.id);
    });

    test("reenviar o token antigo logo depois (outra aba) ainda funciona", async () => {
      const u = await criarUsuario(novoProjeto());
      await User.refresh({ refreshToken: u.refreshToken });
      await expect(User.refresh({ refreshToken: u.refreshToken })).resolves.toBeDefined();
    });

    test("o token antigo deixa de valer depois da tolerância", async () => {
      const u = await criarUsuario(novoProjeto());
      await User.refresh({ refreshToken: u.refreshToken });
      await envelhecerRevogacao(u.refreshToken, 60_000);
      await expect(User.refresh({ refreshToken: u.refreshToken }))
        .rejects.toMatchObject({ status: 401, code: "INVALID_REFRESH_TOKEN" });
    });

    test("token inexistente dá 401", async () => {
      await expect(User.refresh({ refreshToken: "nao-existe" }))
        .rejects.toMatchObject({ status: 401, code: "INVALID_REFRESH_TOKEN" });
    });
  });

  describe("logout", () => {
    test("invalida o refresh token", async () => {
      const u = await criarUsuario(novoProjeto());
      await expect(User.logout({ refreshToken: u.refreshToken })).resolves.toBeUndefined();
      await expect(User.refresh({ refreshToken: u.refreshToken }))
        .rejects.toMatchObject({ status: 401 });
    });

    test("é idempotente e aceita token desconhecido", async () => {
      const u = await criarUsuario(novoProjeto());
      await User.logout({ refreshToken: u.refreshToken });
      await expect(User.logout({ refreshToken: u.refreshToken })).resolves.toBeUndefined();
      await expect(User.logout({ refreshToken: "qualquer" })).resolves.toBeUndefined();
    });

    test("não afeta outras sessões do mesmo usuário", async () => {
      const u = await criarUsuario(novoProjeto());
      const outra = await User.login({ email: u.email, senha: u.senha, project: u.project });
      await User.logout({ refreshToken: u.refreshToken });
      await expect(User.refresh({ refreshToken: outra.refreshToken })).resolves.toBeDefined();
    });
  });
});
