"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { MenuItem, PublicMenu } from "@/lib/menu/types";
import { tf, t as tr } from "@/lib/menu/i18n";
import { formatPrice, thumbSrc } from "@/lib/menu/media";
import { buildIndex, resolveLine } from "@/lib/orders/pricing";
import {
  addLine, cartCount, cartTotal, parseStoredCart, parseStoredRef, removeLine, replaceLine, restoreLine, serializeCart, setQty as setLineQty,
  type CartLine, type NewLine,
} from "@/lib/orders/cart";
import type { CreateResult, PublicOrder } from "@/lib/orders/service";
import { useDeviceOrders } from "./use-device-orders";
import { flyTo } from "./fly";

export type Table = { code: string; label: string };
export type SheetState =
  | { kind: "item"; item: MenuItem; focusNote: boolean; edit: CartLine | null }
  | { kind: "cart"; tab: "cart" | "orders" }
  | null;
export type FlashState = { id: number; label: string; text: string; img: string | null; tone: "added" | "ok" } | null;
export type SendOutcome = { ok: true; order: PublicOrder; number: number; priceChanged: boolean } | { ok: false; message: string };

type OrderApi = {
  enabled: boolean;
  lang: string;
  table: Table | null;
  menu: PublicMenu | null;
  lines: CartLine[];
  sheet: SheetState;
  flash: FlashState;
  toast: { text: string; undo?: () => void } | null;
  orders: PublicOrder[];
  viewerOpen: boolean;
  islandRef: RefObject<HTMLButtonElement | null>;
  sheetOpenRef: RefObject<boolean>;
  syncMenu: (menu: PublicMenu) => void;
  setTable: (t: Table | null) => void;
  setViewerOpen: (open: boolean) => void;
  unit: (l: Pick<CartLine, "item" | "option" | "half">) => number | null;
  itemById: (id: string) => MenuItem | undefined;
  inCart: (itemId: string) => number;
  add: (l: NewLine, from?: HTMLElement | null) => void;
  replace: (key: string, l: NewLine) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  openItem: (item: MenuItem, opts?: { focusNote?: boolean; edit?: CartLine }) => void;
  openCart: (tab?: "cart" | "orders") => void;
  closeSheet: () => void;
  send: () => Promise<SendOutcome>;
};

const Ctx = createContext<OrderApi | null>(null);
const DEVICE_KEY = "cardapio-device";

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

export function useOrder() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useOrder fora do OrderProvider");
  return c;
}

