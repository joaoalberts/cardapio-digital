"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { uuid } from "@/lib/uuid";
import type { MenuItem, PublicMenu } from "@/lib/menu/types";
import { tf, t as tr } from "@/lib/menu/i18n";
import { formatPrice, thumbSrc } from "@/lib/menu/media";
import { buildIndex, itemPrice, resolveLine } from "@/lib/orders/pricing";
import {
  addLine, cartCount, cartTotal, parseStoredCart, parseStoredRef, removeLine, replaceLine, restoreLine, serializeCart, setQty as setLineQty,
  type CartLine, type NewLine,
} from "@/lib/orders/cart";
import type { CreateResult, PublicOrder } from "@/lib/orders/service";
import { useDeviceOrders } from "./use-device-orders";
import { flyTo } from "./fly";

export type Table = { code: string; label: string };
export type SheetState =
  | { kind: "item"; item: MenuItem; focusNote: boolean; edit: CartLine | null; draft?: { option: string | null; note: string }; qty?: number }
  | { kind: "cart"; tab: "cart" | "orders" }
  | null;
export type FlashState = { id: number; label: string; text: string; img: string | null; tone: "added" | "ok" } | null;
export type SendOutcome = { ok: true; order: PublicOrder; number: number; priceChanged: boolean } | { ok: false; message: string };
// Meio a meio escolhido navegando: a folha se comprime numa barrinha e o cliente vai até o
// outro sabor. Em uma troca (Editar > trocar), `swap` diz qual linha e qual metade sai.
export type PickState = {
  keep: MenuItem; // a metade que fica
  option: string | null;
  note: string;
  swap: { key: string; side: "item" | "half" } | null;
  fromSheet?: boolean; // troca começada na folha do prato (Editar > Observação): desistir volta a ela
  qty?: number; // quantidade escolhida no story
} | null;

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
  unit: (l: Pick<CartLine, "item" | "option" | "half" | "claim_cents">) => number | null;
  itemById: (id: string) => MenuItem | undefined;
  inCart: (itemId: string) => number;
  add: (l: NewLine, from?: HTMLElement | null) => void;
  // Oferta relâmpago: grava o registro no servidor e põe a linha com o preço garantido.
  takeSpecial: (item: MenuItem, qty: number) => Promise<{ ok: true; cents: number } | { ok: false }>;
  replace: (key: string, l: NewLine) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  openItem: (item: MenuItem, opts?: { focusNote?: boolean; edit?: CartLine; qty?: number }) => void;
  openCart: (tab?: "cart" | "orders") => void;
  closeSheet: () => void;
  send: () => Promise<SendOutcome>;
  current: MenuItem | null; // prato do story na tela (null fora dos stories)
  setCurrent: (item: MenuItem | null) => void;
  pick: PickState;
  startPick: (p: NonNullable<PickState>) => void;
  cancelPick: () => void;
  canPair: (candidate: MenuItem | null) => boolean;
  pair: (candidate: MenuItem) => void;
  editing: boolean;
  setEditing: (on: boolean) => void;
  cartMin: boolean;
  minimizeCart: () => void;
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
  const [current, setCurrent] = useState<MenuItem | null>(null);
  const [pick, setPick] = useState<PickState>(null);
  const [editing, setEditing] = useState(false);
  const [cartMin, setCartMin] = useState(false);
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
      d = uuid();
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
    (l: Pick<CartLine, "item" | "option" | "half" | "claim_cents">) => {
      if (l.claim_cents != null) return l.claim_cents; // oferta relâmpago: o preço do registro
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
          const name = index?.items.get(removed.line.item)?.item.name ?? removed.line.claim_name ?? "";
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

  const takeSpecial = useCallback(
    async (item: MenuItem, qty: number): Promise<{ ok: true; cents: number } | { ok: false }> => {
      if (!table || !device || !enabled) return { ok: false };
      // Rede parada não pode prender o cliente no botão: em 6 s conta como falha.
      const ctrl = new AbortController();
      const stop = setTimeout(() => ctrl.abort(), 6000);
      try {
        const r = await fetch(`/api/especiais/${slug}/pegar`, {
          signal: ctrl.signal,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mesa: table.code, device, item: item.id }),
        });
        const res = (await r.json().catch(() => null)) as { ok: boolean; claim?: string; unit_cents?: number; qty_max?: number; name?: string } | null;
        if (!res?.ok || !res.claim || typeof res.unit_cents !== "number") return { ok: false };
        const n = Math.max(1, Math.min(res.qty_max ?? 1, Math.floor(qty)));
        dirty.current = true;
        setLines((c) => addLine(c, { item: item.id, option: null, half: null, qty: n, note: "", claim: res.claim, claim_cents: res.unit_cents, claim_name: res.name ?? item.name }));
        try {
          navigator.vibrate?.(18);
        } catch {}
        return { ok: true, cents: res.unit_cents };
      } catch {
        return { ok: false };
      } finally {
        clearTimeout(stop);
      }
    },
    [table, device, enabled, slug],
  );

  const send = useCallback(async (): Promise<SendOutcome> => {
    if (!table || !device || !lines.length) return { ok: false, message: tr("oErrNet", lang) };
    if (!refAttempt.current) {
      refAttempt.current = uuid();
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
          lines: lines.map(({ item, option, half, qty, note, claim }) => (claim ? { item, option, half, qty, note, claim } : { item, option, half, qty, note })),
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
      const name = (first && (index?.items.get(first.item)?.item.name ?? first.claim_name)) || "";
      dirty.current = true;
      setLines((c) => c.filter((l) => !badKeys.has(l.key)));
      if (res.errors.some((e) => e.reason === "special")) return { ok: false, message: tr("oSpecialInvalid", lang) };
      return { ok: false, message: tf("oErrGone", lang, { name }) };
    }
    if (res.code === "invalid") return { ok: false, message: tr("oErrInvalid", lang) };
    if (res.code === "table" || res.code === "disabled") return { ok: false, message: tr("oErrTable", lang) };
    return { ok: false, message: tr("oErrNet", lang) };
  }, [table, device, cartKey, lines, lang, slug, unit, orders, push, showFlash, index]);

  // A outra metade precisa ser da mesma categoria, ter o mesmo tamanho e não ser o próprio sabor que fica.
  // Numa troca, o sabor que está saindo também não serve (trocar Calabresa por Calabresa não muda nada).
  const swapOut = (() => {
    if (!pick?.swap) return null;
    const l = lines.find((x) => x.key === pick.swap!.key);
    return l ? (pick.swap.side === "item" ? l.item : l.half) : null;
  })();
  const canPair = (c: MenuItem | null) =>
    !!pick && !!c && c.id !== pick.keep.id && c.id !== swapOut && c.category_id === pick.keep.category_id && !c.hide_price && itemPrice(c, pick.option) != null;

  const pair = (c: MenuItem) => {
    if (!pick || !canPair(c)) return;
    const p = pick;
    setPick(null);
    setCartMin(false);
    if (p.swap) {
      const line = lines.find((l) => l.key === p.swap!.key);
      if (line) {
        const next = p.swap.side === "item" ? { item: c.id, half: line.half } : { item: line.item, half: c.id };
        dirty.current = true;
        setLines((cart) => replaceLine(cart, line.key, { ...next, option: p.option, qty: line.qty, note: p.note }));
      }
      setEditing(true);
    } else {
      add({ item: p.keep.id, option: p.option, half: c.id, qty: p.qty ?? 1, note: p.note });
    }
    setSheet({ kind: "cart", tab: "cart" });
  };

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
    takeSpecial,
    replace: (key, l) => {
      dirty.current = true;
      setLines((c) => replaceLine(c, key, l));
    },
    setQty: (key, qty) => {
      dirty.current = true;
      setLines((c) => setLineQty(c, key, qty));
    },
    remove,
    openItem: (item, opts) => setSheet({ kind: "item", item, focusNote: !!opts?.focusNote, edit: opts?.edit ?? null, qty: opts?.qty }),
    openCart: (tab = "cart") => {
      setPick(null);
      setCartMin(false);
      setSheet({ kind: "cart", tab });
    },
    closeSheet: () => {
      setSheet(null);
      setEditing(false);
    },
    send,
    current,
    setCurrent,
    pick,
    startPick: (p) => {
      setPick(p);
      setCartMin(false);
      setEditing(false);
      setSheet(null);
    },
    cancelPick: () => {
      const p = pick;
      setPick(null);
      // Desistiu da troca: volta ao pedido, ainda editando. Desistiu da meio a meio: volta à folha do prato.
      const editLine = p?.swap && p.fromSheet ? lines.find((l) => l.key === p.swap!.key) : undefined;
      if (editLine) setSheet({ kind: "item", item: p!.keep, focusNote: false, edit: editLine, draft: { option: p!.option, note: p!.note } });
      else if (p?.swap) {
        setEditing(true);
        setSheet({ kind: "cart", tab: "cart" });
      } else if (p) setSheet({ kind: "item", item: p.keep, focusNote: false, edit: null, draft: { option: p.option, note: p.note } });
    },
    canPair,
    pair,
    editing,
    setEditing,
    cartMin,
    minimizeCart: () => {
      setSheet(null);
      setEditing(false);
      setCartMin(true);
    },
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export const money = (cents: number, lang: string) => formatPrice(cents, lang);
export const countLabel = (n: number, lang: string) => (n === 1 ? tr("oItem1", lang) : tf("oItems", lang, { n }));
export { cartCount, cartTotal };
