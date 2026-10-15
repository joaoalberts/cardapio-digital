"use client";

import { useEffect, useRef, useState } from "react";
import { t as tr } from "@/lib/menu/i18n";
import { useOrder } from "./order-context";
import { CartBar, PickBar } from "./pick-bar";
import { ItemSheet } from "./item-sheet";
import { CartSheet } from "./cart-sheet";

// Folhas de vidro, barrinha da outra metade, pedido comprimido e avisos. Só existe com mesa
// válida e pedidos ligados. O carrinho do topo fica no menu-app (cart-button.tsx).
export function OrderLayer() {
  const o = useOrder();
  const s = o.sheet;
  // Último conteúdo de cada folha: ela desce com o próprio conteúdo visível.
  const [lastItem, setLastItem] = useState(s?.kind === "item" ? s : null);
  const [lastCart, setLastCart] = useState(s?.kind === "cart" ? s : null);
  // Cada abertura do carrinho (vindo de fechado ou da folha do prato) remonta o CartSheet;
  // trocar só de aba com ele aberto não conta.
  const [prevKind, setPrevKind] = useState(s?.kind ?? null);
  const [cartOpenId, setCartOpenId] = useState(0);
  const [itemOpenId, setItemOpenId] = useState(0);
  if (s?.kind === "item" && s !== lastItem) setLastItem(s);
  if (s?.kind === "cart" && s !== lastCart) setLastCart(s);
  if ((s?.kind ?? null) !== prevKind) {
    setPrevKind(s?.kind ?? null);
    if (s?.kind === "cart") setCartOpenId((n) => n + 1);
    if (s?.kind === "item") setItemOpenId((n) => n + 1);
  }
  // Foco: ao abrir, vai para o título da folha (na do prato aberta para a observação, a própria
  // folha foca a observação); ao fechar, volta para quem estava focado antes de abrir.
  const itemSec = useRef<HTMLElement>(null);
  const cartSec = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);
  const wasOpen = useRef(false);
  const kind = s?.kind ?? null;
  const toNote = s?.kind === "item" && s.focusNote;
  useEffect(() => {
    if (kind) {
      if (!wasOpen.current) opener.current = document.activeElement;
      wasOpen.current = true;
      if (!toNote) (kind === "item" ? itemSec : cartSec).current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
    } else if (wasOpen.current) {
      wasOpen.current = false;
      (opener.current as HTMLElement | null)?.focus?.({ preventScroll: true });
      opener.current = null;
    }
  }, [kind, toNote]);
  useEffect(() => {
    if (!s) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && o.closeSheet();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [s, o]);
  if (!o.enabled) return null;
  return (
    <div className="o-layer">
      {o.flash && (
        <div className="o-flash glass" key={o.flash.id} role="status">
          <span className={o.flash.tone}>{o.flash.label}</span> {o.flash.text}
        </div>
      )}
      <PickBar />
      <CartBar />
      <div className={`o-backdrop${s ? " on" : ""}`} onClick={o.closeSheet} aria-hidden />
      <section
        ref={itemSec}
        className={`o-sheet${s?.kind === "item" ? " on" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="o-item-title"
        aria-hidden={s?.kind !== "item"}
        inert={s?.kind !== "item"}
      >
        {lastItem && <ItemSheet key={`${itemOpenId}:${lastItem.item.id}:${lastItem.edit?.key ?? ""}`} item={lastItem.item} focusNote={lastItem.focusNote} edit={lastItem.edit} draft={lastItem.draft} />}
      </section>
      <section
        ref={cartSec}
        className={`o-sheet o-cart${s?.kind === "cart" ? " on" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="o-cart-title"
        aria-hidden={s?.kind !== "cart"}
        inert={s?.kind !== "cart"}
      >
        {lastCart && <CartSheet key={cartOpenId} tab={lastCart.tab} />}
      </section>
      <div className={`o-toast${o.toast ? " on" : ""}`} role="status">
        <span>{o.toast?.text}</span>
        {o.toast?.undo && <button onClick={o.toast.undo}>{tr("oUndo", o.lang)}</button>}
      </div>
    </div>
  );
}
