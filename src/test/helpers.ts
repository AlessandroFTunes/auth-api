import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq, like } from "drizzle-orm";
import { getDb } from "../domain/db/db";
import { users } from "../domain/user/user.sql";
import { User } from "../domain/user/user";
import { refreshTokens } from "../domain/user/token.sql";
import { hashRefreshToken } from "../domain/user/token";

process.env.JWT_SECRET = "segredo-de-teste-com-tamanho-razoavel";

// Testes de integração só rodam com um Postgres de teste explícito.
export const temBanco = Boolean(process.env.TEST_DATABASEURL);

export async function prepararBanco(): Promise<void> {
  const url = process.env.TEST_DATABASEURL;
  if (!url) throw new Error("TEST_DATABASEURL não definida");

  // trava de segurança: nunca roda contra um banco que não tenha "test" no nome
  const nomeBanco = new URL(url).pathname.slice(1);
  if (!/test/i.test(nomeBanco)) {
    throw new Error(`recusando rodar testes no banco "${nomeBanco}": o nome precisa conter "test"`);
  }

  process.env.DATABASEURL = url;
  await migrate(getDb(), {
    migrationsFolder: `${import.meta.dir}/../domain/db/drizzle`,
  });
}

export const novoProjeto = () => `teste-${crypto.randomUUID()}`;
export const novoEmail = () => `u-${crypto.randomUUID()}@teste.com`;

export async function criarUsuario(
  project: string,
  email = novoEmail(),
  senha = "senha-segura-123",
) {
  const auth = await User.create({ email, senha, project });
  return { ...auth, email, senha, project };
}

// remove só o que os testes criaram (projetos "teste-*"); tokens saem por cascade
export async function limparTestes(): Promise<void> {
  await getDb().delete(users).where(like(users.project, "teste-%"));
}

// Simula que o token foi revogado há `ms` milissegundos (para sair da tolerância de reuso).
export async function envelhecerRevogacao(token: string, ms: number): Promise<void> {
  await getDb()
    .update(refreshTokens)
    .set({ revokedAt: new Date(Date.now() - ms) })
    .where(eq(refreshTokens.tokenHash, hashRefreshToken(token)));
}
