"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MenuItem } from "@/lib/menu/types";
import { t as tr } from "@/lib/menu/i18n";
import { NOTE_MAX, halfPrice, itemPrice } from "@/lib/orders/pricing";
import type { CartLine } from "@/lib/orders/cart";
import { money, useOrder } from "./order-context";

// Folha de vidro do prato: nome e preço no alto; linhas para tamanho, massa, Inteira ou Metade e
// observação. Inteira (ou prato sem escolha) vai direto ao pedido. Em Metade, "Escolher"
// comprime a folha e o cliente navega até o outro sabor (barrinha em pick-bar.tsx).
export function ItemSheet({ item, focusNote, edit, draft, qty: startQty }: { item: MenuItem; focusNote: boolean; edit: CartLine | null; draft?: { option: string | null; note: string; dough?: string | null }; qty?: number }) {
  const o = useOrder();
  const L = o.lang;
  const sizes = item.price_options ?? [];
  const [option, setOption] = useState<string | null>(draft?.option ?? edit?.option ?? (sizes.length ? sizes[sizes.length - 1].label : null));
  // Massa: começa na primeira; a da linha (ou do rascunho) só vale se a categoria ainda tiver.
  const doughs = item.doughs ?? [];
  const wanted = draft?.dough ?? edit?.dough;
  const [dough, setDough] = useState<string | null>(doughs.find((d) => d.label === wanted)?.label ?? doughs[0]?.label ?? null);
  const extra = doughs.find((d) => d.label === dough)?.extra_cents ?? 0;
  const [mode, setMode] = useState<"whole" | "half">(edit?.half || draft ? "half" : "whole");
  const [note, setNote] = useState(draft?.note ?? edit?.note ?? "");
  const [noteOpen, setNoteOpen] = useState(focusNote || !!(draft?.note ?? edit?.note));
  const noteRef = useRef<HTMLInputElement>(null);

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
  const canHalf = item.half_half && partners.length > 0;
  const effMode = canHalf ? mode : "whole";
  const other = edit?.half ? o.itemById(edit.half) ?? null : null; // editando uma meio a meio já escolhida
  const pa = itemPrice(item, option);
  // Em Metade, antes do outro sabor, vale a metade do sabor (sem a massa, como antes); inteira soma o extra.
  const shown = pa == null ? null : effMode === "half" ? Math.ceil(pa / 2) : pa + extra;
  // Prato aberto pelo "Pedir também" da Comunidade: a origem vai junto só no prato novo.
  // Na edição a linha já tem a dela (replaceLine a mantém). Lida na hora do toque: com a
  // folha aberta, o o.sheet é esta folha.
  const origin = () => (!edit && o.sheet?.kind === "item" && o.sheet.item.id === item.id ? o.sheet.origin : undefined);

  const save = (half: string | null) => {
    if (pa == null) return;
    const line = { item: item.id, option, half, qty: edit?.qty ?? startQty ?? 1, note: note.trim().slice(0, NOTE_MAX), ...(dough ? { dough } : {}) };
    if (edit) o.replace(edit.key, line);
    else o.add({ ...line, ...(origin() ?? {}) });
    o.openCart("cart");
  };
  const startPick = () => {
    const from = origin();
    o.startPick({
      keep: item,
      option,
      note: note.trim().slice(0, NOTE_MAX),
      dough,
      swap: edit ? { key: edit.key, side: "half" } : null,
      fromSheet: !!edit,
      qty: startQty,
      ...(from ? { origin: from } : {}),
    });
  };

  // Editando uma meio a meio, o preço do alto é o da pizza inteira montada, com o extra da massa.
  const editHalfPrice = effMode === "half" && other && pa != null && itemPrice(other, option) != null ? halfPrice(pa, itemPrice(other, option)!) + extra : null;
  // "+ R$ 5" pequeno no botão da massa que custa a mais.
  const doughBtn = (d: { label: string; extra_cents: number }) => (
    <button key={d.label} aria-pressed={dough === d.label} onClick={() => setDough(d.label)}>
      {d.label}
      {d.extra_cents > 0 && <small className="g-extra">+ {money(d.extra_cents, L)}</small>}
    </button>
  );

  return (
    <>
      <div className="g-title">
        <h2 id="o-item-title" className="o-dish" tabIndex={-1} data-autofocus>{item.name}</h2>
        {shown != null && <span className="g-price">{money(editHalfPrice ?? shown, L)}</span>}
      </div>
      <div className="g-rows">
        {sizes.length > 1 && (
          <div className="g-row">
            <span className="g-lbl">{tr("oSize", L)}</span>
            <div className="g-seg" role="group" aria-label={tr("oSize", L)}>
              {sizes.map((s) => (
                // Editando uma meio a meio, só os tamanhos que a outra metade também tem.
                <button key={s.label} aria-pressed={option === s.label} disabled={effMode === "half" && !!other && itemPrice(other, s.label) == null} onClick={() => setOption(s.label)}>{s.label}</button>
              ))}
            </div>
          </div>
        )}
        {/* Massa antes de Pizza (protótipo aprovado): duas massas no controle que desliza; três ou quatro, botões. */}
        {doughs.length === 2 ? (
          <div className="g-row">
            <span className="g-lbl">{tr("oDough", L)}</span>
            <div className="g-seg two massa" role="group" aria-label={tr("oDough", L)}>
              <span className="g-thumb" style={{ translate: dough === doughs[1].label ? "100% 0" : "0 0" }} aria-hidden />
              {doughs.map(doughBtn)}
            </div>
          </div>
        ) : doughs.length > 2 ? (
          <div className="g-row">
            <span className="g-lbl">{tr("oDough", L)}</span>
            <div className="g-seg" role="group" aria-label={tr("oDough", L)}>{doughs.map(doughBtn)}</div>
          </div>
        ) : null}
        {canHalf && (
          <div className="g-row">
            <span className="g-lbl">{tr("oPizza", L)}</span>
            <div className="g-seg two" role="group" aria-label={tr("oPizza", L)}>
              <span className="g-thumb" style={{ translate: effMode === "half" ? "100% 0" : "0 0" }} aria-hidden />
              <button aria-pressed={effMode === "whole"} onClick={() => setMode("whole")}>{tr("oWhole", L)}</button>
              <button aria-pressed={effMode === "half"} onClick={() => setMode("half")}>{tr("oHalfBtn", L)}</button>
            </div>
          </div>
        )}
        {/* Observação: um toque na palavra abre o campo na própria linha, sem caixa embaixo. */}
        <div className="g-row g-note">
          {!noteOpen ? (
            <button className="g-lbl g-notel" onClick={() => { setNoteOpen(true); setTimeout(() => noteRef.current?.focus(), 30); }}>
              {tr("oNote", L)}
            </button>
          ) : (
            <>
              <input
                id="o-note"
                ref={noteRef}
                className="g-note-in"
                maxLength={NOTE_MAX}
                value={note}
                placeholder={tr("oNotePh", L)}
                aria-label={tr("oNote", L)}
                onChange={(e) => setNote(e.target.value)}
                // Extensões de escrita (Grammarly, LanguageTool…) não põem ícone no campo.
                data-gramm="false"
                data-gramm_editor="false"
                data-enable-grammarly="false"
                data-lt-active="false"
                autoComplete="off"
              />
              {note.length > NOTE_MAX - 40 && <span className={`o-count${note.length > NOTE_MAX - 20 ? " warn" : ""}`}>{NOTE_MAX - note.length}</span>}
            </>
          )}
        </div>
        {/* Outra metade por último: Pizza, Observação, Outra metade (pedido do João). */}
        {effMode === "half" && (
          <div className="g-row">
            <span className="g-lbl">{tr("oOtherHalf", L)}</span>
            <button className="g-pick" onClick={startPick}>
              <b>{other ? other.name : tr("oPick", L)}</b> ›
            </button>
          </div>
        )}
      </div>
      {/* Em Metade não há botão embaixo: "Escolher" já leva adiante. Editando uma meio a meio já montada, o botão salva. */}
      {(effMode === "whole" || (edit && edit.half)) && (
        <button className="g-cta" disabled={pa == null} onClick={() => save(effMode === "half" ? edit?.half ?? null : null)}>
          <span>{edit ? tr("oSave", L) : tr("oAdd", L)}</span>
          <span className="g-plus" aria-hidden>
            <svg className="icon" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
          </span>
        </button>
      )}
    </>
  );
}
