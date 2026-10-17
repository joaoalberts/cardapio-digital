"use client";
/* eslint-disable @next/next/no-img-element -- miniaturas pequenas, já em tamanho certo (mesmo motivo do menu-app.tsx) */

import { useState } from "react";
import { tf, t as tr } from "@/lib/menu/i18n";
import { thumbSrc } from "@/lib/menu/media";
import type { CartLine } from "@/lib/orders/cart";
import { cartCount, cartTotal, countLabel, money, useOrder } from "./order-context";
import { SlideToSend } from "./slide-to-send";

type Done = { number: number; priceChanged: boolean; total: number } | null;

// "Seu pedido" na folha de vidro: contagem ao lado do título, "Editar" discreto (quantidade,
// excluir e trocar uma metade), seta para comprimir, "Continuar pedindo" e deslizar para enviar.
export function CartSheet({ tab }: { tab: "cart" | "orders" }) {
  const o = useOrder();
  const L = o.lang;
  const [done, setDone] = useState<Done>(null);
  const [error, setError] = useState<string | null>(null);
  const n = cartCount(o.lines);
  const total = cartTotal(o.lines, o.unit);
  const gone = o.lines.find((l) => o.unit(l) == null);
  const ed = o.editing && tab === "cart" && !done && n > 0;
  const go = (t: "cart" | "orders") => {
    setDone(null);
    setError(null);
    o.openCart(t);
  };

  const send = async () => {
    setError(null);
    const r = await o.send();
    if (!r.ok) {
      setError(r.message);
      return false;
    }
    o.setEditing(false);
    setDone({ number: r.number, priceChanged: r.priceChanged, total: r.order.total_cents });
    return true;
  };

  const swap = (l: CartLine, side: "item" | "half") => {
    const keepId = side === "item" ? l.half : l.item;
    const keep = keepId ? o.itemById(keepId) : undefined;
    if (keep) o.startPick({ keep, option: l.option, note: l.note, swap: { key: l.key, side } });
  };

  const line = (l: CartLine) => {
    const it = o.itemById(l.item);
    const other = l.half ? o.itemById(l.half) : undefined;
    const u = o.unit(l);
    const sa = thumbSrc(it);
    const sb = thumbSrc(other);
    const qty = l.qty > 1 && !ed ? `${l.qty}× ` : "";
    const name = it?.name ?? l.claim_name ?? ""; // oferta desligada depois do toque: vale o nome do registro
    const label = other ? `½ ${it?.name ?? ""} + ½ ${other.name}` : name; // nome do prato nos rótulos dos botões
    const sub = [l.option, other ? null : it?.half_half ? tr("oWhole", L) : l.qty === 1 ? tr("oUnit1", L) : tf("oUnits", L, { n: l.qty })].filter(Boolean).join(" · ");
    return (
      <li key={l.key} className={`o-line${u == null ? " gone" : ""}`}>
        <div className={`o-pic${other ? " split" : ""}`}>
          {sa && <img src={sa} alt="" />}
          {other && sb && <img className="r" src={sb} alt="" />}
        </div>
        <div className="o-main">
          {other ? (
            <>
              <span className="o-tag">{qty}{tr("oHalf", L)}</span>
              <span className="o-brk">
                <span>{it?.name}{ed && <button className="o-swap" onClick={() => swap(l, "item")} aria-label={`${tr("oSwap", L)} ½ ${it?.name ?? ""}`}>{tr("oSwap", L)}</button>}</span>
                <span>{other.name}{ed && <button className="o-swap" onClick={() => swap(l, "half")} aria-label={`${tr("oSwap", L)} ½ ${other.name}`}>{tr("oSwap", L)}</button>}</span>
              </span>
              {l.option && <span className="o-det">{l.option}</span>}
            </>
          ) : (
            <>
              <span className="o-name">
                {qty}
                {name}
                {l.claim && <Bolt />}
              </span>
              {sub && <span className="o-det">{sub}</span>}
            </>
          )}
          {l.note && <span className="o-note">{l.note}</span>}
          {ed && (
            <span className="o-edlinks">
              <button className="del" onClick={() => o.remove(l.key)} aria-label={`${tr("oDelete", L)} ${label}`}>{tr("oDelete", L)}</button>
            </span>
          )}
        </div>
        {ed && !l.claim ? (
          <div className="o-stepper small">
            <button onClick={() => (l.qty > 1 ? o.setQty(l.key, l.qty - 1) : o.remove(l.key))} aria-label={`${l.qty > 1 ? tr("oLess", L) : tr("oRemove", L)}: ${label}`}>−</button>
            <output>{l.qty}</output>
            <button onClick={() => o.setQty(l.key, l.qty + 1)} disabled={l.qty >= 20} aria-label={`${tr("oMoreOne", L)}: ${label}`}>+</button>
          </div>
        ) : (
          <span className="o-price">{u == null ? "—" : money(u * l.qty, L).replace(/^R\$\s?/, "")}</span>
        )}
      </li>
    );
  };

  return (
    <>
      <div className="g-title cart">
        <span className="g-ttl">
          <h2 id="o-cart-title" className="o-fix" tabIndex={-1} data-autofocus>{tr("oYour", L)}</h2>
          {tab === "cart" && !done && <span className="g-cnt">{countLabel(n, L)}</span>}
        </span>
        <span className="g-head-r">
          {tab === "cart" && !done && n > 0 && (
            <button className="g-editl" onClick={() => o.setEditing(!o.editing)}>{o.editing ? tr("oDoneEdit", L) : tr("oEdit", L)}</button>
          )}
          <button className="o-ic" onClick={o.minimizeCart} aria-label={tr("oMinimize", L)}>
            <svg className="icon" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>
          </button>
        </span>
      </div>
      {o.orders.length > 0 && (
        <div className="o-seg o-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "cart"} onClick={() => go("cart")}>{tr("oCart", L)}</button>
          <button role="tab" aria-selected={tab === "orders"} onClick={() => go("orders")}>{tr("oMine", L)}</button>
        </div>
      )}

      <div className="o-body grow">
        {done ? (
          <div className="o-done">
            <svg viewBox="0 0 84 84" aria-hidden>
              <circle cx="42" cy="42" r="39" />
              <path d="M26 43l11 11 21-23" />
            </svg>
            <h3 className="o-fix">{tr("oSent", L)}</h3>
            <p>{tf("oSentBody", L, { n: done.number, table: o.table?.label ?? "" })}</p>
            {done.priceChanged && <p className="o-warn">{tf("oErrPrice", L, { total: money(done.total, L) })}</p>}
            <div className="o-row2">
              <button className="o-ghost" onClick={() => go("orders")}>{tr("oProgress", L)}</button>
              <button className="o-ghost" onClick={o.closeSheet}>{tr("oBack", L)}</button>
            </div>
          </div>
        ) : tab === "orders" ? (
          o.orders.length ? (
            <>
              <div className="o-orders">
                {o.orders.map((ord, i) => {
                  return (
                    <article key={ord.id} className="o-order">
                      <header>
                        <strong className="o-fix">{tf("oOrderN", L, { n: o.orders.length - i })}</strong>
                        <span>
                          {new Date(ord.created_at).toLocaleTimeString(L, { hour: "2-digit", minute: "2-digit" })} · {money(ord.total_cents, L)}
                        </span>
                      </header>
                      <ul>
                        {ord.lines.map((l, k) => (
                          <li key={k}>
                            {l.qty}× {l.half_name ? `½ ${l.name} + ½ ${l.half_name}` : l.name}
                            {l.option ? ` (${l.option})` : ""}
                            {l.special && <Bolt />}
                          </li>
                        ))}
                      </ul>
                    </article>
                  );
                })}
              </div>
              <p className="o-call">{tr("oCallWaiter", L)}</p>
            </>
          ) : (
            <div className="o-empty"><strong className="o-fix">{tr("oNoOrders", L)}</strong>{tr("oNoOrdersBody", L)}</div>
          )
        ) : n ? (
          <ul className="o-lines">{o.lines.map(line)}</ul>
        ) : (
          <div className="o-empty"><strong className="o-fix">{tr("oEmpty", L)}</strong>{tr("oEmptyBody", L)}</div>
        )}
      </div>

      {!done && tab === "cart" && (
        <div className="o-summary">
          {n > 0 && (
            <>
              <div className="o-total"><span>{tr("oTotal", L)}</span><strong className="o-fix">{money(total, L)}</strong></div>
              {gone && <p className="o-error">{tf("oErrGone", L, { name: o.itemById(gone.item)?.name ?? "" })}</p>}
              {error && <p className="o-error" role="alert">{error}</p>}
            </>
          )}
          <button className="o-continue" onClick={o.closeSheet}>{tr("oContinue", L)}</button>
          {n > 0 && <SlideToSend label={tr("oSlide", L)} busyLabel={tr("oSending", L)} disabled={!!gone} onSend={send} />}
        </div>
      )}
    </>
  );
}

// Raio pequeno em champanhe ao lado do nome: a linha veio de uma oferta relâmpago.
function Bolt() {
  return (
    <svg className="icon o-bolt" viewBox="0 0 24 24" aria-hidden>
      <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
    </svg>
  );
}
