"use client";

import { useEffect } from "react";

// Vídeo do Mux (HLS): o Safari toca direto; nos outros navegadores entra o hls.js.
// Os dois trocam de qualidade conforme a internet e o tamanho do vídeo na tela, para
// começar rápido e não travar.
export function useHls(vidRef: React.RefObject<HTMLVideoElement | null>, src: string | null) {
  const hls = !!src && src.includes(".m3u8");
  useEffect(() => {
    const v = vidRef.current;
    if (!v || !hls || !src) return;
    if (v.canPlayType("application/vnd.apple.mpegurl")) {
      v.src = src;
      if (v.dataset.want) v.play().catch(() => {});
      return;
    }
    let player: import("hls.js").default | undefined;
    let gone = false;
    void import("hls.js").then(({ default: Hls }) => {
      if (gone) return;
      if (!Hls.isSupported()) {
        v.src = src;
        return;
      }
      player = new Hls({
        capLevelToPlayerSize: true,
        startLevel: -1,
        abrEwmaDefaultEstimate: 2_000_000,
        maxBufferLength: 12,
        backBufferLength: 10,
      });
      player.loadSource(src);
      player.attachMedia(v);
      player.on(Hls.Events.MANIFEST_PARSED, () => {
        if (v.dataset.want) v.play().catch(() => {});
      });
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
