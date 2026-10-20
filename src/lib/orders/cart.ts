// Carrinho do cliente: funções puras sobre a lista de linhas. Linhas iguais (mesmo prato,
// tamanho, 2º sabor e observação) viram uma só, somando a quantidade.
import type { Origin } from "@/lib/comunidade/types";
import { MAX_LINES, MAX_QTY } from "./pricing";

// claim*: oferta relâmpago pega (registro no servidor, preço e nome garantidos no toque).
// origin*: a linha nasceu na Comunidade (enquete ou post, e o momento do toque em ms). A origem
// não entra na chave: somar numa linha igual mantém a origem que já estava (vale o primeiro toque).
export type CartLine = {
  key: string;
  item: string;
  option: string | null;
  half: string | null;
  dough?: string | null; // massa da pizza (só categorias com massas)
  qty: number;
  note: string;
  claim?: string | null;
  claim_cents?: number | null;
  claim_name?: string | null;
  origin?: Origin["origin"] | null;
  origin_ref?: string | null;
  origin_at?: number | null;
};
export type NewLine = Omit<CartLine, "key">;
export type Removed = { line: CartLine; index: number };

export const CART_TTL = 6 * 60 * 60 * 1000;

// JSON e não "join": observação ou opção com "|" não pode fazer duas linhas diferentes virarem a mesma chave.
// Meio a meio: os dois sabores entram em ordem fixa, então Calabresa + Margherita e
// Margherita + Calabresa são a mesma pizza (o preço é a média, igual nos dois sentidos).
// Cada oferta pega é uma linha própria: o registro entra na chave.
// A massa entra na chave só quando existe: a chave das linhas sem massa é a mesma de sempre.
export const lineKey = (l: Pick<CartLine, "item" | "option" | "half" | "note" | "claim" | "dough">) => {
  const flavors = l.half ? [l.item, l.half].sort() : [l.item, ""];
  const base = [...flavors, l.option ?? "", l.note.trim()];
  const withDough = l.dough ? [...base, `massa:${l.dough}`] : base;
  return JSON.stringify(l.claim ? [...withDough, l.claim] : withDough);
};

const cap = (n: number) => Math.max(1, Math.min(MAX_QTY, Math.floor(n)));
const make = (l: NewLine): CartLine => ({ ...l, note: l.note.trim(), qty: cap(l.qty), key: lineKey(l) });

export function addLine(cart: CartLine[], l: NewLine): CartLine[] {
  const key = lineKey(l);
  const i = cart.findIndex((c) => c.key === key);
  if (i >= 0) return cart.map((c, k) => (k === i ? { ...c, qty: cap(c.qty + l.qty) } : c));
  if (cart.length >= MAX_LINES) return cart; // 31ª linha: o servidor recusaria o pedido todo
  return [...cart, make(l)];
}

// Editar (observação, tamanho, outra metade) não muda de onde a linha veio: sem origem nova,
// a linha editada leva a origem da que ela substitui.
export function replaceLine(cart: CartLine[], key: string, next: NewLine): CartLine[] {
  const i = cart.findIndex((c) => c.key === key);
  if (i < 0) return cart;
  const nk = lineKey(next);
  const j = cart.findIndex((c, k) => k !== i && c.key === nk);
  if (j >= 0) return cart.map((c, k) => (k === j ? { ...c, qty: cap(c.qty + next.qty) } : c)).filter((_, k) => k !== i);
  const kept = next.origin ? {} : originOf(cart[i]);
  return cart.map((c, k) => (k === i ? make({ ...next, ...kept }) : c));
}

export function setQty(cart: CartLine[], key: string, qty: number): CartLine[] {
  if (qty < 1) return cart.filter((c) => c.key !== key);
  return cart.map((c) => (c.key === key ? { ...c, qty: cap(qty) } : c));
}

export function removeLine(cart: CartLine[], key: string): { cart: CartLine[]; removed: Removed | null } {
  const index = cart.findIndex((c) => c.key === key);
  if (index < 0) return { cart, removed: null };
  return { cart: cart.filter((_, k) => k !== index), removed: { line: cart[index], index } };
}

export function restoreLine(cart: CartLine[], removed: Removed): CartLine[] {
  if (cart.some((c) => c.key === removed.line.key)) return addLine(cart, removed.line);
  const out = [...cart];
  out.splice(Math.min(removed.index, out.length), 0, removed.line);
  return out;
}

export const cartCount = (cart: CartLine[]) => cart.reduce((s, l) => s + l.qty, 0);

export function cartTotal(cart: CartLine[], unit: (l: CartLine) => number | null) {
  return cart.reduce((s, l) => s + (unit(l) ?? 0) * l.qty, 0);
}

// `ref` é o identificador do envio em andamento: guardado junto, um reenvio depois de recarregar
// (resposta perdida) cai no mesmo pedido em vez de duplicar na cozinha.
export function serializeCart(cart: CartLine[], now: number, ref?: string | null) {
  return JSON.stringify(ref ? { v: 1, savedAt: now, lines: cart, ref } : { v: 1, savedAt: now, lines: cart });
}

const str = (v: unknown): v is string => typeof v === "string";
const optStr = (v: unknown): v is string | null => v === null || typeof v === "string";
const ORIGINS: ReadonlySet<unknown> = new Set<Origin["origin"]>(["comunidade_palco", "comunidade_mural"]);

// Os três campos da origem juntos, ou nada: origem pela metade não serve para atribuir.
function originOf(l: Record<string, unknown>): Partial<Origin> {
  if (!ORIGINS.has(l.origin) || !str(l.origin_ref) || !l.origin_ref || typeof l.origin_at !== "number" || !Number.isFinite(l.origin_at)) return {};
  return { origin: l.origin as Origin["origin"], origin_ref: l.origin_ref, origin_at: l.origin_at };
}

export function parseStoredRef(raw: string | null, now: number): string | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as { v?: number; savedAt?: number; ref?: unknown };
    if (data.v !== 1 || typeof data.savedAt !== "number" || now - data.savedAt > CART_TTL) return null;
    return typeof data.ref === "string" && data.ref ? data.ref : null;
  } catch {
    return null;
  }
}

// O que estiver malformado é descartado em silêncio: o carrinho só ajuda, não pode quebrar o cardápio.
export function parseStoredCart(raw: string | null, now: number): CartLine[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as { v?: number; savedAt?: number; lines?: unknown[] };
    if (data.v !== 1 || typeof data.savedAt !== "number" || now - data.savedAt > CART_TTL || !Array.isArray(data.lines)) return [];
    let cart: CartLine[] = [];
    for (const l of data.lines as Record<string, unknown>[]) {
      if (!l || !str(l.item) || !optStr(l.option) || !optStr(l.half) || !str(l.note) || typeof l.qty !== "number") continue;
      const claim = str(l.claim) && typeof l.claim_cents === "number" && str(l.claim_name)
        ? { claim: l.claim, claim_cents: l.claim_cents, claim_name: l.claim_name }
        : {};
      const dough = str(l.dough) && l.dough ? { dough: l.dough } : {};
      cart = addLine(cart, { item: l.item, option: l.option, half: l.half, note: l.note, qty: l.qty, ...dough, ...claim, ...originOf(l) });
    }
    return cart;
  } catch {
    return [];
  }
}
