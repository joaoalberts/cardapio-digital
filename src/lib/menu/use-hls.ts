"use client";

import { useEffect, useRef } from "react";

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
  const playAll = () => document.querySelectorAll<HTMLVideoElement>('video[data-want="1"]').forEach(tryPlay);
  // Rolagem dispara muitas vezes: junta tudo num quadro.
  let queued = false;
  const later = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      playAll();
    });
  };
  // No iPhone só o fim do toque (touchend/pointerup/click) conta como gesto que libera o
  // play, e o play tem de ser chamado ali dentro, na hora (não no quadro seguinte).
  for (const ev of ["touchend", "pointerup", "click", "keydown"]) {
    addEventListener(ev, playAll, { passive: true, capture: true });
  }
  for (const ev of ["touchstart", "pointerdown", "scroll"]) {
    addEventListener(ev, later, { passive: true, capture: true });
  }
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && later());
}

// Vigia: uma vez por segundo confere cada vídeo que devia estar tocando. Se o navegador
// pausou por conta própria, dá play de novo; se o vídeo tem dados mas a imagem parou
// (o decodificador do celular engasgou), empurra um instante para a frente, o que
// destrava a imagem. Assim nenhum vídeo fica congelado num quadro.
let keeperArmed = false;
function armKeeper() {
  if (keeperArmed || typeof window === "undefined") return;
  keeperArmed = true;
  const seen = new WeakMap<HTMLVideoElement, { t: number; n: number }>();
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    document.querySelectorAll<HTMLVideoElement>('video[data-want="1"]').forEach((v) => {
      if (v.dataset.hold) return;
      if (v.paused) {
        seen.delete(v);
        tryPlay(v);
        return;
      }
      const t = v.currentTime;
      const prev = seen.get(v);
      // Parado com dados no buffer (readyState 3+) por ~2 s: engasgo, não falta de internet.
      if (prev && Math.abs(t - prev.t) < 0.01 && v.readyState >= 3) {
        if (prev.n >= 1) {
          const d = v.duration;
          v.currentTime = Number.isFinite(d) && t + 0.1 >= d ? 0 : t + 0.1;
          v.play().catch(() => {});
          seen.delete(v);
        } else seen.set(v, { t, n: prev.n + 1 });
        return;
      }
      seen.set(v, { t, n: 0 });
    });
  }, 1000);
}

// Vídeo mudo que deve tocar sozinho: garante o mudo e tenta de novo quando o vídeo fica
// pronto para tocar (o play chamado cedo demais é recusado em silêncio no celular).
export function useAutoplay(vidRef: React.RefObject<HTMLVideoElement | null>) {
  useEffect(() => {
    const v = vidRef.current;
    if (!v) return;
    mute(v);
    armUnlock();
    armKeeper();
    const retry = () => tryPlay(v);
    v.addEventListener("canplay", retry);
    v.addEventListener("loadeddata", retry);
    return () => {
      v.removeEventListener("canplay", retry);
      v.removeEventListener("loadeddata", retry);
    };
  }, [vidRef]);
}

// Deixa o player pronto antes do primeiro toque num vídeo (fora do Safari, que não usa).
let hlsWarm: Promise<unknown> | null = null;
export function preloadHls() {
  if (hlsWarm || typeof window === "undefined" || apple()) return;
  hlsWarm = import("hls.js").catch(() => (hlsWarm = null));
}

// Antes de o vídeo aparecer, lê as listas dele (alguns KB, o Mux não deixa guardar) só
// para abrir de antemão a conexão com os servidores de onde os trechos vêm. Assim o
// primeiro trecho não espera a conexão nova (3 idas e voltas a menos no celular).
const warmedVideos = new Set<string>();
const opened = new Set<string>();
function openOrigin(origin: string) {
  if (opened.has(origin)) return;
  opened.add(origin);
  const l = document.createElement("link");
  l.rel = "preconnect";
  l.href = origin;
  l.crossOrigin = "anonymous";
  document.head.appendChild(l);
}
const originsIn = (text: string) => [...new Set([...text.matchAll(/https:\/\/[^/\s"]+/g)].map((m) => m[0]))];
export function warmVideo(src: string | null) {
  if (!src || !src.includes(".m3u8") || warmedVideos.has(src) || typeof window === "undefined") return;
  warmedVideos.add(src);
  const get = (u: string) => fetch(u, { priority: "low" } as RequestInit).then((r) => (r.ok ? r.text() : ""));
  get(src)
    .then((master) => {
      originsIn(master).forEach(openOrigin);
      const variant = master.split("\n").find((l) => l.startsWith("https://"));
      return variant ? get(variant) : "";
    })
    .then((list) => originsIn(list).forEach(openOrigin))
    .catch(() => warmedVideos.delete(src));
}

// Velocidade da internet medida no último vídeo: os próximos já começam na qualidade
// que ela aguenta (no 5G, direto em alta), sem passar pela qualidade baixa de novo.
let lastBandwidth = 0;

// Primeiro vídeo da visita (velocidade ainda desconhecida): começa perto de 720p, que já
// é nítido no celular e baixa bem mais rápido que o Full HD; sobe sozinho até o máximo.
export function startLevelFor(levels: { height?: number }[], target = 720): number {
  if (!levels.length) return -1;
  let best = 0;
  levels.forEach((l, i) => {
    const h = l.height ?? 0;
    const bh = levels[best].height ?? 0;
    if (h >= target ? bh < target || h < bh : bh < target && h > bh) best = i;
  });
  return best;
}

// Vídeo do Mux (HLS): o Safari toca direto; nos outros navegadores entra o hls.js.
// Os dois trocam de qualidade conforme a internet e o tamanho do vídeo na tela, para
// começar rápido e não travar.
// `loop`: vídeo curto que repete (capa e categorias). Guarda o vídeo inteiro no buffer
// para a volta ao começo não baixar de novo nem dar o tranco do recomeço.
// `load` falso: o vídeo fica pronto (lista lida, capa na tela) mas não baixa trechos;
// os cards perto da tela, mas fora dela, esperam assim e só baixam quando aparecem.
export function useHls(vidRef: React.RefObject<HTMLVideoElement | null>, src: string | null, loop = false, load = true) {
  const hls = !!src && src.includes(".m3u8");
  const playerRef = useRef<import("hls.js").default | undefined>(undefined);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
    const p = playerRef.current;
    if (!p) return;
    if (load) p.startLoad();
    else p.stopLoad();
  }, [load]);
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
        // Sem medida ainda, supõe uma internet de celular boa (5 Mbit/s).
        abrEwmaDefaultEstimate: lastBandwidth || 5_000_000,
        maxBufferLength: loop ? 30 : 12,
        backBufferLength: loop ? Infinity : 10,
        autoStartLoad: loadRef.current,
      });
      playerRef.current = player;
      player.loadSource(src);
      player.attachMedia(v);
      player.on(Hls.Events.MANIFEST_PARSED, (_e, d) => {
        // Velocidade já medida: o player escolhe sozinho pela medida (startLevel -1).
        if (player && !lastBandwidth) player.startLevel = startLevelFor(d.levels);
        tryPlay(v);
      });
      player.on(Hls.Events.FRAG_LOADED, () => {
        if (player?.bandwidthEstimate) lastBandwidth = player.bandwidthEstimate;
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
      playerRef.current = undefined;
    };
  }, [vidRef, hls, src, loop]);
}
