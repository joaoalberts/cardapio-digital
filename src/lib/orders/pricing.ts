// Preço e validação de cada linha do pedido. Puro (sem rede): o servidor usa para
// recalcular o pedido e o celular usa para mostrar os mesmos valores.
import { inWindow } from "@/lib/menu/hours";
import { resolveDough } from "./dough";
import type { MenuCategory, MenuItem, PublicMenu } from "@/lib/menu/types";

export const NOTE_MAX = 140;
export const MAX_QTY = 20;
export const MAX_LINES = 30;

// claim = registro da oferta relâmpago pega (special_claims); só nas linhas de produto especial.
export type CartLineInput = {
  item: string;
  option?: string | null;
  half?: string | null;
  dough?: string | null; // massa da pizza; ausente = a primeira da categoria
  qty: number;
  note?: string | null;
  claim?: string | null;
};
// Registro já conferido pelo serviço (mesa, celular, não usado, não vencido).
export type ClaimRef = { item_id: string; item_name: string; unit_cents: number; qty_max: number };
export type PricedLine = {
  item_id: string;
  name: string;
  half_item_id: string | null;
  half_name: string | null;
  option: string | null;
  dough: string | null;
  qty: number;
  unit_cents: number;
  note: string;
  special?: boolean;
  claim?: string; // registro da oferta usado nesta linha (confere quem usou primeiro)
};
export type LineErrorReason = "unavailable" | "no_price" | "option" | "half" | "qty" | "note" | "closed_category" | "special" | "dough";
export type LineError = { index: number; item: string; reason: LineErrorReason };
export type PriceResult = { ok: true; lines: PricedLine[]; total_cents: number } | { ok: false; errors: LineError[] };

export type MenuIndex = { items: Map<string, { item: MenuItem; category: MenuCategory }>; timezone: string };
export type Resolved =
  | { ok: true; unit: number; item: MenuItem; half: MenuItem | null; option: string | null; dough: string | null }
  | { ok: false; reason: LineErrorReason };

// Cada prato pela categoria real dele (o cardápio do banco não tem "Destaques").
// Os produtos especiais entram com a categoria escondida deles.
export function buildIndex(menu: PublicMenu): MenuIndex {
  const items: MenuIndex["items"] = new Map();
  for (const category of menu.specials ? [...menu.categories, menu.specials] : menu.categories) {
    for (const item of category.items) if (!items.has(item.id)) items.set(item.id, { item, category });
  }
  return { items, timezone: menu.restaurant.timezone };
}

// Com tamanhos, o tamanho escolhido manda (como o cardápio já mostra); sem tamanhos, vale a promoção.
export function itemPrice(item: MenuItem, option?: string | null): number | null {
  if (item.hide_price) return null;
  if (item.price_options?.length) {
    const o = item.price_options.find((p) => p.label === option);
    return o ? o.price_cents : null;
  }
  if (option) return null;
  return item.promo_price_cents ?? item.price_cents;
}

// Regra do João (15/10/2026): meio a meio cobra a média, arredondada para cima no centavo.
export function halfPrice(a: number, b: number) {
  return Math.ceil((a + b) / 2);
}

const CONTROL = /[\u0000-\u001f\u007f]/g;

// Observação vira uma linha de texto puro; null = inválida (tipo errado ou longa demais).
export function cleanNote(raw: unknown): string | null {
  if (raw == null) return "";
  if (typeof raw !== "string") return null;
  const s = raw.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  return s.length > NOTE_MAX ? null : s;
}

export function resolveLine(index: MenuIndex, line: Pick<CartLineInput, "item" | "option" | "half" | "dough">, now = new Date()): Resolved {
  const a = index.items.get(line.item);
  if (!a) return { ok: false, reason: "unavailable" };
  if (!inWindow(a.category.available_from, a.category.available_to, index.timezone, now)) {
    return { ok: false, reason: "closed_category" };
  }
  const option = line.option ?? null;
  const pa = itemPrice(a.item, option);
  if (pa == null) return { ok: false, reason: a.item.hide_price ? "no_price" : "option" };
  // A pizza tem uma massa só: o extra entra uma vez, sobre o preço (ou a média do meio a meio).
  const d = resolveDough(a.item, line.dough);
  if (!d.ok) return { ok: false, reason: "dough" };
  if (!line.half) return { ok: true, unit: pa + d.extra, item: a.item, half: null, option, dough: d.dough };
  const b = index.items.get(line.half);
  if (!b || b.item.id === a.item.id || !a.item.half_half || b.category.id !== a.category.id) {
    return { ok: false, reason: "half" };
  }
  const pb = itemPrice(b.item, option);
  if (pb == null) return { ok: false, reason: "half" };
  return { ok: true, unit: halfPrice(pa, pb) + d.extra, item: a.item, half: b.item, option, dough: d.dough };
}

// claims: registros da oferta relâmpago, já validados. A linha com registro sai pelo preço e nome gravados nele.
export function priceCart(menu: PublicMenu, lines: CartLineInput[], now = new Date(), claims: Map<string, ClaimRef> = new Map()): PriceResult {
  if (!lines.length || lines.length > MAX_LINES) return { ok: false, errors: [{ index: -1, item: "", reason: "qty" }] };
  const index = buildIndex(menu);
  const errors: LineError[] = [];
  const out: PricedLine[] = [];
  const usedByClaim = new Map<string, number>(); // um registro vale para o limite dele no pedido inteiro
  lines.forEach((l, i) => {
    const fail = (reason: LineErrorReason) => errors.push({ index: i, item: l.item, reason });
    if (l.claim) {
      const c = claims.get(l.claim);
      if (!c || c.item_id !== l.item || l.half || l.option || l.dough) return fail("special");
      const used = usedByClaim.get(l.claim) ?? 0;
      if (!Number.isInteger(l.qty) || l.qty < 1 || used + l.qty > c.qty_max) return fail("special");
      usedByClaim.set(l.claim, used + l.qty);
      const note = cleanNote(l.note);
      if (note === null) return fail("note");
      out.push({ item_id: l.item, name: c.item_name, half_item_id: null, half_name: null, option: null, dough: null, qty: l.qty, unit_cents: c.unit_cents, note, special: true, claim: l.claim });
      return;
    }
    if (menu.specials?.items.some((it) => it.id === l.item)) return fail("special");
    const r = resolveLine(index, l, now);
    if (!r.ok) return fail(r.reason);
    if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > MAX_QTY) return fail("qty");
    const note = cleanNote(l.note);
    if (note === null) return fail("note");
    out.push({
      item_id: r.item.id,
      name: r.item.name,
      half_item_id: r.half?.id ?? null,
      half_name: r.half?.name ?? null,
      option: r.option,
      dough: r.dough,
      qty: l.qty,
      unit_cents: r.unit,
      note,
    });
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, lines: out, total_cents: out.reduce((s, l) => s + l.unit_cents * l.qty, 0) };
}
