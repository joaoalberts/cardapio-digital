// Regras puras do cardápio em lista (sem React nem rede): o que entra na lista, subgrupos,
// busca, preço curto, cores da marca sobre o fundo escuro e a seção ativa ao rolar.
import { formatPrice } from "./media";
import { tagLabel } from "./tags";
import type { MenuCategory, MenuItem } from "./types";

// A lista não mostra "Destaques" (repete pratos de outras categorias) nem produto especial
// (oferta relâmpago, que tem a tela própria dele); categoria que ficou vazia também sai.
export function listCats(cats: MenuCategory[]): MenuCategory[] {
  return cats
    .filter((c) => c.id !== "destaques")
    .map((c) => ({ ...c, items: c.items.filter((i) => !i.special) }))
    .filter((c) => c.items.length > 0);
}

// Subgrupo = rótulo opcional dentro da categoria (ex.: "Tintos", "Brancos").
export type SubgroupBlock = { label: string | null; items: MenuItem[] };

const SUBGROUP_MAX = 40;

// Texto aparado, espaços repetidos viram um, corta em 40 caracteres; vazio (ou não texto) = sem subgrupo.
export function parseSubgroup(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const clean = raw.trim().replace(/\s+/g, " ");
  // Conta caracteres (não unidades UTF-16), para o corte não partir um emoji ao meio.
  return [...clean].slice(0, SUBGROUP_MAX).join("").trimEnd() || null;
}

// Um bloco por rótulo, na ordem em que o rótulo aparece pela primeira vez; os pratos de cada
// rótulo ficam juntos, na ordem do painel. Prato sem rótulo vai para o bloco `null`.
export function groupSubgroups(items: MenuItem[]): SubgroupBlock[] {
  const blocks = new Map<string | null, MenuItem[]>();
  for (const item of items) {
    // MenuItem.subgroup entra na Tarefa 2; até lá o campo opcional é lido por aqui.
    const label = parseSubgroup((item as MenuItem & { subgroup?: string | null }).subgroup);
    const list = blocks.get(label);
    if (list) list.push(item);
    else blocks.set(label, [item]);
  }
  return [...blocks].map(([label, list]) => ({ label, items: list }));
}

// Minúsculas e sem acento ("Parmesão" -> "parmesao"), para a busca não depender de como se digita.
export function normalizeText(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

// Pratos cujo nome, descrição ou nome de selo (no idioma da tela) contém o que foi digitado.
// Devolve na ordem das categorias e dos pratos; busca vazia não acha nada.
export function searchItems(cats: MenuCategory[], q: string, lang: string): { cat: MenuCategory; item: MenuItem }[] {
  const needle = normalizeText(q).trim();
  if (!needle) return [];
  const found: { cat: MenuCategory; item: MenuItem }[] = [];
  for (const cat of cats) {
    for (const item of cat.items) {
      const fields = [item.name, item.description, ...(item.tags ?? []).map((t) => tagLabel(t, lang))];
      if (fields.some((f) => normalizeText(f).includes(needle))) found.push({ cat, item });
    }
  }
  return found;
}

// O que aparece à direita da linha do prato: tamanhos mostram o menor com "a partir de";
// promoção traz o preço cheio (riscado) em `old`; preço escondido não mostra nada.
export type ListPrice = { from: boolean; old: string | null; now: string } | null;

export function listPrice(item: MenuItem, lang: string): ListPrice {
  if (item.hide_price) return null;
  if (item.price_options?.length) {
    const min = Math.min(...item.price_options.map((o) => o.price_cents));
    return { from: true, old: null, now: formatPrice(min, lang) };
  }
  const promo = item.promo_price_cents;
  if (promo == null) return { from: false, old: null, now: formatPrice(item.price_cents, lang) };
  return { from: false, old: formatPrice(item.price_cents, lang), now: formatPrice(promo, lang) };
}

// ---------------- Cores: a do restaurante e as versões seguras sobre o fundo escuro ----------------
// Mesma conta do protótipo aprovado (themeFor em docs/prototipos/lista/index.html).
const DEFAULT_BRAND = "#e8b04b";
const HEX = /^#[0-9a-f]{6}$/i;

const hex2rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (c: number[]) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const mix = (a: string, b: string, t: number) => {
  const A = hex2rgb(a);
  const B = hex2rgb(b);
  return rgb2hex(A.map((v, i) => v + (B[i] - v) * t));
};
const lum = (h: string) => {
  const [r, g, b] = hex2rgb(h).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

// brand = a cor do restaurante (fundos e traços); brandText = ela como texto, clareada em passos
// de 6 % na direção do creme até dar contraste 4,6:1 sobre a folha de vidro (a parte mais clara do
// fundo tingido); onBrand = o que vai por cima da cor cheia (branco ou marrom-escuro, o de mais contraste).
// Cor inválida ou ausente usa o dourado padrão.
export function brandTokens(hex: string | null): { brand: string; brandText: string; onBrand: string } {
  const trimmed = hex?.trim() ?? "";
  const brand = (HEX.test(trimmed) ? trimmed : DEFAULT_BRAND).toLowerCase();
  const fg = "#f7efe6";
  const bg = mix("#17110e", brand, 0.07);
  const sheet = mix(bg, fg, 0.09);
  let brandText = brand;
  while (contrast(brandText, sheet) < 4.6) brandText = mix(brandText, fg, 0.06);
  const onBrand = contrast("#ffffff", brand) >= contrast("#1a1210", brand) ? "#ffffff" : "#1a1210";
  return { brand, brandText, onBrand };
}

// Seção ativa ao rolar: a última cujo topo já está na linha ou acima dela; -1 se nenhuma passou.
export function activeIndex(tops: number[], line: number): number {
  let active = -1;
  tops.forEach((top, i) => {
    if (top <= line) active = i;
  });
  return active;
}
