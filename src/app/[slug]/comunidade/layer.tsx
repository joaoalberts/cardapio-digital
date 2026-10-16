"use client";

import { useEffect, useRef, useState } from "react";
import { houseHighlight, storyChoices } from "@/lib/comunidade/client-logic";
import { ct } from "@/lib/comunidade/i18n";
import { CartButton } from "../order/cart-button";
import { useOrder } from "../order/order-context";
import { Mural, PhotoView, type Photo } from "./mural";
import { IconClose } from "./parts";
import { useComunidade, type Tab } from "./provider";
import { StorySheet, type StoryOpen } from "./share";
import { Stage } from "./stage";

// Camada da Comunidade em tela cheia, irmã da camada do pedido (ficha: "Folha abre").
// Vidro único da camada (blur 30 + saturate .55); dentro, nada tem desfoque próprio.
// Abas Palco | Mural, o carrinho (as folhas do pedido abrem por cima) e fechar. Aberta, a
// capa pausa o vídeo (menu-app.tsx, `covered`). Fecha pelo botão ou pelo Esc; o cardápio não
// usa o "voltar" do navegador para as outras folhas, então aqui também não. Por cima dela, a
// foto grande do Mural e, irmã dela, a folha do story (share.tsx), que o Esc fecha primeiro.
export function ComunidadeLayer() {
  const c = useComunidade();
  const o = useOrder();
  const L = o.lang;
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [story, setStory] = useState<StoryOpen | null>(null);
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
    queueMicrotask(() => {
      setPhoto(null);
      setStory(null);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || o.sheet) return; // a folha do pedido aberta fecha primeiro
      if (story) setStory(null);
      else if (photo) setPhoto(null);
      else setOpen(false);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open, photo, story, o.sheet, setOpen]);

  // "Compartilhar no story": do Palco abre no resultado; da foto grande, nela. As abas da
  // folha trocam entre os dois quando há os dois (storyChoices).
  const shareFrom = (tab: "poll" | "post", post?: string) => {
    const s = c.state;
    const ch = storyChoices(s, {
      mine: s?.poll ? c.myVote(s.poll.id) : null,
      canVote: c.canVote,
      highlightId: o.menu && s ? (houseHighlight(o.menu, new Date(Date.parse(s.now)))?.id ?? null) : null,
      hasItem: (id) => !!o.itemById(id),
    });
    setStory({ tab, poll: ch.poll, post: post ?? ch.post });
  };

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

  // A folha do story é irmã da camada, não filha: um backdrop-filter dentro de outro não
  // desfoca o que está atrás (ficha: o story é uma camada própria, com o vidro da folha).
  return (
    <>
      <section
        ref={sec}
        className={`cmu-layer${open ? " on" : ""}${c.offline ? " offline" : ""}`}
        data-tab={tab}
        role="dialog"
        aria-modal="true"
        aria-label={ct("community", L)}
        aria-hidden={!open || !!story}
        inert={!open || !!story}
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
              <Stage onShare={() => shareFrom("poll")} />
            </div>
            <div className="cmu-pane" id="cmu-pane-mural" role="tabpanel" aria-labelledby="cmu-tab-mural" inert={tab !== "mural"}>
              <Mural onPhoto={setPhoto} />
            </div>
          </div>
        </div>
        {photo && <PhotoView photo={photo} onClose={() => setPhoto(null)} onShare={(id) => shareFrom("post", id)} lang={L} />}
      </section>
      {open && story && <StorySheet open={story} onTab={(tab) => setStory({ ...story, tab })} onClose={() => setStory(null)} />}
    </>
  );
}
