"use client";
/* eslint-disable @next/next/no-img-element -- miniaturas pequenas, já em tamanho certo (mesmo motivo do menu-app.tsx) */

import { useEffect, useRef } from "react";
import { tf, t as tr } from "@/lib/menu/i18n";
import { thumbSrc } from "@/lib/menu/media";
import { cartCount, cartTotal, countLabel, money, useOrder } from "./order-context";

// Barrinha de vidro no pé da tela enquanto o cliente escolhe a outra metade navegando
// pelos stories. Com uma pizza que combina na tela, o botão "½ Sabor" fecha a pizza.
export function PickBar() {
  const o = useOrder();
  const p = o.pick;
  const box = useRef<HTMLDivElement>(null);
  // A folha fechou e o botão "Pedir" saiu da tela: o foco vem para a barrinha.
  const on = !!p;
  useEffect(() => {
    if (on) box.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  }, [on]);
  if (!p) return null;
  const L = o.lang;
  const cur = o.current;
  const ok = o.canPair(cur);
  const keepSrc = thumbSrc(p.keep);
  const old = p.swap ? o.lines.find((l) => l.key === p.swap!.key) : undefined;
  const oldId = old ? (p.swap!.side === "item" ? old.item : old.half) : null;
  const oldName = oldId ? o.itemById(oldId)?.name : undefined;
  const sub = ok ? `+ ½ ${cur!.name}?` : p.swap && oldName ? tf("oSwapping", L, { name: oldName }) : cur && cur.category_id === p.keep.category_id ? tr("oPickOther", L) : cur ? tr("oPickPizza", L) : tr("oPickNav", L);
  return (
    <div className="o-pbar glass" ref={box} role="group" aria-label={`½ ${p.keep.name}`}>
      <span className="o-pbar-pie" aria-hidden>
        {keepSrc ? <img src={keepSrc} alt="" /> : <i />}
        {/* Com uma pizza que combina na tela, a outra metade já aparece montada. */}
        {ok && thumbSrc(cur!) ? <img className="r" src={thumbSrc(cur!)!} alt="" /> : <i className="empty" />}
      </span>
      <span className="o-pbar-tx">
        <b>½ {p.keep.name}</b>
        <span aria-live="polite">{sub}</span>
      </span>
      {ok && <button className="o-pbar-use" onClick={() => o.pair(cur!)}>½ {cur!.name}</button>}
      <button className="o-pbar-x" onClick={o.cancelPick} aria-label={tr("oCancelHalf", L)}>
        <svg className="icon" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  );
}

// "Seu pedido" comprimido: uma pílula no pé da tela; um toque abre de novo.
export function CartBar() {
  const o = useOrder();
  const n = cartCount(o.lines);
  if (!o.cartMin || !n || o.sheet || o.pick) return null;
  return (
    <button className="o-cbar glass" onClick={() => o.openCart("cart")}>
      <span><b>{tr("oYour", o.lang)}</b> · {countLabel(n, o.lang)}</span>
      <span className="o-cbar-r">
        <span className="mono">{money(cartTotal(o.lines, o.unit), o.lang)}</span>
        <span className="o-ic" aria-hidden><svg className="icon" viewBox="0 0 24 24"><path d="M6 15l6-6 6 6" /></svg></span>
      </span>
    </button>
  );
}
