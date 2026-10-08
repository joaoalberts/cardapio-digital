"use client";

import { useEffect } from "react";

// Safari (Mac e iPhone/iPad) toca HLS direto e melhor que qualquer biblioteca.
// O Chrome novo também diz que toca, mas falha em alguns casos; nele vai o hls.js.
const apple = () =>
  typeof navigator !== "undefined" &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) ||
    (/Safari\//.test(navigator.userAgent) && !/Chrome|Chromium|CriOS|FxiOS|Edg|Android/.test(navigator.userAgent)));

// iOS só toca sozinho vídeo mudo, e o React não grava "muted" no HTML que vem do servidor.
export function mute(v: HTMLVideoElement) {
  v.muted = true;
  v.defaultMuted = true;
  v.setAttribute("muted", "");
  v.playsInline = true;
}

const tryPlay = (v: HTMLVideoElement) => {
  if (!v.dataset.want || !v.paused) return;
  mute(v);
  v.play().catch(() => {});
};

// O celular às vezes recusa o play automático (modo economia de bateria, link aberto
// dentro de outro app...). No primeiro toque ou rolagem, tudo o que devia estar tocando
// volta a tocar, sem a pessoa precisar mexer em cada vídeo.
let unlockArmed = false;
function armUnlock() {
  if (unlockArmed || typeof window === "undefined") return;
  unlockArmed = true;
  let queued = false;
  const go = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      document.querySelectorAll<HTMLVideoElement>('video[data-want="1"]').forEach(tryPlay);
    });
  };
  for (const ev of ["touchstart", "pointerdown", "scroll", "keydown"]) {
    addEventListener(ev, go, { passive: true, capture: true });
  }
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && go());
}

// Vídeo mudo que deve tocar sozinho: garante o mudo e tenta de novo quando o vídeo fica
// pronto para tocar (o play chamado cedo demais é recusado em silêncio no celular).
export function useAutoplay(vidRef: React.RefObject<HTMLVideoElement | null>) {
  useEffect(() => {
    const v = vidRef.current;
    if (!v) return;
    mute(v);
    armUnlock();
    const retry = () => tryPlay(v);
    v.addEventListener("canplay", retry);
    v.addEventListener("loadeddata", retry);
    return () => {
      v.removeEventListener("canplay", retry);
      v.removeEventListener("loadeddata", retry);
    };
  }, [vidRef]);
}

// Vídeo do Mux (HLS): o Safari toca direto; nos outros navegadores entra o hls.js.
// Os dois trocam de qualidade conforme a internet e o tamanho do vídeo na tela, para
// começar rápido e não travar.
export function useHls(vidRef: React.RefObject<HTMLVideoElement | null>, src: string | null) {
  const hls = !!src && src.includes(".m3u8");
  useEffect(() => {
    const v = vidRef.current;
    if (!v || !hls || !src) return;
    mute(v);
    const native = () => {
      v.src = src;
      tryPlay(v);
    };
    if (apple() && v.canPlayType("application/vnd.apple.mpegurl")) {
      native();
      return () => {
        v.removeAttribute("src");
        v.load();
      };
    }
    let player: import("hls.js").default | undefined;
    let gone = false;
    void import("hls.js").then(({ default: Hls }) => {
      if (gone) return;
      if (!Hls.isSupported()) return native();
      player = new Hls({
        capLevelToPlayerSize: true,
        startLevel: -1,
        abrEwmaDefaultEstimate: 2_000_000,
        maxBufferLength: 12,
        backBufferLength: 10,
      });
      player.loadSource(src);
      player.attachMedia(v);
      player.on(Hls.Events.MANIFEST_PARSED, () => tryPlay(v));
      // Queda de rede ou trecho com defeito: tenta de novo em vez de ficar parado.
      player.on(Hls.Events.ERROR, (_e, d) => {
        if (!d.fatal || !player) return;
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR) player.startLoad();
        else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) player.recoverMediaError();
      });
    });
    return () => {
      gone = true;
      player?.destroy();
    };
  }, [vidRef, hls, src]);
}
