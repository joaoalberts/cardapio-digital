// Regras do telão (TV do salão) em funções puras, para os componentes só desenharem. Nada
// aqui fala com a rede nem com o localStorage.
import { inWindow } from "@/lib/menu/hours";
import { t as tr } from "@/lib/menu/i18n";
import { formatPrice, thumbSrc } from "@/lib/menu/media";
import type { MenuItem, PublicMenu } from "@/lib/menu/types";

// ---------- Destaque da casa ----------

const hasPrice = (i: MenuItem) =>
  !i.hide_price && (i.price_options?.length ? i.price_options.some((o) => o.price_cents > 0) : (i.promo_price_cents ?? i.price_cents) > 0);

// O primeiro prato marcado como destaque (★) que tenha preço e esteja no horário agora; sem
// nenhum, o primeiro prato com foto.
export function houseHighlight(menu: PublicMenu, now: Date): MenuItem | null {
  const tz = menu.restaurant.timezone;
  const items = menu.categories
    .filter((c) => inWindow(c.available_from, c.available_to, tz, now))
    .flatMap((c) => c.items)
    .filter((i) => !i.special);
  return items.find((i) => i.featured && hasPrice(i)) ?? items.find((i) => thumbSrc(i) !== null) ?? null;
}

// Preço ao lado do nome do prato: com tamanhos, o menor ("a partir de" quando variam);
// preço escondido ou zero, nada.
export function priceInfo(item: MenuItem | undefined): { cents: number; from: boolean } | null {
  if (!item || item.hide_price) return null;
  if (item.price_options?.length) {
    const p = item.price_options.map((o) => o.price_cents).filter((c) => c > 0);
    if (!p.length) return null;
    return { cents: Math.min(...p), from: new Set(p).size > 1 };
  }
  const c = item.promo_price_cents ?? item.price_cents;
  return c > 0 ? { cents: c, from: false } : null;
}

// Preço junto do nome: "R$ 42"; com tamanhos de preços diferentes, "a partir de R$ 38".
export function priceText(p: { cents: number; from: boolean } | null, lang: string): string | null {
  if (!p) return null;
  return `${p.from ? `${tr("from", lang)} ` : ""}${formatPrice(p.cents, lang)}`;
}

// Tamanho do canvas do fundo do telão: o formato da tela, com 64 px no lado maior (deitada
// 16:9 dá 64×36; em pé, 36×64). Assim a foto é recortada como "cover" na proporção certa e
// não estica em listras na TV em pé. Sem medida (0 ou NaN), o 64×36 de sempre.
export function tvBgSize(width: number, height: number): { w: number; h: number } {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) return { w: 64, h: 36 };
  const short = (n: number) => Math.max(1, Math.round((64 * n) / Math.max(width, height)));
  return width >= height ? { w: 64, h: short(height) } : { w: short(width), h: 64 };
}

// Cor da casa no telão: só hexadecimal passa (o valor vai para o style); senão o dourado do
// cardápio. Os tons claros já vão prontos, sem color-mix (TV antiga não tem).
const TV_ACCENT_DEFAULT = "#e8b04b";
export function tvAccent(c: string | null | undefined): Record<"--accent" | "--accent-9" | "--accent-16" | "--accent-56" | "--accent-70", string> {
  let v = (c ?? "").trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  if (!/^#[0-9a-f]{6}$/.test(v)) v = TV_ACCENT_DEFAULT;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
  const a = (x: number) => `rgba(${r}, ${g}, ${b}, ${x})`;
  return { "--accent": v, "--accent-9": a(0.09), "--accent-16": a(0.16), "--accent-56": a(0.56), "--accent-70": a(0.7) };
}

// Modo simples automático: média acima de 24 ms por quadro nos primeiros 2 s de tela.
export const TV_SLOW_FRAME_MS = 24;
export function tvSlow(frames: number, elapsedMs: number): boolean {
  if (!(elapsedMs > 0)) return false;
  if (!(frames > 0)) return true;
  return elapsedMs / frames > TV_SLOW_FRAME_MS;
}

// Código de pareamento guardado na TV (localStorage tl-code:<slug>): { code, exp, hash }, com
// exp no relógio da própria TV e hash = SHA-256 do segredo que pediu o código. Na recarga, a
// TV mostra o mesmo código sem pedir outro (o pedido novo gasta o limite por IP da rota).
// Renova só depois de vencer, com 1 s de folga: antes disso o servidor devolveria o mesmo.
export type SavedPairCode = { code: string; exp: number };
export const PAIR_RENEW_GRACE_MS = 1_000;
// O servidor dá 10 min; um prazo maior que 11 min daqui é relógio mexido ou lixo.
const PAIR_SAVED_MAX_MS = 11 * 60_000;
const PAIR_CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export function pairCodeDue(c: SavedPairCode | null, nowMs: number): boolean {
  return !c || nowMs >= c.exp + PAIR_RENEW_GRACE_MS;
}

export function pairCodeRecord(c: SavedPairCode, hash: string): string {
  return JSON.stringify({ code: c.code, exp: c.exp, hash });
}

export function savedPairCode(raw: string | null, hash: string, nowMs: number): SavedPairCode | null {
  if (!raw || !HEX64.test(hash)) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const { code, exp, hash: h } = v as Record<string, unknown>;
  if (h !== hash || typeof code !== "string" || !PAIR_CODE.test(code) || typeof exp !== "number" || !Number.isFinite(exp)) return null;
  const c = { code, exp };
  if (pairCodeDue(c, nowMs) || exp - nowMs > PAIR_SAVED_MAX_MS) return null;
  return c;
}

// A página do telão recarrega sozinha a cada 3 h.
export const TV_RELOAD_MS = 3 * 60 * 60_000;
export function tvReloadDue(loadedAt: number, now: number): boolean {
  return now - loadedAt >= TV_RELOAD_MS;
}