export function OrderProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const [menu, setMenu] = useState<PublicMenu | null>(null);
  const [table, setTable] = useState<Table | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [flash, setFlash] = useState<FlashState>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [device, setDevice] = useState<string | null>(null);
  const islandRef = useRef<HTMLButtonElement | null>(null);
  const sheetOpenRef = useRef(false);
  const refAttempt = useRef<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loadedKey = useRef<string | null>(null);
  const dirty = useRef(false); // só grava o carrinho depois de uma mudança do próprio cliente (6 h contam da última mudança)

  const lang = menu?.restaurant.language ?? "pt-BR";
  const enabled = !!table && !!menu?.restaurant.orders_enabled;
  const cartKey = table ? `cardapio-cart:${slug}:${table.code}` : null;
  const index = useMemo(() => (menu ? buildIndex(menu) : null), [menu]);

  // Id anônimo deste celular: é ele que separa "Meus pedidos" de outros clientes da mesa.
  useEffect(() => {
    let d = store.get(DEVICE_KEY);
    if (!d || !/^[0-9a-f-]{36}$/.test(d)) {
      d = crypto.randomUUID();
      store.set(DEVICE_KEY, d);
    }
    queueMicrotask(() => setDevice(d)); // lê o localStorage só no cliente; fora do corpo do efeito
  }, []);

  // Carrinho guardado por restaurante e mesa (6 h).
  useEffect(() => {
    if (!cartKey || loadedKey.current === cartKey) return;
    loadedKey.current = cartKey;
    dirty.current = false;
    const raw = store.get(cartKey);
    refAttempt.current = parseStoredRef(raw, Date.now()); // envio que ficou sem resposta: o mesmo ref evita pedido duplicado
    setLines(parseStoredCart(raw, Date.now()));
  }, [cartKey]);
  useEffect(() => {
    if (cartKey && loadedKey.current === cartKey && dirty.current) {
      refAttempt.current = null; // o cliente mudou o carrinho: o próximo envio é outro pedido
      store.set(cartKey, serializeCart(lines, Date.now()));
      dirty.current = false;
    }
  }, [lines, cartKey]);

  useEffect(() => {
    sheetOpenRef.current = sheet !== null;
  }, [sheet]);

  const { orders, push } = useDeviceOrders(slug, device, enabled);

  const showFlash = useCallback((f: Omit<NonNullable<FlashState>, "id">, ms = 1500) => {
    clearTimeout(flashTimer.current);
    setFlash({ ...f, id: Date.now() });
    flashTimer.current = setTimeout(() => setFlash(null), ms);
  }, []);
  const showToast = useCallback((text: string, undo?: () => void) => {
    clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // A cozinha marcou pronto: a ilha avisa.
  const lastStatus = useRef(new Map<string, string>());
  useEffect(() => {
    const ordered = [...orders].reverse();
    ordered.forEach((o, i) => {
      const before = lastStatus.current.get(o.id);
      if (before && before !== "ready" && o.status === "ready") {
        showFlash({ label: tr("oStReady", lang), text: tf("oReadyBody", lang, { n: i + 1 }), img: null, tone: "ok" }, 2400);
      }
      lastStatus.current.set(o.id, o.status);
    });
  }, [orders, lang, showFlash]);

  const itemById = useCallback((id: string) => index?.items.get(id)?.item, [index]);
  const unit = useCallback(
    (l: Pick<CartLine, "item" | "option" | "half">) => {
      if (!index) return null;
      const r = resolveLine(index, l);
      return r.ok ? r.unit : null;
    },
    [index],
  );

  const add = useCallback(
    (l: NewLine, from?: HTMLElement | null) => {
      dirty.current = true;
      setLines((c) => addLine(c, l));
      try {
        navigator.vibrate?.(12);
      } catch {}
      const it = index?.items.get(l.item)?.item;
      const img = it ? thumbSrc(it) : null;
      const half = l.half ? index?.items.get(l.half)?.item : undefined;
      const name = half ? `½ ${it?.name} + ½ ${half.name}` : `${l.qty > 1 ? `${l.qty}× ` : ""}${it?.name ?? ""}`;
      const done = () => showFlash({ label: tr("oAdded", lang), text: name, img, tone: "added" });
      if (from && islandRef.current) void flyTo(from, islandRef.current, img).then(done);
      else done();
    },
    [index, lang, showFlash],
  );

  const remove = useCallback(
    (key: string) => {
      dirty.current = true;
      setLines((c) => {
        const { cart, removed } = removeLine(c, key);
        if (removed) {
          const name = index?.items.get(removed.line.item)?.item.name ?? "";
          showToast(tf("oRemoved", lang, { name }), () => {
            dirty.current = true;
            setLines((now) => restoreLine(now, removed));
          });
        }
        return cart;
      });
    },
    [index, lang, showToast],
  );

  const send = useCallback(async (): Promise<SendOutcome> => {
    if (!table || !device || !lines.length) return { ok: false, message: tr("oErrNet", lang) };
    if (!refAttempt.current) {
      refAttempt.current = crypto.randomUUID();
      // Grava já: se a resposta se perder e a página recarregar, o reenvio usa o mesmo ref.
      if (cartKey) store.set(cartKey, serializeCart(lines, Date.now(), refAttempt.current));
    }
    const shownTotal = cartTotal(lines, unit);
    let res: CreateResult | null = null;
    try {
      const r = await fetch(`/api/pedidos/${slug}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mesa: table.code,
          device,
          ref: refAttempt.current,
          lines: lines.map(({ item, option, half, qty, note }) => ({ item, option, half, qty, note })),
        }),
      });
      res = (await r.json().catch(() => null)) as CreateResult | null;
    } catch {
      res = null;
    }
    if (!res) return { ok: false, message: tr("oErrNet", lang) };
    if (res.ok) {
      const created = res.order; // const: o TypeScript não estreita "res" dentro do filter
      // "Pedido N" conta os pedidos já carregados em `orders` (a API devolve no máximo 20).
      const number = orders.filter((o) => o.id !== created.id).length + 1;
      push(created);
      dirty.current = true;
      setLines([]);
      refAttempt.current = null;
      showFlash({ label: tr("oSentShort", lang), text: tf("oOrderN", lang, { n: number }), img: null, tone: "ok" }, 2000);
      return { ok: true, order: created, number, priceChanged: created.total_cents !== shownTotal };
    }
    if (res.code === "closed") {
      return { ok: false, message: res.opensAt ? tf("oErrClosedAt", lang, { time: res.opensAt }) : tr("oErrClosed", lang) };
    }
    if (res.code === "lines" && res.errors?.length) {
      // Tira do carrinho o que não pode mais ser pedido e explica qual foi.
      // Por chave, não por índice: o cliente pode ter mexido no carrinho durante o envio.
      const badKeys = new Set(res.errors.map((e) => lines[e.index]?.key).filter(Boolean));
      const first = lines[res.errors[0].index];
      const name = (first && index?.items.get(first.item)?.item.name) || "";
      dirty.current = true;
      setLines((c) => c.filter((l) => !badKeys.has(l.key)));
      return { ok: false, message: tf("oErrGone", lang, { name }) };
    }
    if (res.code === "invalid") return { ok: false, message: tr("oErrInvalid", lang) };
    if (res.code === "table" || res.code === "disabled") return { ok: false, message: tr("oErrTable", lang) };
    return { ok: false, message: tr("oErrNet", lang) };
  }, [table, device, cartKey, lines, lang, slug, unit, orders, push, showFlash, index]);

  const api: OrderApi = {
    enabled,
    lang,
    table,
    menu,
    lines,
    sheet,
    flash,
    toast,
    orders,
    viewerOpen,
    islandRef,
    sheetOpenRef,
    syncMenu: setMenu,
    setTable,
    setViewerOpen,
    unit,
    itemById,
    inCart: (id) => lines.filter((l) => l.item === id || l.half === id).reduce((s, l) => s + l.qty, 0),
    add,
    replace: (key, l) => {
      dirty.current = true;
      setLines((c) => replaceLine(c, key, l));
    },
    setQty: (key, qty) => {
      dirty.current = true;
      setLines((c) => setLineQty(c, key, qty));
    },
    remove,
    openItem: (item, opts) => setSheet({ kind: "item", item, focusNote: !!opts?.focusNote, edit: opts?.edit ?? null }),
    openCart: (tab = "cart") => setSheet({ kind: "cart", tab }),
    closeSheet: () => setSheet(null),
    send,
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export const money = (cents: number, lang: string) => formatPrice(cents, lang);
export const countLabel = (n: number, lang: string) => (n === 1 ? tr("oItem1", lang) : tf("oItems", lang, { n }));
export { cartCount, cartTotal };
