import { afterEach, describe, expect, it, vi } from "vitest";
import { nowOffsetMs, serverNow } from "./clock";

// "Adiantar o relógio" existe só para a verificação ponta a ponta: com o driver local de teste.
// Na Vercel (sem STORAGE_DRIVER=local) a variável não muda nada, nem com valor válido.

const BASE = Date.parse("2026-10-17T21:00:00Z");
const H7 = String(7 * 3_600_000);

describe("nowOffsetMs", () => {
  it("vale com STORAGE_DRIVER=local", () => {
    expect(nowOffsetMs({ STORAGE_DRIVER: "local", APARECA_NOW_OFFSET_MS: H7 })).toBe(7 * 3_600_000);
    expect(nowOffsetMs({ STORAGE_DRIVER: "local", APARECA_NOW_OFFSET_MS: "-60000" })).toBe(-60_000);
  });

  it("sem o driver local, a variável é ignorada", () => {
    expect(nowOffsetMs({ APARECA_NOW_OFFSET_MS: H7 })).toBe(0);
    expect(nowOffsetMs({ STORAGE_DRIVER: "blob", APARECA_NOW_OFFSET_MS: H7 })).toBe(0);
    expect(nowOffsetMs({ STORAGE_DRIVER: "LOCAL", APARECA_NOW_OFFSET_MS: H7 })).toBe(0);
    expect(nowOffsetMs({ STORAGE_DRIVER: "", APARECA_NOW_OFFSET_MS: H7 })).toBe(0);
  });

  it("valor torto ou exagerado vira 0", () => {
    for (const v of [undefined, "", "abc", "1e9", "7h", "1.5", String(31 * 24 * 3_600_000), "99999999999999999999"]) {
      expect(nowOffsetMs({ STORAGE_DRIVER: "local", APARECA_NOW_OFFSET_MS: v }), String(v)).toBe(0);
    }
  });
});

describe("serverNow", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("soma o deslocamento só com o driver local", () => {
    expect(serverNow({ STORAGE_DRIVER: "local", APARECA_NOW_OFFSET_MS: H7 }, BASE).getTime()).toBe(BASE + 7 * 3_600_000);
    expect(serverNow({ APARECA_NOW_OFFSET_MS: H7 }, BASE).getTime()).toBe(BASE);
  });

  it("lê process.env por padrão", () => {
    vi.stubEnv("STORAGE_DRIVER", "");
    vi.stubEnv("APARECA_NOW_OFFSET_MS", H7);
    const t = Date.now();
    expect(Math.abs(serverNow().getTime() - t)).toBeLessThan(1_000);
    vi.stubEnv("STORAGE_DRIVER", "local");
    expect(serverNow().getTime() - t).toBeGreaterThanOrEqual(7 * 3_600_000 - 1_000);
  });
});
