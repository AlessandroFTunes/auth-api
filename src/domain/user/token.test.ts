import { describe, test, expect } from "bun:test";
import { decodeJwt, SignJWT } from "jose";
import "../../test/helpers";
import {
  REFRESH_TOKEN_TTL_MS,
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from "./token";

const chave = (s: string) => new TextEncoder().encode(s);
const agora = () => Math.floor(Date.now() / 1000);
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

describe("signAccessToken", () => {
  test("gera um JWT HS256 com sub e validade de 15 minutos", async () => {
    const token = await signAccessToken("user-1");
    const payload = decodeJwt(token);
    expect(payload.sub).toBe("user-1");
    expect(payload.exp! - payload.iat!).toBe(15 * 60);
    expect(JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString())).toMatchObject({ alg: "HS256" });
  });

  test("falha se JWT_SECRET não estiver definida", async () => {
    const original = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      await expect((async () => signAccessToken("u"))()).rejects.toThrow("JWT_SECRET não definida");
    } finally {
      process.env.JWT_SECRET = original;
    }
  });
});

describe("verifyAccessToken", () => {
  test("devolve o id do usuário de um token válido", async () => {
    expect(await verifyAccessToken(await signAccessToken("user-123"))).toBe("user-123");
  });

  const invalido = { status: 401, code: "INVALID_TOKEN" };

  test("recusa lixo, vazio e token adulterado", async () => {
    const token = await signAccessToken("u");
    await expect(verifyAccessToken("lixo")).rejects.toMatchObject(invalido);
    await expect(verifyAccessToken("")).rejects.toMatchObject(invalido);
    await expect(verifyAccessToken(token + "x")).rejects.toMatchObject(invalido);
  });

  test("recusa token expirado", async () => {
    const expirado = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u")
      .setIssuedAt(agora() - 120)
      .setExpirationTime(agora() - 60)
      .sign(chave(process.env.JWT_SECRET!));
    await expect(verifyAccessToken(expirado)).rejects.toMatchObject(invalido);
  });

  test("recusa token assinado com outro segredo", async () => {
    const falso = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u")
      .setExpirationTime("15m")
      .sign(chave("outro-segredo-qualquer-1234567890"));
    await expect(verifyAccessToken(falso)).rejects.toMatchObject(invalido);
  });

  test("recusa alg=none (token sem assinatura)", async () => {
    const semAssinatura = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: "u", exp: agora() + 600 })}.`;
    await expect(verifyAccessToken(semAssinatura)).rejects.toMatchObject(invalido);
  });

  test("recusa outro algoritmo mesmo com o segredo certo (HS512)", async () => {
    const hs512 = await new SignJWT({})
      .setProtectedHeader({ alg: "HS512" })
      .setSubject("u")
      .setExpirationTime("15m")
      .sign(chave(process.env.JWT_SECRET!));
    await expect(verifyAccessToken(hs512)).rejects.toMatchObject(invalido);
  });

  test("recusa token válido sem sub", async () => {
    const semSub = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("15m")
      .sign(chave(process.env.JWT_SECRET!));
    await expect(verifyAccessToken(semSub)).rejects.toMatchObject(invalido);
  });
});

describe("refresh token opaco", () => {
  test("generateRefreshToken devolve token base64url de 32 bytes e o hash dele", () => {
    const { token, hash } = generateRefreshToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashRefreshToken(token));
    expect(hash).not.toContain(token);
  });

  test("tokens gerados nunca se repetem", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateRefreshToken().token));
    expect(tokens.size).toBe(200);
  });

  test("hashRefreshToken é SHA-256 hexadecimal e determinístico", () => {
    expect(hashRefreshToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashRefreshToken("abc")).toBe(hashRefreshToken("abc"));
    expect(hashRefreshToken("abc")).not.toBe(hashRefreshToken("abd"));
  });

  test("o refresh token vale 30 dias", () => {
    expect(REFRESH_TOKEN_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
