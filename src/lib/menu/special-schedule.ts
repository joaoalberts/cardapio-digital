// Oferta relâmpago no celular do cliente: quando ela pode aparecer e em que story entra.
// Funções puras; o menu-app guarda o relógio no localStorage e injeta o story.
// Regras do spec 2026-10-16-oferta-relampago-design.md (decisões do João e "minhas escolhas").
import { inWindow, localNow, openStatus } from "./hours";
import type { MenuCategory, MenuItem, OpeningHours } from "./types";
import { SPECIAL_TIME_WINDOW_MIN } from "./specials";

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
  const { day, min } = localNow(timezone, now);
  if (s.days.length && !s.days.includes(day)) return false;
  // Horários marcados: só nos 5 minutos de cada um (o de/até não vale nesse modo).
  if (s.times?.length) return s.times.some((t) => {
    const start = Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    return min >= start && min < start + SPECIAL_TIME_WINDOW_MIN;
  });
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
  if (ctx.busy) return null;
  // Restaurante fechado agora: o servidor recusaria a oferta e o pedido.
  if (ctx.openingHours && !openStatus(ctx.openingHours, ctx.timezone, new Date(ctx.now)).open) return null;
  if (clock.nextAt != null && ctx.now < clock.nextAt) return null;
  const open = specials.filter((s) => isSpecialOpen(s, ctx.timezone, new Date(ctx.now)));
  // Horário marcado é pontual: na hora, vale para quem estiver no cardápio, sem esperar
  // os 3 stories nem a primeira visita.
  const timed = open.filter((s) => s.special?.times?.length);
  if (timed.length) return timed[Math.min(timed.length - 1, Math.floor(rnd() * timed.length))];
  if (ctx.storiesSeen < MIN_STORIES) return null;
  if (clock.firstEligibleAt == null || ctx.now < clock.firstEligibleAt) return null;
  if (!open.length) return null;
  return open[Math.min(open.length - 1, Math.floor(rnd() * open.length))];
}

export function afterShown(clock: SpecialClock, item: MenuItem, now: number): SpecialClock {
  return { ...clock, nextAt: now + specialCooldownMs(item) };
}

// Próximo horário marcado (epoch ms) entre os especiais, no fuso do restaurante e nos dias
// permitidos; null sem horários marcados. O menu-app agenda o disparo para esse instante.
export function nextTimedStart(specials: MenuItem[], timezone: string, now: Date): number | null {
  const { day, min } = localNow(timezone, now);
  const base = now.getTime() - (now.getUTCSeconds() * 1000 + now.getUTCMilliseconds()); // início do minuto atual
  let best: number | null = null;
  for (const s of specials) {
    for (const t of s.special?.times ?? []) {
      const tmin = Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
      for (let d = 0; d <= 7; d++) {
        const wd = (day + d) % 7;
        if (s.special!.days.length && !s.special!.days.includes(wd)) continue;
        const at = base + ((d * 1440 + tmin - min) * 60_000);
        if (at <= now.getTime()) continue;
        if (best == null || at < best) best = at;
        break;
      }
    }
  }
  return best;
}

// Quanto o mesmo cliente espera depois de ver a oferta: o intervalo do produto ou, com
// horários marcados, o resto da janela (volta só no próximo horário).
export function specialCooldownMs(item: MenuItem): number {
  if (item.special?.times?.length) return SPECIAL_TIME_WINDOW_MIN * 60_000;
  return (item.special?.every_h ?? 2) * HOUR_MS;
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
