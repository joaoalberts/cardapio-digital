"use client";
/* eslint-disable @next/next/no-img-element -- miniaturas pequenas, já em tamanho certo (mesmo motivo do menu-app.tsx) */

import { t as tr } from "@/lib/menu/i18n";
import { thumbSrc } from "@/lib/menu/media";
import { cartCount, cartTotal, countLabel, money, useOrder } from "./order-context";

// Pílula fixa no topo: a mesa e, com itens, miniaturas e total. Toque abre o carrinho.
export function Island() {
  const { islandRef, ...o } = useOrder();
  const n = cartCount(o.lines);
  const total = cartTotal(o.lines, o.unit);
  const f = o.flash;
  const label = n ? `${countLabel(n, o.lang)}, ${money(total, o.lang)}. ${tr("oCart", o.lang)}` : `${o.table?.label ?? ""}. ${tr("oMine", o.lang)}`;
  return (
    <button
      ref={islandRef}
      className={`o-island${f ? " big" : ""}${o.viewerOpen ? " in-viewer" : ""}`}
      onClick={() => o.openCart(n || !o.orders.length ? "cart" : "orders")}
      aria-label={label}
      key={f?.id ?? "rest"}
    >
      {f ? (
        <span className="o-flash">
          {f.img ? <img className="o-flash-img" src={f.img} alt="" /> : <span className="o-check" aria-hidden>✓</span>}
          <span>
            <small className={f.tone}>{f.label}</small>
            <strong>{f.text}</strong>
          </span>
        </span>
      ) : n ? (
        <>
          <span className="o-thumbs">
            {o.lines.slice(-3).map((l) => {
              const it = o.itemById(l.item);
              const src = thumbSrc(it);
              return src ? <img key={l.key} src={src} alt="" /> : <i key={l.key} />;
            })}
          </span>
          <span className="o-sum">
            {countLabel(n, o.lang)} · <b>{money(total, o.lang)}</b>
          </span>
          <span className="o-sep" />
          <span className="o-mesa">{o.table?.label}</span>
        </>
      ) : (
        <span className="o-mesa">{o.table?.label}</span>
      )}
    </button>
  );
}
