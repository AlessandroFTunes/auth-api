import { describe, test, expect } from "bun:test";
import { CreateUserInput, LoginInput, LogoutInput, RefreshInput } from "./user";

const valido = { email: "a@b.com", senha: "12345678", project: "p" };

describe("CreateUserInput", () => {
  test("aceita dados válidos", () => {
    expect(CreateUserInput.parse(valido)).toEqual(valido);
  });

  test("normaliza o email: sem espaços e em minúsculas", () => {
    expect(CreateUserInput.parse({ ...valido, email: "  A@B.Com " }).email).toBe("a@b.com");
  });

  test.each(["", "sem-arroba", "a@", "@b.com", "a b@c.com"])("rejeita email inválido %p", (email) => {
    expect(CreateUserInput.safeParse({ ...valido, email }).success).toBe(false);
  });

  test("senha precisa de 8 caracteres ou mais", () => {
    expect(CreateUserInput.safeParse({ ...valido, senha: "1234567" }).success).toBe(false);
    expect(CreateUserInput.safeParse({ ...valido, senha: "12345678" }).success).toBe(true);
  });

  test("project não pode ser vazio", () => {
    expect(CreateUserInput.safeParse({ ...valido, project: "" }).success).toBe(false);
  });

  test("rejeita campos ausentes e tipos errados", () => {
    expect(CreateUserInput.safeParse({}).success).toBe(false);
    expect(CreateUserInput.safeParse({ email: "a@b.com", senha: "12345678" }).success).toBe(false);
    expect(CreateUserInput.safeParse({ ...valido, senha: 12345678 }).success).toBe(false);
    expect(CreateUserInput.safeParse(null).success).toBe(false);
    expect(CreateUserInput.safeParse("texto").success).toBe(false);
  });
});

describe("LoginInput", () => {
  test("aceita qualquer senha não vazia (a checagem é no hash)", () => {
    expect(LoginInput.safeParse({ ...valido, senha: "x" }).success).toBe(true);
  });

  test("normaliza o email", () => {
    expect(LoginInput.parse({ ...valido, email: "A@B.COM" }).email).toBe("a@b.com");
  });

  test("rejeita senha ou project vazios e email inválido", () => {
    expect(LoginInput.safeParse({ ...valido, senha: "" }).success).toBe(false);
    expect(LoginInput.safeParse({ ...valido, project: "" }).success).toBe(false);
    expect(LoginInput.safeParse({ ...valido, email: "nao-e-email" }).success).toBe(false);
  });
});

describe.each([
  ["RefreshInput", RefreshInput],
  ["LogoutInput", LogoutInput],
])("%s", (_nome, schema) => {
  test("aceita refreshToken não vazio", () => {
    expect(schema.safeParse({ refreshToken: "abc" }).success).toBe(true);
  });

  test("rejeita vazio, ausente e tipo errado", () => {
    expect(schema.safeParse({ refreshToken: "" }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ refreshToken: 123 }).success).toBe(false);
  });
});
