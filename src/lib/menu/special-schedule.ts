// Oferta relâmpago no celular do cliente: quando ela pode aparecer e em que story entra.
// Funções puras; o menu-app guarda o relógio no localStorage e injeta o story.
// Regras do spec 2026-10-16-oferta-relampago-design.md (decisões do João e "minhas escolhas").
import { inWindow, localNow, openStatus } from "./hours";
import type { MenuCategory, MenuItem, OpeningHours } from "./types";

// Um relógio só para todas as ofertas: depois de qualquer oferta, a próxima (de qualquer
// produto) espera o intervalo da que apareceu. Nunca duas seguidas.
export type SpecialClock = { v: 1; firstEligibleAt: number | null; nextAt: number | null };
export type OfferPlacement = { itemId: string; catId: string; at: number };

export const SPECIAL_KEY = (slug: string) => `cardapio-special:${slug}`;
const FEATURED_ID = "destaques";
const MIN_STORIES = 3;
const FIRST_MIN_MS = 20_000;
const FIRST_SPAN_MS = 70_000; // 20 a 90 s
const HOUR_MS = 3_600_000;

const EMPTY: SpecialClock = { v: 1, firstEligibleAt: null, nextAt: null };
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function parseClock(raw: string | null): SpecialClock {
  if (!raw) return { ...EMPTY };
  try {
    const d = JSON.parse(raw) as { v?: unknown; firstEligibleAt?: unknown; nextAt?: unknown };
    if (d?.v !== 1) return { ...EMPTY };
    return { v: 1, firstEligibleAt: numOrNull(d.firstEligibleAt), nextAt: numOrNull(d.nextAt) };
  } catch {
    return { ...EMPTY };
  }
}

// Dia e horário no fuso do restaurante, não no do celular.
export function isSpecialOpen(item: MenuItem, timezone: string, now: Date): boolean {
  const s = item.special;
  if (!s) return false;
  if (s.days.length && !s.days.includes(localNow(timezone, now).day)) return false;
  return inWindow(s.from, s.to, timezone, now);
}

export function ensureFirstEligible(clock: SpecialClock, now: number, rnd: () => number): SpecialClock {
  if (clock.firstEligibleAt != null) return clock;
  return { ...clock, firstEligibleAt: now + FIRST_MIN_MS + rnd() * FIRST_SPAN_MS };
}

export function pickSpecial(
  specials: MenuItem[],
  clock: SpecialClock,
  ctx: { now: number; storiesSeen: number; timezone: string; busy: boolean; openingHours?: OpeningHours | null },
  rnd: () => number,
): MenuItem | null {
  if (ctx.busy || ctx.storiesSeen < MIN_STORIES) return null;
  // Restaurante fechado agora: o servidor recusaria a oferta e o pedido.
  if (ctx.openingHours && !openStatus(ctx.openingHours, ctx.timezone, new Date(ctx.now)).open) return null;
  if (clock.firstEligibleAt == null || ctx.now < clock.firstEligibleAt) return null;
  if (clock.nextAt != null && ctx.now < clock.nextAt) return null;
  const open = specials.filter((s) => isSpecialOpen(s, ctx.timezone, new Date(ctx.now)));
  if (!open.length) return null;
  return open[Math.min(open.length - 1, Math.floor(rnd() * open.length))];
}

export function afterShown(clock: SpecialClock, item: MenuItem, now: number): SpecialClock {
  return { ...clock, nextAt: now + (item.special?.every_h ?? 2) * HOUR_MS };
}

// 1 ou 2 stories à frente na categoria atual; sem story à frente, no começo da próxima
// categoria à frente com 2 pratos ou mais (nunca volta para trás). Nunca em "Destaques".
export function placeOffer(cats: MenuCategory[], cur: number, idx: number, itemId: string, rnd: () => number): OfferPlacement | null {
  const here = cats[cur];
  if (here && here.id !== FEATURED_ID && here.items.length >= 2) {
    const at = Math.min(here.items.length - 1, idx + 1 + (rnd() < 0.5 ? 0 : 1));
    if (at > idx) return { itemId, catId: here.id, at };
  }
  for (let k = cur + 1; k < cats.length; k++) {
    const c = cats[k];
    if (c.id !== FEATURED_ID && c.items.length >= 2) return { itemId, catId: c.id, at: 0 };
  }
  return null;
}

export function injectOffer(cats: MenuCategory[], placement: OfferPlacement | null, special: MenuItem | null): MenuCategory[] {
  if (!placement || !special || special.id !== placement.itemId) return cats;
  const i = cats.findIndex((c) => c.id === placement.catId);
  if (i < 0) return cats;
  const c = cats[i];
  if (c.items.some((it) => it.id === special.id)) return cats;
  const at = Math.max(0, Math.min(c.items.length, placement.at));
  const items = [...c.items.slice(0, at), special, ...c.items.slice(at)];
  return cats.map((x, k) => (k === i ? { ...c, items } : x));
}
