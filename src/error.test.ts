import { test, expect, spyOn } from "bun:test";
import { AppError, errorHandle } from "./error";

test("AppError guarda status, code e mensagem", () => {
  const e = new AppError(404, "NAO_ACHEI", "não achei");
  expect(e).toBeInstanceOf(Error);
  expect(e.name).toBe("AppError");
  expect(e.status).toBe(404);
  expect(e.code).toBe("NAO_ACHEI");
  expect(e.message).toBe("não achei");
  expect(e.retryAfter).toBeUndefined();
});

test("errorHandle devolve o status e o corpo de um AppError", async () => {
  const res = errorHandle(new AppError(409, "EMAIL_TAKEN", "já existe"));
  expect(res.status).toBe(409);
  expect(res.headers.get("retry-after")).toBeNull();
  expect(await res.json()).toEqual({
    error: { code: "EMAIL_TAKEN", message: "já existe" },
  });
});

test("errorHandle envia Retry-After quando o AppError tem retryAfter", () => {
  const res = errorHandle(new AppError(429, "TOO_MANY_ATTEMPTS", "calma", 120));
  expect(res.status).toBe(429);
  expect(res.headers.get("retry-after")).toBe("120");
});

test("erro desconhecido vira 500 sem vazar detalhes", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  const res = errorHandle(new Error("senha do banco: hunter2"));
  expect(res.status).toBe(500);
  const corpo = await res.json();
  expect(corpo).toEqual({ error: { code: "INTERNAL_ERROR", message: "Erro interno" } });
  expect(JSON.stringify(corpo)).not.toContain("hunter2");
  expect(log).toHaveBeenCalledTimes(1); // detalhes só no log do servidor
  log.mockRestore();
});

test("valor que não é Error também vira 500", () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  expect(errorHandle("texto solto").status).toBe(500);
  expect(errorHandle(undefined).status).toBe(500);
  log.mockRestore();
});
