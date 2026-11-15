import z from "zod";
import { createTransaction } from "../../db";
import { users } from "./user.sql";
import { refreshTokens } from "./token.sql";
import {
  REFRESH_TOKEN_TTL_MS,
  generateRefreshToken,
  signAccessToken,
} from "./token";

export type AuthResult = {
  user: User;
  accessToken: string;
  refreshToken: string;
};

export const CreateUserInput = z.object({
  email: z.string().email(),
  senha: z.string().min(8),
  project: z.string().nullish(),
});

export type CreateUserInput = z.infer<typeof CreateUserInput>;

export class User {
  constructor(
    public readonly id: string,
    public readonly email: string,
    public readonly passwordHash: string,
    public readonly project: string | null,
    public readonly createdAt: Date,
  ) {}

  static async create(input: CreateUserInput): Promise<AuthResult> {
    const hash = await Bun.password.hash(input.senha);
    const refresh = generateRefreshToken();

    const row = await createTransaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          email: input.email,
          passwordHash: hash,
          project: input.project ?? null,
        })
        .returning();

      if (!created) throw new Error("falha ao criar usuário");

      await tx.insert(refreshTokens).values({
        userId: created.id,
        tokenHash: refresh.hash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      });

      return created;
    });

    const accessToken = await signAccessToken(row.id);

    return {
      user: new User(
        row.id,
        row.email,
        row.passwordHash,
        row.project,
        row.createdAt,
      ),
      accessToken,
      refreshToken: refresh.token,
    };
  }
}
