"use client";
/* eslint-disable @next/next/no-img-element -- miniaturas pequenas, já em tamanho certo (mesmo motivo do menu-app.tsx) */

import { useEffect, useMemo, useRef, useState } from "react";
import type { MenuItem } from "@/lib/menu/types";
import { tf, t as tr } from "@/lib/menu/i18n";
import { thumbSrc } from "@/lib/menu/media";
import { NOTE_MAX, halfPrice, itemPrice } from "@/lib/orders/pricing";
import type { CartLine } from "@/lib/orders/cart";
import { money, useOrder } from "./order-context";

export function ItemSheet({ item, focusNote, edit }: { item: MenuItem; focusNote: boolean; edit: CartLine | null }) {
  const o = useOrder();
  const L = o.lang;
  const sizes = item.price_options ?? [];
  const [option, setOption] = useState<string | null>(edit?.option ?? (sizes.length ? sizes[sizes.length - 1].label : null));
  const [mode, setMode] = useState<"whole" | "half">(edit?.half ? "half" : "whole");
  const [half, setHalf] = useState<string | null>(edit?.half ?? null);
  const [qty, setQty] = useState(edit?.qty ?? 1);
  const [note, setNote] = useState(edit?.note ?? "");
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const addBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!focusNote) return;
    const id = setTimeout(() => noteRef.current?.focus(), 380);
    return () => clearTimeout(id);
  }, [focusNote]);

  // Outros sabores da mesma categoria que têm o tamanho escolhido.
  const partners = useMemo(() => {
    if (!item.half_half || !o.menu) return [];
    const cat = o.menu.categories.find((c) => c.id === item.category_id);
    return (cat?.items ?? []).filter((p) => p.id !== item.id && itemPrice(p, option) != null);
  }, [item, option, o.menu]);
  const other = half ? partners.find((p) => p.id === half) ?? null : null;

  const effMode = partners.length ? mode : "whole";
  const pa = itemPrice(item, option);
  const unit = effMode === "half" && other && pa != null ? halfPrice(pa, itemPrice(other, option)!) : pa;
  const needHalf = effMode === "half" && !other;
  const img = thumbSrc(item);

  const submit = () => {
    if (unit == null || needHalf) return;
    const line = { item: item.id, option, half: effMode === "half" && other ? other.id : null, qty, note: note.trim().slice(0, NOTE_MAX) };
    if (edit) {
      o.replace(edit.key, line);
      o.openCart("cart");
    } else {
      o.closeSheet();
      o.add(line, addBtn.current);
    }
  };

  return (
    <>
      <div className="o-head">
        {img && <img src={img} alt="" />}
        <div>
          <h2 id="o-item-title" className="fd">{item.name}</h2>
          {!sizes.length && pa != null && <div className="o-sub">{money(pa, L)}</div>}
        </div>
        <button className="o-x" onClick={o.closeSheet} aria-label={tr("oClose", L)}>
          <svg className="icon" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <div className="o-body">
        {!!sizes.length && (
          <div>
            <div className="o-label">{tr("oSize", L)}</div>
            <div className="o-seg" role="group" aria-label={tr("oSize", L)}>
              {sizes.map((s) => (
                <button key={s.label} aria-pressed={option === s.label} onClick={() => setOption(s.label)}>
                  {s.label}
                  <small>{money(s.price_cents, L)}</small>
                </button>
              ))}
            </div>
          </div>
        )}
        {item.half_half && partners.length > 0 && (
          <div>
            <div className="o-label">{tr("oFlavors", L)}</div>
            <div className="o-seg" role="group" aria-label={tr("oFlavors", L)}>
              <button aria-pressed={effMode === "whole"} onClick={() => { setMode("whole"); setHalf(null); }}>{tr("oWhole", L)}</button>
              <button aria-pressed={effMode === "half"} onClick={() => setMode("half")}>{tr("oHalf", L)}</button>
            </div>
          </div>
        )}
        {effMode === "half" && (
          <>
            <div className="o-half">
              <div className="o-pie" aria-hidden>
                {img && <img className="l" src={img} alt="" />}
                {other ? (
                  thumbSrc(other) ? <img className="r" src={thumbSrc(other)!} alt="" /> : <span className="q" />
                ) : (
                  <span className="q">?</span>
                )}
              </div>
              <p>
                {other && pa != null ? (
                  <>
                    <strong>½ {item.name} + ½ {other.name}</strong>
                    <br />
                    {tf("oHalfAvg", L, { a: money(pa, L), b: money(itemPrice(other, option)!, L), c: money(unit!, L) })}
                  </>
                ) : (
                  tr("oHalfPick", L)
                )}
              </p>
            </div>
            <div className="o-flavors" role="group" aria-label={tr("oHalfNeed", L)}>
              {partners.map((p) => {
                const src = thumbSrc(p);
                return (
                  <button key={p.id} className="o-flavor" aria-pressed={half === p.id} onClick={() => setHalf(p.id)}>
                    {src ? <img src={src} alt="" /> : <i />}
                    <span>{p.name}</span>
                    <em>{money(itemPrice(p, option)!, L)}</em>
                  </button>
                );
              })}
            </div>
          </>
        )}
        <div>
          <div className="o-label">
            <label htmlFor="o-note">{tr("oNote", L)}</label>
            <span className={`o-count${note.length > NOTE_MAX - 20 ? " warn" : ""}`}>{note.length}/{NOTE_MAX}</span>
          </div>
          <textarea id="o-note" ref={noteRef} maxLength={NOTE_MAX} rows={2} value={note} placeholder={tr("oNotePh", L)} onChange={(e) => setNote(e.target.value)} />
          <div className="o-hint">{tr("oNoteHint", L)}</div>
        </div>
      </div>
      <div className="o-foot">
        <div className="o-stepper">
          <button onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-label={tr("oLess", L)}>
            <svg className="icon" viewBox="0 0 24 24"><path d="M6 12h12" /></svg>
          </button>
          <output aria-live="polite">{qty}</output>
          <button onClick={() => setQty((q) => Math.min(20, q + 1))} aria-label={tr("oMoreOne", L)}>
            <svg className="icon" viewBox="0 0 24 24"><path d="M12 6v12M6 12h12" /></svg>
          </button>
        </div>
        <button ref={addBtn} className="o-cta" disabled={needHalf || unit == null} onClick={submit}>
          {needHalf ? tr("oHalfNeed", L) : `${edit ? tr("oSave", L) : tr("oAdd", L)} · ${money((unit ?? 0) * qty, L)}`}
        </button>
      </div>
    </>
  );
}
