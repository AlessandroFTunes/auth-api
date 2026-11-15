import { test, expect } from "bun:test";
import { AttemptLimiter } from "./rate-limit";

test("bloqueia após 3 falhas e libera após 5 minutos", () => {
  let t = 0;
  const l = new AttemptLimiter(3, 300_000, () => t);
  l.registrarFalha("k"); l.registrarFalha("k");
  expect(() => l.verificarBloqueio("k")).not.toThrow();
  l.registrarFalha("k");
  expect(() => l.verificarBloqueio("k")).toThrow("Muitas tentativas");
  t = 299_000;
  expect(() => l.verificarBloqueio("k")).toThrow();
  t = 300_001;
  expect(() => l.verificarBloqueio("k")).not.toThrow();
  l.registrarFalha("k"); l.registrarFalha("k");
  expect(() => l.verificarBloqueio("k")).not.toThrow(); // contagem recomeçou
});

test("sucesso zera a contagem e chaves são independentes", () => {
  const l = new AttemptLimiter(3, 300_000, () => 0);
  l.registrarFalha("a"); l.registrarFalha("a"); l.zerarFalhas("a"); l.registrarFalha("a");
  expect(() => l.verificarBloqueio("a")).not.toThrow();
  l.registrarFalha("b"); l.registrarFalha("b"); l.registrarFalha("b");
  expect(() => l.verificarBloqueio("b")).toThrow();
  expect(() => l.verificarBloqueio("a")).not.toThrow();
});
