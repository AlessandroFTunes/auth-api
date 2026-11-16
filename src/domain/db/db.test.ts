import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { temBanco, prepararBanco, novoProjeto, novoEmail, limparTestes } from "../../test/helpers";
import { Database, createTransaction, getDb } from "./db";
import { users } from "../user/user.sql";

test("sem DATABASEURL, getDb falha com mensagem clara", async () => {
  const dir = `${import.meta.dir}/../../..`;
  const proc = Bun.spawn(
    ["bun", "-e", "import { getDb } from './src/domain/db/db'; getDb();"],
    { cwd: dir, env: { PATH: process.env.PATH }, stderr: "pipe", stdout: "pipe" },
  );
  const stderr = await new Response(proc.stderr).text();
  expect(await proc.exited).not.toBe(0);
  expect(stderr).toContain("DATABASEURL não definida");
});

describe.skipIf(!temBanco)("com banco", () => {
  beforeAll(prepararBanco);
  afterAll(limparTestes);

  test("Database é singleton e getDb reaproveita a instância", () => {
    expect(Database.getInstance()).toBe(Database.getInstance());
    expect(getDb()).toBe(Database.getInstance().db);
  });

  test("a conexão responde", async () => {
    const r = await Database.getInstance().pool.query("select 1 as ok");
    expect(r.rows[0].ok).toBe(1);
  });

  test("createTransaction confirma quando a função termina bem", async () => {
    const project = novoProjeto();
    const email = novoEmail();
    await createTransaction((tx) => tx.insert(users).values({ email, passwordHash: "x", project }));
    const achados = await getDb().select().from(users).where(eq(users.project, project));
    expect(achados).toHaveLength(1);
  });

  test("createTransaction desfaz tudo quando a função lança", async () => {
    const project = novoProjeto();
    await expect(
      createTransaction(async (tx) => {
        await tx.insert(users).values({ email: novoEmail(), passwordHash: "x", project });
        throw new Error("falhou no meio");
      }),
    ).rejects.toThrow("falhou no meio");
    const achados = await getDb().select().from(users).where(eq(users.project, project));
    expect(achados).toHaveLength(0);
  });
});
