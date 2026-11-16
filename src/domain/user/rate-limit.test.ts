import { describe, test, expect } from "bun:test";
import { AttemptLimiter } from "./rate-limit";
import { AppError } from "../../error";

const CINCO_MIN = 300_000;

function limitador(maximo = 3) {
  const relogio = { t: 0 };
  return { relogio, l: new AttemptLimiter(maximo, CINCO_MIN, () => relogio.t) };
}

describe("AttemptLimiter", () => {
  test("bloqueia após 3 falhas e libera após 5 minutos", () => {
    const { relogio, l } = limitador();
    l.registrarFalha("k");
    l.registrarFalha("k");
    expect(() => l.verificarBloqueio("k")).not.toThrow();
    l.registrarFalha("k");
    expect(() => l.verificarBloqueio("k")).toThrow("Muitas tentativas");

    relogio.t = CINCO_MIN - 1000;
    expect(() => l.verificarBloqueio("k")).toThrow();
    relogio.t = CINCO_MIN + 1;
    expect(() => l.verificarBloqueio("k")).not.toThrow();

    // depois do bloqueio a contagem recomeça do zero
    l.registrarFalha("k");
    l.registrarFalha("k");
    expect(() => l.verificarBloqueio("k")).not.toThrow();
    l.registrarFalha("k");
    expect(() => l.verificarBloqueio("k")).toThrow();
  });

  test("o erro é um 429 com code e retryAfter em segundos", () => {
    const { relogio, l } = limitador();
    for (let i = 0; i < 3; i++) l.registrarFalha("k");

    let erro: unknown;
    try { l.verificarBloqueio("k"); } catch (e) { erro = e; }
    expect(erro).toBeInstanceOf(AppError);
    expect(erro).toMatchObject({ status: 429, code: "TOO_MANY_ATTEMPTS", retryAfter: 300 });

    relogio.t = 100_000; // 100s depois restam 200s
    try { l.verificarBloqueio("k"); } catch (e) { erro = e; }
    expect((erro as AppError).retryAfter).toBe(200);
  });

  test("retryAfter arredonda para cima", () => {
    const { relogio, l } = limitador();
    for (let i = 0; i < 3; i++) l.registrarFalha("k");
    relogio.t = CINCO_MIN - 1; // falta 1ms
    expect(() => l.verificarBloqueio("k")).toThrow(expect.objectContaining({ retryAfter: 1 }));
  });

  test("sucesso (zerarFalhas) zera a contagem", () => {
    const { l } = limitador();
    l.registrarFalha("a");
    l.registrarFalha("a");
    l.zerarFalhas("a");
    l.registrarFalha("a");
    expect(() => l.verificarBloqueio("a")).not.toThrow();
  });

  test("zerarFalhas também desbloqueia", () => {
    const { l } = limitador();
    for (let i = 0; i < 3; i++) l.registrarFalha("k");
    expect(() => l.verificarBloqueio("k")).toThrow();
    l.zerarFalhas("k");
    expect(() => l.verificarBloqueio("k")).not.toThrow();
  });

  test("chaves são independentes", () => {
    const { l } = limitador();
    for (let i = 0; i < 3; i++) l.registrarFalha("b");
    expect(() => l.verificarBloqueio("b")).toThrow();
    expect(() => l.verificarBloqueio("a")).not.toThrow();
  });

  test("falhas antigas expiram: 5 min sem falhar zera a contagem", () => {
    const { relogio, l } = limitador();
    l.registrarFalha("k");
    l.registrarFalha("k");
    relogio.t = CINCO_MIN + 1;
    l.verificarBloqueio("k"); // limpa o registro expirado
    l.registrarFalha("k");
    l.registrarFalha("k");
    expect(() => l.verificarBloqueio("k")).not.toThrow(); // 2 falhas, não 4
  });

  test("respeita um limite diferente de 3", () => {
    const { l } = limitador(5);
    for (let i = 0; i < 4; i++) l.registrarFalha("k");
    expect(() => l.verificarBloqueio("k")).not.toThrow();
    l.registrarFalha("k");
    expect(() => l.verificarBloqueio("k")).toThrow();
  });

  test("chave sem registro nunca está bloqueada", () => {
    expect(() => limitador().l.verificarBloqueio("nova")).not.toThrow();
  });

  test("os valores padrão são 3 falhas e 5 minutos", () => {
    const real = new AttemptLimiter();
    for (let i = 0; i < 3; i++) real.registrarFalha("k");
    expect(() => real.verificarBloqueio("k")).toThrow(expect.objectContaining({ retryAfter: 300 }));
  });
});
