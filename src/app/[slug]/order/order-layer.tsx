"use client";

import { useEffect, useState } from "react";
import { t as tr } from "@/lib/menu/i18n";
import { useOrder } from "./order-context";
import { Island } from "./island";
import { ItemSheet } from "./item-sheet";
import { CartSheet } from "./cart-sheet";

// Ilha, folhas e aviso de desfazer. Só existe com mesa válida e pedidos ligados.
export function OrderLayer() {
  const o = useOrder();
  const s = o.sheet;
  // Última folha aberta: ela desce com o conteúdo visível em vez de esvaziar.
  const [last, setLast] = useState(s);
  if (s && s !== last) setLast(s);
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
        className={`o-sheet${s?.kind === "item" ? " on" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="o-item-title"
        aria-hidden={s?.kind !== "item"}
        inert={s?.kind !== "item"}
      >
        <div className="o-grab" />
        {last?.kind === "item" && <ItemSheet key={`${last.item.id}:${last.edit?.key ?? ""}`} item={last.item} focusNote={last.focusNote} edit={last.edit} />}
      </section>
      <section
        className={`o-sheet o-cart${s?.kind === "cart" ? " on" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="o-cart-title"
        aria-hidden={s?.kind !== "cart"}
        inert={s?.kind !== "cart"}
      >
        <div className="o-grab" />
        {last?.kind === "cart" && <CartSheet tab={last.tab} />}
      </section>
      <div className={`o-toast${o.toast ? " on" : ""}`} role="status">
        <span>{o.toast?.text}</span>
        {o.toast?.undo && <button onClick={o.toast.undo}>{tr("oUndo", o.lang)}</button>}
      </div>
    </div>
  );
}
