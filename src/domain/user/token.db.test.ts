import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import {
  temBanco, prepararBanco, novoProjeto, criarUsuario, limparTestes, envelhecerRevogacao,
} from "../../test/helpers";
import { getDb, createTransaction } from "../db/db";
import { refreshTokens } from "./token.sql";
import {
  REFRESH_TOKEN_TTL_MS, REUSE_GRACE_MS, hashRefreshToken, issueRefreshToken,
  revokeRefreshToken, rotateRefreshToken,
} from "./token";
import { User } from "./user";

const linha = async (token: string) => {
  const [r] = await getDb().select().from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashRefreshToken(token)));
  return r;
};
const invalido = { status: 401, code: "INVALID_REFRESH_TOKEN" };

describe.skipIf(!temBanco)("refresh tokens no banco", () => {
  beforeAll(prepararBanco);
  afterAll(limparTestes);

  async function usuarioComDuasSessoes() {
    const u = await criarUsuario(novoProjeto());
    const b = await User.login({ email: u.email, senha: u.senha, project: u.project });
    return { u, sessaoA: u.refreshToken, sessaoB: b.refreshToken };
  }

  describe("issueRefreshToken", () => {
    test("guarda só o hash, nunca o token, com validade de 30 dias", async () => {
      const u = await criarUsuario(novoProjeto());
      const token = await createTransaction((tx) => issueRefreshToken(tx, u.user.id));

      const r = await linha(token);
      expect(r).toBeDefined();
      expect(r!.userId).toBe(u.user.id);
      expect(r!.tokenHash).toBe(hashRefreshToken(token));
      expect(r!.tokenHash).not.toBe(token);
      expect(r!.revokedAt).toBeNull();
      expect(r!.revokedReason).toBeNull();
      const dif = r!.expiresAt.getTime() - Date.now();
      expect(Math.abs(dif - REFRESH_TOKEN_TTL_MS)).toBeLessThan(10_000);
    });
  });

  describe("revokeRefreshToken", () => {
    test("marca revokedAt e motivo logout", async () => {
      const { sessaoA } = await usuarioComDuasSessoes();
      await revokeRefreshToken(sessaoA);
      const r = await linha(sessaoA);
      expect(r!.revokedAt).toBeInstanceOf(Date);
      expect(r!.revokedReason).toBe("logout");
    });

    test("é idempotente: a segunda chamada não muda a data", async () => {
      const { sessaoA } = await usuarioComDuasSessoes();
      await revokeRefreshToken(sessaoA);
      const primeira = (await linha(sessaoA))!.revokedAt!.getTime();
      await Bun.sleep(20);
      await revokeRefreshToken(sessaoA);
      expect((await linha(sessaoA))!.revokedAt!.getTime()).toBe(primeira);
    });

    test("token desconhecido não dá erro", async () => {
      await expect(revokeRefreshToken("token-que-nao-existe")).resolves.toBeUndefined();
    });

    test("só revoga o token enviado, não as outras sessões", async () => {
      const { sessaoA, sessaoB } = await usuarioComDuasSessoes();
      await revokeRefreshToken(sessaoA);
      expect((await linha(sessaoB))!.revokedAt).toBeNull();
    });
  });

  describe("rotateRefreshToken", () => {
    test("revoga o antigo (rotated) e emite um novo válido", async () => {
      const { u, sessaoA } = await usuarioComDuasSessoes();
      const r = await rotateRefreshToken(sessaoA);

      expect(r.userId).toBe(u.user.id);
      expect(r.refreshToken).not.toBe(sessaoA);
      const antigo = await linha(sessaoA);
      expect(antigo!.revokedAt).toBeInstanceOf(Date);
      expect(antigo!.revokedReason).toBe("rotated");
      expect((await linha(r.refreshToken))!.revokedAt).toBeNull();
      // o novo também pode ser rotacionado
      await expect(rotateRefreshToken(r.refreshToken)).resolves.toBeDefined();
    });

    test("token desconhecido dá 401", async () => {
      await expect(rotateRefreshToken("nao-existe")).rejects.toMatchObject(invalido);
    });

    test("token expirado dá 401 e não derruba as outras sessões", async () => {
      const { sessaoA, sessaoB } = await usuarioComDuasSessoes();
      await getDb().update(refreshTokens)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(refreshTokens.tokenHash, hashRefreshToken(sessaoA)));

      await expect(rotateRefreshToken(sessaoA)).rejects.toMatchObject(invalido);
      expect((await linha(sessaoA))!.revokedAt).toBeNull();
      expect((await linha(sessaoB))!.revokedAt).toBeNull();
    });

    test("reusar um token rotacionado depois da tolerância derruba todas as sessões (reuse_detected)", async () => {
      const { sessaoA, sessaoB } = await usuarioComDuasSessoes();
      const { refreshToken: novoA } = await rotateRefreshToken(sessaoA);
      await envelhecerRevogacao(sessaoA, REUSE_GRACE_MS + 1000);

      await expect(rotateRefreshToken(sessaoA)).rejects.toMatchObject(invalido);

      for (const t of [sessaoB, novoA]) {
        const r = await linha(t);
        expect(r!.revokedAt).toBeInstanceOf(Date);
        expect(r!.revokedReason).toBe("reuse_detected");
        await expect(rotateRefreshToken(t)).rejects.toMatchObject(invalido);
      }
    });

    describe("tolerância de reuso (10s)", () => {
      test("o valor é de 10 segundos", () => {
        expect(REUSE_GRACE_MS).toBe(10_000);
      });

      test("reenviar logo depois da rotação dá um token novo e não derruba ninguém", async () => {
        const { u, sessaoA, sessaoB } = await usuarioComDuasSessoes();
        const primeira = await rotateRefreshToken(sessaoA);
        const segunda = await rotateRefreshToken(sessaoA); // ex.: a outra aba

        expect(segunda.userId).toBe(u.user.id);
        expect(segunda.refreshToken).not.toBe(primeira.refreshToken);
        // as duas abas ficam com sessões válidas, e a outra sessão do usuário também
        for (const t of [primeira.refreshToken, segunda.refreshToken, sessaoB]) {
          expect((await linha(t))!.revokedAt).toBeNull();
        }
      });

      test("dentro da janela (9s) tolera; fora dela (11s) é reuso", async () => {
        const { sessaoA, sessaoB } = await usuarioComDuasSessoes();
        await rotateRefreshToken(sessaoA);

        await envelhecerRevogacao(sessaoA, 9_000);
        await expect(rotateRefreshToken(sessaoA)).resolves.toBeDefined();

        await envelhecerRevogacao(sessaoA, 11_000);
        await expect(rotateRefreshToken(sessaoA)).rejects.toMatchObject(invalido);
        expect((await linha(sessaoB))!.revokedReason).toBe("reuse_detected");
      });

      test("a tolerância não vale para token revogado por logout", async () => {
        const { sessaoA, sessaoB } = await usuarioComDuasSessoes();
        await revokeRefreshToken(sessaoA);
        await expect(rotateRefreshToken(sessaoA)).rejects.toMatchObject(invalido);
        expect((await linha(sessaoB))!.revokedAt).toBeNull();
      });

      test("a tolerância não vale para token expirado nem desconhecido", async () => {
        await expect(rotateRefreshToken("nao-existe")).rejects.toMatchObject(invalido);
      });
    });

    test("reusar um token revogado por logout só é recusado, sem derrubar o resto", async () => {
      const { sessaoA, sessaoB } = await usuarioComDuasSessoes();
      await revokeRefreshToken(sessaoA);

      await expect(rotateRefreshToken(sessaoA)).rejects.toMatchObject(invalido);

      expect((await linha(sessaoB))!.revokedAt).toBeNull();
      await expect(rotateRefreshToken(sessaoB)).resolves.toBeDefined();
    });

    test("reuso não mexe nas sessões de outro usuário", async () => {
      const { sessaoA } = await usuarioComDuasSessoes();
      const outro = await criarUsuario(novoProjeto());
      await rotateRefreshToken(sessaoA);
      await envelhecerRevogacao(sessaoA, REUSE_GRACE_MS + 1000);
      await expect(rotateRefreshToken(sessaoA)).rejects.toMatchObject(invalido);
      expect((await linha(outro.refreshToken))!.revokedAt).toBeNull();
    });

    test("duas rotações simultâneas do mesmo token: as duas funcionam, cada uma com seu token", async () => {
      const { sessaoA, sessaoB } = await usuarioComDuasSessoes();
      const resultados = await Promise.all([
        rotateRefreshToken(sessaoA),
        rotateRefreshToken(sessaoA),
      ]);
      const [r1, r2] = resultados;
      expect(r1!.refreshToken).not.toBe(r2!.refreshToken);
      for (const t of [r1!.refreshToken, r2!.refreshToken, sessaoB]) {
        expect((await linha(t))!.revokedAt).toBeNull();
      }
    });

    test("cinco rotações simultâneas: nenhuma falha e ninguém é derrubado", async () => {
      const { sessaoA } = await usuarioComDuasSessoes();
      const rs = await Promise.all(Array.from({ length: 5 }, () => rotateRefreshToken(sessaoA)));
      expect(new Set(rs.map((r) => r.refreshToken)).size).toBe(5);
    });
  });
});
