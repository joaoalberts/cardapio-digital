// A6 (revisão final): contraste do texto --faint do cliente e área de toque do "Fechar" do painel,
// lidos direto dos CSS. Contraste pela fórmula da WCAG 2 (luminância relativa), com o rgba
// composto sobre cada fundo.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const cliente = read("./apareca.css");
const painel = read("../../painel/apareca/apareca.css");

const token = (css: string, name: string) => {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`--${name} não encontrado`);
  return m[1].trim();
};
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgba = (s: string) => {
  const m = s.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  if (!m) throw new Error(`rgba inesperado: ${s}`);
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: Number(m[4]) };
};
const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const faintContrast = (bgName: string) => {
  const f = rgba(token(cliente, "faint"));
  const bg = hex(token(cliente, bgName));
  const mixed = f.rgb.map((c, i) => Math.round(c * f.a + bg[i] * (1 - f.a)));
  return ratio(mixed, bg);
};

describe("A6: contraste e toque", () => {
  it.each(["bg", "surface", "surface-2"])("--faint do cliente tem pelo menos 4,5:1 sobre --%s", (bg) => {
    expect(faintContrast(bg)).toBeGreaterThanOrEqual(4.5);
  });
  it("o \"Fechar\" da faixa do painel tem no mínimo 44 px de altura e largura", () => {
    const block = painel.match(/\.app-note-x\s*\{([^}]*)\}/)?.[1] ?? "";
    const px = (prop: string) => Number(block.match(new RegExp(`${prop}:\\s*(\\d+)px`))?.[1] ?? 0);
    expect(px("min-height")).toBeGreaterThanOrEqual(44);
    expect(px("min-width")).toBeGreaterThanOrEqual(44);
  });
});
