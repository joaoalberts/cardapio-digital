"use client";
/* eslint-disable @next/next/no-img-element -- a arte já vem pronta da rota, em 1080×1920 */

import { useEffect, useRef, useState } from "react";
import { ct } from "@/lib/comunidade/i18n";
import { useOrder } from "../order/order-context";
import { IconClose } from "./parts";
import { useComunidade } from "./provider";

// "Compartilhar no story" (ficha: telas 15 e 16). A folha mostra a arte que a rota
// api/comunidade/[slug]/story desenha (resultado da enquete ou foto da casa, com o @ e o QR
// de /<slug>?ref=story), com as abas "Resultado | Foto da casa" quando há as duas.
// Compartilhar: fetch do PNG → File → navigator.canShare({files}) → navigator.share. Sem
// isso (http, iOS antigo, navegador do Instagram ou do WhatsApp), fica "segure a imagem para
// salvar" e o link de download. Cada compartilhamento ou download conta "share" no funil.

export type StoryOpen = { tab: "poll" | "post"; poll: string | null; post: string | null };

const IconShare = () => (
  <svg className="icon" viewBox="0 0 24 24" aria-hidden>
    <path d="M12 15V3M7 8l5-5 5 5" />
    <path d="M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6" />
  </svg>
);
const IconSave = () => (
  <svg className="icon" viewBox="0 0 24 24" aria-hidden>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </svg>
);

export function ShareStoryButton({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  const { lang } = useOrder();
  return (
    <button className={`cmu-share ${className}`} onClick={onClick}>
      <IconShare />
      {ct("shareStory", lang)}
    </button>
  );
}

type Art = { status: "loading" } | { status: "error" } | { status: "ready"; url: string; file: File; canShare: boolean };

export function StorySheet({ open, onTab, onClose }: { open: StoryOpen; onTab: (t: "poll" | "post") => void; onClose: () => void }) {
  const o = useOrder();
  const c = useComunidade();
  const L = o.lang;
  const id = open.tab === "poll" ? open.poll : open.post;
  const src = o.slug && id ? `/api/comunidade/${o.slug}/story?${open.tab}=${encodeURIComponent(id)}` : null;
  const [art, setArt] = useState<Art>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [hint, setHint] = useState(false);
  const closeBtn = useRef<HTMLButtonElement>(null);

  // Busca o PNG uma vez por arte: a mesma imagem vira a prévia (URL do blob), o arquivo do
  // compartilhamento e o download, sem baixar duas vezes.
  useEffect(() => {
    if (!src) return;
    let url: string | null = null;
    let alive = true;
    queueMicrotask(() => alive && setArt({ status: "loading" }));
    (async () => {
      try {
        const r = await fetch(src);
        if (!r.ok) throw new Error(String(r.status));
        const blob = await r.blob();
        if (!alive) return;
        const file = new File([blob], `story-${o.slug}.png`, { type: "image/png" });
        url = URL.createObjectURL(blob);
        let canShare = false;
        try {
          canShare = typeof navigator.share === "function" && !!navigator.canShare?.({ files: [file] });
        } catch {}
        setArt({ status: "ready", url, file, canShare });
      } catch {
        if (alive) setArt({ status: "error" });
      }
    })();
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src, retry, o.slug]);

  // Foco no fechar ao abrir; ao fechar, volta para o botão que abriu.
  useEffect(() => {
    const from = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus({ preventScroll: true });
    return () => from?.focus?.({ preventScroll: true });
  }, []);

  const share = async () => {
    if (art.status !== "ready") return;
    try {
      await navigator.share({ files: [art.file] });
      c.track("share");
    } catch (e) {
      // Cancelar a folha do sistema não é erro; o resto cai no "segure para salvar".
      if ((e as Error)?.name !== "AbortError") setHint(true);
    }
  };

  const both = !!open.poll && !!open.post;
  const ready = art.status === "ready" ? art : null;
  const fallback = !!ready && (!ready.canShare || hint);

  return (
    <section className="cmu-stl" role="dialog" aria-modal="true" aria-label={ct("shareStory", L)}>
      <header className="cmu-stl-h">
        {both ? (
          <div className="cmu-seg cmu-stl-seg" role="tablist" data-on={open.tab === "post" ? "1" : "0"}>
            <i className="cmu-th" aria-hidden />
            <button role="tab" aria-selected={open.tab === "poll"} onClick={() => onTab("poll")}>
              {ct("storyResult", L)}
            </button>
            <button role="tab" aria-selected={open.tab === "post"} onClick={() => onTab("post")}>
              {ct("storyHouse", L)}
            </button>
          </div>
        ) : null}
        <span className="cmu-sp" />
        <button ref={closeBtn} className="cmu-x" onClick={onClose} aria-label={ct("storyClose", L)}>
          <IconClose />
        </button>
      </header>

      <div className="cmu-art" aria-busy={art.status === "loading"}>
        {ready ? (
          <img src={ready.url} alt={ct("storyAlt", L)} />
        ) : art.status === "error" ? (
          <div className="cmu-art-msg" role="alert">
            <p>{ct("storyErr", L)}</p>
            <button onClick={() => setRetry((n) => n + 1)}>{ct("storyRetry", L)}</button>
          </div>
        ) : (
          <div className="cmu-art-msg" role="status">
            <i className="cmu-spin" aria-hidden />
            <span className="cmu-vh">{ct("storyLoading", L)}</span>
          </div>
        )}
      </div>

      {fallback && <p className="cmu-stl-hold">{ct("storyHold", L)}</p>}
      <div className="cmu-stl-a">
        {!fallback && (
          <button className="cmu-go" onClick={() => void share()} disabled={!ready}>
            <IconShare />
            {ct("storyShare", L)}
          </button>
        )}
        {ready ? (
          <a className="cmu-sv" href={ready.url} download={ready.file.name} onClick={() => c.track("share")}>
            <IconSave />
            {ct("storySave", L)}
          </a>
        ) : (
          <button className="cmu-sv" disabled>
            <IconSave />
            {ct("storySave", L)}
          </button>
        )}
      </div>
      <p className="cmu-stl-n">{ct("storyNote", L)}</p>
    </section>
  );
}
