import { SignJWT } from "jose";

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
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "base64url",
  );
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}
