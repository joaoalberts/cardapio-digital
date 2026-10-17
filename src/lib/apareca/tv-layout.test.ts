import { describe, expect, it } from "vitest";
import { LOGO_U, NAME_U, nextDelay, QR_U, stageLayout, stageUnit } from "./tv-layout";

const deitadas = [
  [1280, 720],
  [1920, 1080],
  [3840, 2160],
] as const;

describe("stageLayout", () => {
  it.each(deitadas)("%i×%i: deitada, clipe 9:16 com a altura inteira da tela", (w, h) => {
    const l = stageLayout(w, h);
    expect(l.orientation).toBe("landscape");
    expect(l.clip.h).toBe(h);
    expect(l.clip.w / l.clip.h).toBeCloseTo(9 / 16, 3);
  });

  it("720p, 1080p e 4K: nome, QR e logo na mesma proporção da altura", () => {
    const [a, b, c] = deitadas.map(([w, h]) => {
      const l = stageLayout(w, h);
      return [l.nameFontPx / h, l.qrPx / h, l.logoPx / h];
    });
    for (const i of [0, 1, 2]) {
      expect(b[i]).toBeCloseTo(a[i], 6);
      expect(c[i]).toBeCloseTo(a[i], 6);
    }
    // e nada fica minúsculo em 720p
    const l = stageLayout(1280, 720);
    expect(l.nameFontPx).toBeGreaterThanOrEqual(28);
    expect(l.qrPx).toBeGreaterThanOrEqual(140);
  });

  it("TV em pé (1080×1920): portrait, o clipe ocupa a largura toda", () => {
    const l = stageLayout(1080, 1920);
    expect(l.orientation).toBe("portrait");
    expect(l.clip.w).toBe(1080);
    expect(l.clip.h).toBe(1920);
  });

  it("4:3 (1024×768): deitada e o QR cabe na faixa do lado do clipe", () => {
    const l = stageLayout(1024, 768);
    expect(l.orientation).toBe("landscape");
    expect(l.clip.h).toBe(768);
    expect((1024 - l.clip.w) / 2).toBeGreaterThan(l.qrPx);
  });

  it("tela quase quadrada não tem faixa para o QR: vira o arranjo por cima do vídeo", () => {
    expect(stageLayout(1000, 1000).orientation).toBe("portrait");
    // deitada, mas a faixa ao lado do clipe é estreita demais para o QR
    expect(stageLayout(1020, 1000).orientation).toBe("portrait");
  });

  it.each([
    [1280, 720], [1920, 1080], [3840, 2160], [1080, 1920], [1024, 768], [1000, 1000], [768, 1024], [1080, 1700], [1080, 2400], [2560, 1080],
  ])("%i×%i: nada sai da tela", (w, h) => {
    const l = stageLayout(w, h);
    expect(l.clip.w).toBeLessThanOrEqual(w);
    expect(l.clip.h).toBeLessThanOrEqual(h);
    expect(l.clip.w).toBeGreaterThan(0);
    expect(l.qrPx).toBeLessThan(Math.min(w, h));
  });

  it("medidas saem da mesma unidade --u do telão (min(1vmin, 0,75vmax))", () => {
    expect(stageUnit(1280, 720)).toBeCloseTo(7.2);
    expect(stageUnit(1024, 768)).toBeCloseTo(7.68);
    expect(stageUnit(1080, 1920)).toBeCloseTo(10.8);
    const l = stageLayout(3840, 2160);
    expect(l.nameFontPx).toBeCloseTo(21.6 * NAME_U);
    expect(l.qrPx).toBeCloseTo(21.6 * QR_U);
    expect(l.logoPx).toBeCloseTo(21.6 * LOGO_U);
  });

  it("tamanho inválido (0 antes da primeira leitura) não quebra", () => {
    const l = stageLayout(0, 0);
    expect(l.clip.w).toBeGreaterThan(0);
    expect(Number.isFinite(l.qrPx)).toBe(true);
  });
});

describe("nextDelay", () => {
  it("5 s, 10 s, 20 s e no máximo 30 s", () => {
    expect(nextDelay(0)).toBe(5000);
    expect(nextDelay(1)).toBe(10000);
    expect(nextDelay(2)).toBe(20000);
    expect(nextDelay(3)).toBe(30000);
    expect(nextDelay(9)).toBe(30000);
    expect(nextDelay(-1)).toBe(5000);
    expect(nextDelay(Number.NaN)).toBe(5000);
  });
});
