"use client";

import { useRef, useState, type ReactNode } from "react";
import type { MenuItem } from "@/lib/menu/types";
import { t as tr } from "@/lib/menu/i18n";
import { useOrder } from "./order-context";

// Pé do story (layout aprovado pelo João em 15/10): preço à esquerda e quantidade à direita,
// e embaixo a barra "Pedir agora". Prato simples entra direto no pedido com a quantidade
// escolhida; pizza (Inteira/Metade), prato com tamanhos ou com massa abre a folha de vidro.
// Enquanto o cliente escolhe a outra metade, quem fala é a barrinha (pick-bar.tsx).
export function StoryBuy({ item, price, kind }: { item: MenuItem; price: ReactNode; kind: string }) {
  const o = useOrder();
  const [qty, setQty] = useState(1);
  const go = useRef<HTMLButtonElement>(null);
  const can = o.enabled && !item.hide_price && !o.pick;
  if (!can) return <div className="buyrow">{price}</div>;
  const L = o.lang;
  const simple = !item.price_options?.length && !item.half_half && !item.doughs?.length;
  const pedir = () => {
    if (simple) {
      o.add({ item: item.id, option: null, half: null, qty, note: "" }, go.current);
      setQty(1);
    } else o.openItem(item, { qty });
  };
  return (
    <>
      <div className="buyrow">
        {price}
        <div className="o-qty glass" role="group" aria-label={`${tr("oUnits", L).replace("{n} ", "")} · ${item.name}`}>
          <button onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-label={tr("oLess", L)}>−</button>
          <output aria-live="polite">{qty}</output>
          <button onClick={() => setQty((q) => Math.min(20, q + 1))} aria-label={tr("oMoreOne", L)}>+</button>
        </div>
      </div>
      <button ref={go} className="o-go" onClick={pedir} aria-label={`${tr("oGo", L)}: ${qty > 1 ? `${qty}× ` : ""}${item.name}`}>
        <span className="o-go-ic" aria-hidden>{icon(kind, item)}</span>
        <span className="o-go-sep" aria-hidden />
        <span className="o-go-tx">{tr("oGo", L)}</span>
        <svg className="icon o-go-arrow" viewBox="0 0 24 24" aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </button>
    </>
  );
}

// Ícone da barra pelo tipo do prato (nome da categoria): hambúrguer, pizza, bebida ou um prato.
function icon(kind: string, item: MenuItem) {
  const k = kind.toLowerCase();
  if (item.half_half || /pizz/.test(k))
    return <svg className="icon" viewBox="0 0 24 24"><path d="M12 3c-3.6 0-6.9 1.3-9 3.5L12 21l9-14.5C18.9 4.3 15.6 3 12 3z" /><path d="M4.8 9.4c2-1.5 4.5-2.3 7.2-2.3s5.2.8 7.2 2.3M10 11h.01M13.5 14h.01M11 16.5h.01" /></svg>;
  if (/burg|lanche|sandu/.test(k))
    return <svg className="icon" viewBox="0 0 24 24"><path d="M4 11a8 6 0 0116 0z" /><path d="M3 14.5h18M4 18h16a1 1 0 01-1 2H5a1 1 0 01-1-2zM9 7.5h.01M13 6.5h.01M15.5 8.5h.01" /></svg>;
  if (/drink|bebid|chop|cervej|suco|vinho|caf/.test(k))
    return <svg className="icon" viewBox="0 0 24 24"><path d="M6 4h12l-1.5 15a2 2 0 01-2 1.8h-5a2 2 0 01-2-1.8z" /><path d="M6.6 9h10.8" /></svg>;
  return <svg className="icon" viewBox="0 0 24 24"><path d="M4 17h16M5 17a7 7 0 0114 0M12 8V6M10 6h4" /></svg>;
}
