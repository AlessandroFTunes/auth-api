import z from "zod";
import { and, eq } from "drizzle-orm";
import { createTransaction, getDb } from "../db/db";
import { AppError } from "../../error";
import { users, type UserRow } from "./user.sql";
import {
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
} from "./token";
import { verifyPassword } from "./password";

export type AuthResult = {
  user: User;
  accessToken: string;
  refreshToken: string;
};

export const CreateUserInput = z.object({
  email: z.string().email(),
  senha: z.string().min(8),
  project: z.string().min(1),
});

export type CreateUserInput = z.infer<typeof CreateUserInput>;

export const LoginInput = z.object({
  email: z.string().email(),
  senha: z.string().min(1),
  project: z.string().min(1),
});

export type LoginInput = z.infer<typeof LoginInput>;

export const RefreshInput = z.object({
  refreshToken: z.string().min(1),
});

export type RefreshInput = z.infer<typeof RefreshInput>;

export const LogoutInput = z.object({
  refreshToken: z.string().min(1),
});

export type LogoutInput = z.infer<typeof LogoutInput>;

export class User {
  constructor(
    public readonly id: string,
    public readonly email: string,
    public readonly passwordHash: string,
    public readonly project: string,
    public readonly createdAt: Date,
  ) {}

  static async get(id: string, project: string): Promise<User> {
    const [row] = await getDb()
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.project, project)))
      .limit(1);

    if (!row) {
      throw new AppError(404, "USER_NOT_FOUND", "Usuário não encontrado");
    }

    return User.fromRow(row);
  }

  static async list(project: string): Promise<User[]> {
    const rows = await getDb()
      .select()
      .from(users)
      .where(eq(users.project, project));

    return rows.map(User.fromRow);
  }

  private static fromRow(row: UserRow): User {
    return new User(
      row.id,
      row.email,
      row.passwordHash,
      row.project,
      row.createdAt,
    );
  }

  static async create(input: CreateUserInput): Promise<AuthResult> {
    const hash = await Bun.password.hash(input.senha);

    const { row, refreshToken } = await createTransaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          email: input.email,
          passwordHash: hash,
          project: input.project,
        })
        .returning();

      if (!created) throw new Error("falha ao criar usuário");

      return {
        row: created,
        refreshToken: await issueRefreshToken(tx, created.id),
      };
    });

    const accessToken = await signAccessToken(row.id);

    return {
      user: User.fromRow(row),
      accessToken,
      refreshToken,
    };
  }

  static async refresh(input: RefreshInput): Promise<AuthResult> {
    const { userId, refreshToken } = await rotateRefreshToken(
      input.refreshToken,
    );

    const [row] = await getDb()
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!row) {
      throw new AppError(401, "INVALID_REFRESH_TOKEN", "Refresh token inválido");
    }

    const accessToken = await signAccessToken(row.id);

    return { user: User.fromRow(row), accessToken, refreshToken };
  }

  static async logout(input: LogoutInput): Promise<void> {
    await revokeRefreshToken(input.refreshToken);
  }

  static async login(input: LoginInput): Promise<AuthResult> {
    const [row] = await getDb()
      .select()
      .from(users)
      .where(
        and(eq(users.project, input.project), eq(users.email, input.email)),
      )
      .limit(1);

    const valid = await verifyPassword(input.senha, row?.passwordHash);

    if (!row || !valid) {
      throw new AppError(
        401,
        "INVALID_CREDENTIALS",
        "Email ou senha inválidos",
      );
    }

    const refreshToken = await createTransaction((tx) =>
      issueRefreshToken(tx, row.id),
    );
    const accessToken = await signAccessToken(row.id);

    return { user: User.fromRow(row), accessToken, refreshToken };
  }
}
