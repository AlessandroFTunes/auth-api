import { test, expect } from "bun:test";
import { verifyPassword } from "./password";

test("senha correta passa e errada falha", async () => {
  const hash = await Bun.password.hash("senha-certa-123");
  expect(await verifyPassword("senha-certa-123", hash)).toBe(true);
  expect(await verifyPassword("senha-errada", hash)).toBe(false);
  expect(await verifyPassword("", hash)).toBe(false);
});

test("hash ausente (usuário inexistente) sempre falha", async () => {
  expect(await verifyPassword("qualquer", undefined)).toBe(false);
  expect(await verifyPassword("dummy-password", undefined)).toBe(false);
});

test("hash ausente gasta tempo parecido com um verify de verdade (anti-timing)", async () => {
  const hash = await Bun.password.hash("senha-certa-123");
  await verifyPassword("x", undefined); // aquece o cache do hash falso

  const medir = async (fn: () => Promise<unknown>) => {
    const t = performance.now();
    await fn();
    return performance.now() - t;
  };
  const real = await medir(() => verifyPassword("errada", hash));
  const falso = await medir(() => verifyPassword("errada", undefined));

  // sem o hash falso o caminho "usuário inexistente" levaria ~1ms, bem abaixo disso
  expect(falso).toBeGreaterThan(real * 0.3);
});
