"use client";

import { useEffect, useRef, useState } from "react";
import { ct } from "@/lib/comunidade/i18n";
import { CartButton } from "../order/cart-button";
import { useOrder } from "../order/order-context";
import { Mural, PhotoView } from "./mural";
import { IconClose } from "./parts";
import { useComunidade, type Tab } from "./provider";
import { Stage } from "./stage";

// Camada da Comunidade em tela cheia, irmã da camada do pedido (ficha: "Folha abre").
// Vidro único da camada (blur 30 + saturate .55); dentro, nada tem desfoque próprio.
// Abas Palco | Mural, o carrinho (as folhas do pedido abrem por cima) e fechar. Aberta, a
// capa pausa o vídeo (menu-app.tsx, `covered`). Fecha pelo botão ou pelo Esc; o cardápio não
// usa o "voltar" do navegador para as outras folhas, então aqui também não.
export function ComunidadeLayer() {
  const c = useComunidade();
  const o = useOrder();
  const L = o.lang;
  const [photo, setPhoto] = useState<{ src: string; name: string } | null>(null);
  const sec = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);
  const { open, setOpen, tab, setTab } = c;

  // Foco: aberta pelo balão, vai para a aba ativa; ao fechar, volta para o balão. Aberta
  // sozinha (QR do telão), o foco fica onde está (sem anel de foco na aba sem ninguém tocar).
  useEffect(() => {
    if (open) {
      const from = document.activeElement;
      if (!from?.closest?.(".cmu-bal")) return;
      opener.current = from;
      sec.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
      return;
    }
    (opener.current as HTMLElement | null)?.focus?.({ preventScroll: true });
    opener.current = null;
    queueMicrotask(() => setPhoto(null));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || o.sheet) return; // a folha do pedido aberta fecha primeiro
      if (photo) setPhoto(null);
      else setOpen(false);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open, photo, o.sheet, setOpen]);

  if (!c.state?.enabled) return null;
  const tabBtn = (t: Tab) => (
    <button
      role="tab"
      id={`cmu-tab-${t}`}
      aria-controls={`cmu-pane-${t}`}
      aria-selected={tab === t}
      tabIndex={tab === t ? 0 : -1}
      onClick={() => setTab(t)}
    >
      {ct(t, L)}
    </button>
  );

  return (
    <section
      ref={sec}
      className={`cmu-layer${open ? " on" : ""}${c.offline ? " offline" : ""}`}
      data-tab={tab}
      role="dialog"
      aria-modal="true"
      aria-label={ct("community", L)}
      aria-hidden={!open}
      inert={!open}
    >
      <header className="cmu-h">
        <div
          className="cmu-seg"
          role="tablist"
          data-on={tab === "mural" ? "1" : "0"}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              const t: Tab = tab === "palco" ? "mural" : "palco";
              setTab(t);
              sec.current?.querySelector<HTMLElement>(`#cmu-tab-${t}`)?.focus();
            }
          }}
        >
          <i className="cmu-th" aria-hidden />
          {tabBtn("palco")}
          {tabBtn("mural")}
        </div>
        <span className="cmu-sp" />
        {/* Fora da disputa do islandRef: a camada fica montada (escondida) com o story aberto
            e, vindo depois dele na árvore, tomaria o alvo do "voo" do "Pedir agora" do story.
            O "Pedir também" daqui voa até este botão direto (buy-button.tsx). */}
        <CartButton island={false} className="cmu-cart" />
        <button className="cmu-x" onClick={() => setOpen(false)} aria-label={ct("closeAria", L)}>
          <IconClose />
        </button>
      </header>
      {c.offline && (
        <div className="cmu-offp" role="status">
          <i className="cmu-spin" aria-hidden />
          {ct("offline", L)}
        </div>
      )}
      <div className="cmu-b">
        <div className="cmu-panes">
          <div className="cmu-pane" id="cmu-pane-palco" role="tabpanel" aria-labelledby="cmu-tab-palco" inert={tab !== "palco"}>
            <Stage />
          </div>
          <div className="cmu-pane" id="cmu-pane-mural" role="tabpanel" aria-labelledby="cmu-tab-mural" inert={tab !== "mural"}>
            <Mural onPhoto={setPhoto} />
          </div>
        </div>
      </div>
      {photo && <PhotoView photo={photo} onClose={() => setPhoto(null)} lang={L} />}
    </section>
  );
}
