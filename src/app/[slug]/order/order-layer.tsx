"use client";

import { useEffect, useRef, useState } from "react";
import { t as tr } from "@/lib/menu/i18n";
import { useOrder } from "./order-context";
import { Island } from "./island";
import { ItemSheet } from "./item-sheet";
import { CartSheet } from "./cart-sheet";

// Ilha, folhas e aviso de desfazer. Só existe com mesa válida e pedidos ligados.
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
  // Foco: ao abrir, vai para o "×" da folha (na do prato aberta para a observação, a própria folha
  // foca a observação); ao fechar, volta para quem estava focado antes de abrir.
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
      if (!toNote) (kind === "item" ? itemSec : cartSec).current?.querySelector<HTMLElement>(".o-x")?.focus({ preventScroll: true });
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
      <Island />
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
        <div className="o-grab" />
        {lastItem && <ItemSheet key={`${itemOpenId}:${lastItem.item.id}:${lastItem.edit?.key ?? ""}`} item={lastItem.item} focusNote={lastItem.focusNote} edit={lastItem.edit} />}
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
        <div className="o-grab" />
        {lastCart && <CartSheet key={cartOpenId} tab={lastCart.tab} />}
      </section>
      <div className={`o-toast${o.toast ? " on" : ""}`} role="status">
        <span>{o.toast?.text}</span>
        {o.toast?.undo && <button onClick={o.toast.undo}>{tr("oUndo", o.lang)}</button>}
      </div>
    </div>
  );
}
