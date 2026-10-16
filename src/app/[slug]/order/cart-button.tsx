"use client";

import { t as tr } from "@/lib/menu/i18n";
import { cartCount, useOrder } from "./order-context";

// Carrinho no topo (capa e stories): leva direto ao fechamento do pedido, mesmo no meio
// da escolha de uma metade ou da edição. É também o alvo da miniatura que "voa" ao adicionar.
// Só um carrinho fica com o islandRef (o alvo do voo): o do story com ele aberto, o da capa
// com ele fechado. island={false} tira o botão dessa disputa (o carrinho da camada da
// Comunidade fica sempre montado e o "Pedir também" de lá voa até ele direto).
export function CartButton({ inViewer = false, island = true, className }: { inViewer?: boolean; island?: boolean; className: string }) {
  const { islandRef, ...o } = useOrder();
  if (!o.enabled) return null;
  const n = cartCount(o.lines);
  return (
    <button
      ref={island && o.viewerOpen === inViewer ? islandRef : undefined}
      className={`o-cartbtn ${className}`}
      onClick={() => o.openCart(n || !o.orders.length ? "cart" : "orders")}
      aria-label={tr("oGoCart", o.lang)}
    >
      <svg className="icon" viewBox="0 0 24 24" aria-hidden>
        <path d="M3 4h2.2l2.1 10.1a1.6 1.6 0 001.6 1.3h8.4a1.6 1.6 0 001.5-1.2L20.6 8H6.1" />
        <circle cx="9.6" cy="19.4" r="1.3" />
        <circle cx="17" cy="19.4" r="1.3" />
      </svg>
      {n > 0 && <b className="o-cartbtn-n">{n}</b>}
    </button>
  );
}
