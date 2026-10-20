import { describe, expect, it } from "vitest";
import { createLimiter, sharedLimiter } from "./limiter";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, set: (v: number) => (t = v), add: (ms: number) => (t += ms) };
}

describe("createLimiter (janela móvel)", () => {
  it("deixa passar max batidas na janela e recusa a seguinte", () => {
    const c = clock();
    const l = createLimiter({ max: 3, windowMs: 100, now: c.now });
    expect([l.hit("a"), l.hit("a"), l.hit("a"), l.hit("a")]).toEqual([true, true, true, false]);
  });

  it("a janela anda: cada batida sai da conta windowMs depois de entrar", () => {
    const c = clock(0);
    const l = createLimiter({ max: 3, windowMs: 100, now: c.now });
    c.set(0);
    l.hit("a");
    c.set(10);
    l.hit("a");
    c.set(20);
    l.hit("a");
    c.set(99);
    expect(l.hit("a")).toBe(false);
    // Em 100, a batida de 0 saiu: cabe uma.
    c.set(100);
    expect(l.hit("a")).toBe(true);
    // Em 105, ainda estão 10, 20 e 100.
    c.set(105);
    expect(l.hit("a")).toBe(false);
    c.set(110);
    expect(l.hit("a")).toBe(true);
  });

  it("chaves diferentes não dividem a conta", () => {
    const l = createLimiter({ max: 1, windowMs: 100, now: clock().now });
    expect(l.hit("a")).toBe(true);
    expect(l.hit("b")).toBe(true);
    expect(l.hit("a")).toBe(false);
  });

  it("batida recusada não conta: quem insiste não fica preso para sempre", () => {
    const c = clock(0);
    const l = createLimiter({ max: 1, windowMs: 100, now: c.now });
    expect(l.hit("a")).toBe(true);
    for (let t = 1; t < 100; t += 7) {
      c.set(t);
      expect(l.hit("a")).toBe(false);
    }
    c.set(100);
    expect(l.hit("a")).toBe(true);
  });

  it("undo devolve a batida mais nova da chave (quem reservou e não usou)", () => {
    const c = clock(0);
    const l = createLimiter({ max: 2, windowMs: 100, now: c.now });
    expect(l.hit("a")).toBe(true);
    c.set(10);
    expect(l.hit("a")).toBe(true);
    expect(l.hit("a")).toBe(false);
    l.undo("a");
    // Saiu a de 10: cabe uma agora, e a de 0 continua valendo até 100.
    c.set(20);
    expect(l.hit("a")).toBe(true);
    expect(l.hit("a")).toBe(false);
    c.set(100);
    expect(l.hit("a")).toBe(true);
  });

  it("undo sem batida (ou de outra chave) não faz nada", () => {
    const c = clock(0);
    const l = createLimiter({ max: 1, windowMs: 100, now: c.now });
    l.undo("a");
    expect(l.size()).toBe(0);
    expect(l.hit("a")).toBe(true);
    l.undo("b");
    expect(l.hit("a")).toBe(false);
    l.undo("a");
    l.undo("a");
    expect(l.size()).toBe(0);
    expect(l.hit("a")).toBe(true);
    expect(l.hit("a")).toBe(false);
  });

  it("poda: chave sem batida na janela some da memória", () => {
    const c = clock(0);
    const l = createLimiter({ max: 5, windowMs: 100, now: c.now });
    for (let i = 0; i < 50; i++) l.hit(`k${i}`);
    expect(l.size()).toBe(50);
    c.set(250);
    l.hit("nova");
    expect(l.size()).toBe(1);
  });

  it("teto de chaves: a memória nunca passa de maxKeys (sai a mais antiga)", () => {
    const c = clock(0);
    const l = createLimiter({ max: 1, windowMs: 60_000, now: c.now, maxKeys: 100 });
    for (let i = 0; i < 1_000; i++) {
      c.add(1);
      expect(l.hit(`ip-${i}`)).toBe(true);
      expect(l.size()).toBeLessThanOrEqual(100);
    }
    // As mais recentes continuam valendo.
    expect(l.hit("ip-999")).toBe(false);
  });
});

describe("sharedLimiter", () => {
  it("o mesmo nome devolve o mesmo limitador, guardado no globalThis", () => {
    const name = `teste-${Math.random()}`;
    const a = sharedLimiter(name, { max: 1, windowMs: 60_000 });
    const b = sharedLimiter(name, { max: 1, windowMs: 60_000 });
    expect(a).toBe(b);
    expect(a.hit("x")).toBe(true);
    expect(b.hit("x")).toBe(false);
    const g = globalThis as unknown as Record<symbol, unknown>;
    expect(g[Symbol.for(`cardapio-digital.limite.${name}`)]).toBe(a);
    expect(sharedLimiter(`${name}-outro`, { max: 1, windowMs: 60_000 })).not.toBe(a);
  });
});
