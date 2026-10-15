"use client";
/* eslint-disable @next/next/no-img-element -- miniaturas pequenas, já em tamanho certo (mesmo motivo do menu-app.tsx) */

import { useState } from "react";
import { tf, t as tr } from "@/lib/menu/i18n";
import { thumbSrc } from "@/lib/menu/media";
import { cartCount, cartTotal, money, useOrder } from "./order-context";
import { SlideToSend } from "./slide-to-send";

type Done = { number: number; priceChanged: boolean; total: number } | null;

export function CartSheet({ tab }: { tab: "cart" | "orders" }) {
  const o = useOrder();
  const L = o.lang;
  const [done, setDone] = useState<Done>(null);
  const [error, setError] = useState<string | null>(null);
  const n = cartCount(o.lines);
  const total = cartTotal(o.lines, o.unit);
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
    setDone({ number: r.number, priceChanged: r.priceChanged, total: r.order.total_cents });
    return true;
  };

  const pic = (id: string, halfId: string | null) => {
    const a = o.itemById(id);
    const b = halfId ? o.itemById(halfId) : undefined;
    const sa = thumbSrc(a);
    const sb = thumbSrc(b);
    return (
      <div className="o-pic">
        {sa && <img src={sa} alt="" />}
        {sb && <img className="r" src={sb} alt="" />}
      </div>
    );
  };

  return (
    <>
      <div className="o-head">
        <div>
          <h2 id="o-cart-title" className="fd">{tr("oYour", L)}</h2>
          <div className="o-sub">{o.table?.label}</div>
        </div>
        <button className="o-x" onClick={o.closeSheet} aria-label={tr("oClose", L)}>
          <svg className="icon" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <div className="o-seg o-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "cart"} onClick={() => go("cart")}>
          {n ? `${tr("oCart", L)} · ${n}` : tr("oCart", L)}
        </button>
        <button role="tab" aria-selected={tab === "orders"} onClick={() => go("orders")}>
          {o.orders.length ? `${tr("oMine", L)} · ${o.orders.length}` : tr("oMine", L)}
        </button>
      </div>

      <div className="o-body grow">
        {done ? (
          <div className="o-done">
            <svg viewBox="0 0 84 84" aria-hidden>
              <circle cx="42" cy="42" r="39" />
              <path d="M26 43l11 11 21-23" />
            </svg>
            <h3 className="fd">{tr("oSent", L)}</h3>
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
                  const step = ord.status === "new" ? 0 : ord.status === "preparing" ? 1 : 2;
                  return (
                    <article key={ord.id} className="o-order">
                      <header>
                        <strong className="fd">{tf("oOrderN", L, { n: o.orders.length - i })}</strong>
                        <span>
                          {new Date(ord.created_at).toLocaleTimeString(L, { hour: "2-digit", minute: "2-digit" })} · {money(ord.total_cents, L)}
                        </span>
                      </header>
                      <ul>
                        {ord.lines.map((l, k) => (
                          <li key={k}>
                            {l.qty}× {l.half_name ? `½ ${l.name} + ½ ${l.half_name}` : l.name}
                            {l.option ? ` (${l.option})` : ""}
                          </li>
                        ))}
                      </ul>
                      <div className="o-track">
                        {(["oStNew", "oStPrep", "oStReady"] as const).map((k, s) => (
                          <div key={k} className={`${s <= step ? "on" : ""}${s === step && s < 2 ? " now" : ""}`}>{tr(k, L)}</div>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
              <p className="o-call">{tr("oCallWaiter", L)}</p>
            </>
          ) : (
            <div className="o-empty"><strong className="fd">{tr("oNoOrders", L)}</strong>{tr("oNoOrdersBody", L)}</div>
          )
        ) : n ? (
          <>
            <ul className="o-lines">
              {o.lines.map((l) => {
                const it = o.itemById(l.item);
                const other = l.half ? o.itemById(l.half) : undefined;
                const u = o.unit(l);
                const det = [other ? `½ ${it?.name} + ½ ${other.name}` : "", l.option ?? ""].filter(Boolean).join(" · ");
                return (
                  <li key={l.key} className={`o-line${u == null ? " gone" : ""}`}>
                    {pic(l.item, l.half)}
                    <div className="o-main">
                      <span className="o-name">{other ? tr("oHalf", L) : it?.name}</span>
                      {det && <span className="o-det">{det}</span>}
                      {l.note && <span className="o-note">{l.note}</span>}
                      {it && (
                        <button className="o-edit" onClick={() => o.openItem(it, { edit: l })}>
                          {l.note ? tr("oEdit", L) : tr("oEditNote", L)}
                        </button>
                      )}
                    </div>
                    <div className="o-side">
                      <span className="o-price">{u == null ? "—" : money(u * l.qty, L)}</span>
                      <div className="o-stepper small">
                        <button onClick={() => (l.qty > 1 ? o.setQty(l.key, l.qty - 1) : o.remove(l.key))} aria-label={l.qty > 1 ? tr("oLess", L) : tr("oRemove", L)}>
                          {l.qty > 1 ? (
                            <svg className="icon" viewBox="0 0 24 24"><path d="M6 12h12" /></svg>
                          ) : (
                            <svg className="icon" viewBox="0 0 24 24"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                          )}
                        </button>
                        <output>{l.qty}</output>
                        <button onClick={() => o.setQty(l.key, l.qty + 1)} disabled={l.qty >= 20} aria-label={tr("oMoreOne", L)}>
                          <svg className="icon" viewBox="0 0 24 24"><path d="M12 6v12M6 12h12" /></svg>
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <button className="o-more" onClick={o.closeSheet}>+ {tr("oMore", L)}</button>
          </>
        ) : (
          <div className="o-empty"><strong className="fd">{tr("oEmpty", L)}</strong>{tr("oEmptyBody", L)}</div>
        )}
      </div>

      {!done && tab === "cart" && n > 0 && (
        <>
          <div className="o-summary">
            <div className="o-total"><span>{tr("oTotal", L)}</span><strong className="fd">{money(total, L)}</strong></div>
            <small>{tr("oPayHere", L)}</small>
            {error && <p className="o-error" role="alert">{error}</p>}
          </div>
          <SlideToSend label={tr("oSlide", L)} busyLabel={tr("oSending", L)} disabled={o.lines.some((l) => o.unit(l) == null)} onSend={send} />
        </>
      )}
    </>
  );
}
