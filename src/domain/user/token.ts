import { SignJWT } from "jose";
import { and, eq, gt, isNull } from "drizzle-orm";
import { createTransaction, getDb } from "../db/db";
import { AppError } from "../../error";
import type { Tx } from "../db/db";
import { refreshTokens } from "./token.sql";

const ACCESS_TOKEN_TTL = "15m";
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function secret(): Uint8Array {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET não definida");
  return new TextEncoder().encode(value);
}

export function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(secret());
}

// Refresh token é opaco: o valor aleatório vai pro cliente,
// só o hash SHA-256 é guardado no banco.
export function generateRefreshToken(): { token: string; hash: string } {
  const token = Buffer.from(
    crypto.getRandomValues(new Uint8Array(32)),
  ).toString("base64url");
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

export async function issueRefreshToken(
  tx: Tx,
  userId: string,
): Promise<string> {
  const refresh = generateRefreshToken();
  await tx.insert(refreshTokens).values({
    userId,
    tokenHash: refresh.hash,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });
  return refresh.token;
}

// Idempotente: token inexistente ou já revogado não é erro.
export async function revokeRefreshToken(token: string): Promise<void> {
  await getDb()
    .update(refreshTokens)
    .set({ revokedAt: new Date(), revokedReason: "logout" })
    .where(
      and(
        eq(refreshTokens.tokenHash, hashRefreshToken(token)),
        isNull(refreshTokens.revokedAt),
      ),
    );
}

// Rotação: o refresh token usado é revogado e um novo é emitido.
// Se um token já rotacionado for reapresentado (possível roubo), todas as
// sessões do usuário são encerradas.
export async function rotateRefreshToken(
  token: string,
): Promise<{ userId: string; refreshToken: string }> {
  const hash = hashRefreshToken(token);

  const rotated = await createTransaction(async (tx) => {
    const [old] = await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: "rotated" })
      .where(
        and(
          eq(refreshTokens.tokenHash, hash),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date()),
        ),
      )
      .returning({ userId: refreshTokens.userId });

    if (!old) return null;
    return {
      userId: old.userId,
      refreshToken: await issueRefreshToken(tx, old.userId),
    };
  });

  if (rotated) return rotated;

  const [existing] = await getDb()
    .select({
      userId: refreshTokens.userId,
      revokedReason: refreshTokens.revokedReason,
    })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hash))
    .limit(1);

  // Só reuso de token já rotacionado indica possível roubo; reenviar um
  // token revogado por logout apenas é recusado.
  if (existing?.revokedReason === "rotated") {
    await getDb()
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: "reuse_detected" })
      .where(
        and(
          eq(refreshTokens.userId, existing.userId),
          isNull(refreshTokens.revokedAt),
        ),
      );
  }

  throw new AppError(401, "INVALID_REFRESH_TOKEN", "Refresh token inválido");
}
