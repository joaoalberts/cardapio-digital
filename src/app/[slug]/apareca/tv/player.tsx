"use client";
/* eslint-disable @next/next/no-img-element -- logo da casa já vem no tamanho certo, como no telão */

import { useEffect, useRef, type CSSProperties } from "react";
import { tvBgSize } from "@/lib/comunidade/client-logic";
import type { ClientClip, Cursor, HouseClip, Program } from "@/lib/apareca/schedule";
import { clipInProgram, muxHls, muxMp4, pickPlayable, playBody, uuid4, type Pick } from "@/lib/apareca/tv-stage";
import { nextDelay } from "@/lib/apareca/tv-layout";
import { mute, useHls } from "@/lib/menu/use-hls";

// Reprodução do palco do Apareça: dois <video> (A e B). Enquanto um toca, o outro já carrega o
// próximo; no fim (evento ended, nunca um temporizador: duração 0 = desconhecida) o de trás dá
// play e só aparece quando o primeiro quadro sai (evento playing). O que saiu fica com o último
// quadro por baixo durante a troca: nunca há quadro preto. Se nada consegue tocar, o palco some e
// fica o pôster do telão por baixo.
// - Cliente: o MP4 "highest" do Mux (6 s, carrega inteiro e rápido); se falhar, o HLS (useHls).
// - Institucional: do cache local (objectURL) ou do Mux; se o do cache falhar, o do Mux.
// - "Tocou": no primeiro playing de cada exibição, com um play (uuid) novo; sem fila nem nova tentativa.

const START_TIMEOUT_MS = 8_000; // carregou e não saiu o primeiro quadro: pula
const STALL_MS = 10_000; // tocando e parado no mesmo ponto: pula
const SWAP_MS = 600; // a troca (opacity 0,45 s no CSS) e um pouco de folga
const GIVE_UP_FAILS = 3; // falhas seguidas sem nenhum vídeo sair: o palco some e tenta de novo depois
const CURSOR0: Cursor = { houseIdx: 0, clientsSinceHouse: 0, playedHere: {} };

export type SlotView = {
  key: number;
  kind: "house" | "client";
  clip: HouseClip | ClientClip;
  src: string;
};
export type StageView = { slots: [SlotView | null, SlotView | null]; front: number; shown: [boolean, boolean]; on: boolean };
export const EMPTY_VIEW: StageView = { slots: [null, null], front: -1, shown: [false, false], on: false };

type Phase = "loading" | "ready" | "playing" | "failed";
type Slot = SlotView & {
  phase: Phase;
  fromCache: boolean;
  play: string;
  reported: boolean;
  after: Cursor;
  triedAlt: boolean;
};

export type EngineDeps = {
  render: (v: StageView) => void;
  report: (body: Record<string, string | number>) => void;
  houseSrc: (playback: string) => Promise<string>;
};

const newPlay = () => uuid4(crypto.getRandomValues(new Uint8Array(16)));
const isBlob = (s: string) => s.startsWith("blob:");

export class StageEngine {
  private program: Program | null = null;
  private cursor: Cursor = CURSOR0;
  private slots: [Slot | null, Slot | null] = [null, null];
  private shown: [boolean, boolean] = [false, false];
  private front = -1;
  private on = false;
  private paused = true;
  private offline = false;
  private running = false;
  private fails = 0;
  private seq = 0;
  private loadSeq: [number, number] = [0, 0];
  private preloadSkips = 0;
  private want = -1; // slot que deve começar assim que estiver pronto
  private startTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private swapTimer: ReturnType<typeof setTimeout> | undefined;
  private watch: ReturnType<typeof setInterval> | undefined;
  private lastT = -1;
  private stuckSince = 0;
  private vids: [HTMLVideoElement | null, HTMLVideoElement | null] = [null, null];
  private offs: [(() => void) | null, (() => void) | null] = [null, null];

  constructor(private d: EngineDeps) {}

  // ---------- Entrada ----------

  start() {
    this.running = true;
    clearInterval(this.watch);
    this.watch = setInterval(() => this.checkStall(), 1_000);
    this.kick();
  }

  stop() {
    this.running = false;
    clearInterval(this.watch);
    this.reset();
  }

  attach(i: 0 | 1, v: HTMLVideoElement | null) {
    this.offs[i]?.();
    this.offs[i] = null;
    this.vids[i] = v;
    if (!v) return;
    const own = () => {
      const s = this.slots[i];
      return s && v.dataset.key === String(s.key) ? s : null;
    };
    const onReady = () => {
      const s = own();
      if (!s || s.phase !== "loading") return;
      s.phase = "ready";
      if (this.want === i) this.begin(i);
    };
    const onPlaying = () => {
      const s = own();
      if (s) this.playing(i, s);
    };
    const onEnded = () => {
      if (own() && this.front === i) this.advance();
    };
    const onError = () => {
      const s = own();
      if (s && s.phase !== "failed") this.fail(i, s);
    };
    v.addEventListener("canplay", onReady);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("ended", onEnded);
    v.addEventListener("error", onError);
    this.offs[i] = () => {
      v.removeEventListener("canplay", onReady);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("error", onError);
    };
  }

  setProgram(p: Program | null) {
    this.program = p;
    if (!p) {
      this.reset();
      return;
    }
    if (this.front === -1 && this.want === -1) this.kick();
  }

  setPaused(paused: boolean) {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      this.want = -1;
      clearTimeout(this.startTimer);
      this.vids.forEach((v) => v?.pause());
      this.on = false;
      this.emit();
      return;
    }
    // Volta da enquete: continua o que estava na tela, se ainda vale; senão começa de novo.
    const s = this.front >= 0 ? this.slots[this.front] : null;
    const v = this.front >= 0 ? this.vids[this.front] : null;
    if (s && v && s.phase === "playing" && !v.ended && clipInProgram(this.program, s.kind, s.clip.id)) {
      this.on = true;
      this.lastT = -1;
      v.play().catch(() => {});
      this.emit();
    } else {
      this.reset();
      this.kick();
    }
  }

  setOffline(offline: boolean) {
    this.offline = offline;
  }

  // ---------- Motor ----------

  private emit() {
    const view = (s: Slot | null): SlotView | null => (s ? { key: s.key, kind: s.kind, clip: s.clip, src: s.src } : null);
    this.d.render({ slots: [view(this.slots[0]), view(this.slots[1])], front: this.front, shown: [...this.shown], on: this.on });
  }

  private reset() {
    clearTimeout(this.startTimer);
    clearTimeout(this.retryTimer);
    clearTimeout(this.swapTimer);
    this.want = -1;
    this.front = -1;
    this.on = false;
    this.shown = [false, false];
    this.loadSeq = [++this.seq, ++this.seq];
    this.vids.forEach((v) => v?.pause());
    for (const i of [0, 1] as const) this.drop(i);
    this.emit();
  }

  private drop(i: 0 | 1) {
    const s = this.slots[i];
    this.slots[i] = null;
    if (s && isBlob(s.src)) setTimeout(() => URL.revokeObjectURL(s.src), 2_000);
  }

  private kick() {
    if (!this.running || this.paused || !this.program || this.front !== -1 || this.want !== -1) return;
    const pick = pickPlayable(this.program, this.cursor, this.offline);
    if (!pick) return;
    this.want = 0;
    void this.load(0, pick);
  }

  private async load(i: 0 | 1, pick: Pick) {
    const key = ++this.seq;
    this.loadSeq[i] = key;
    this.drop(i);
    const src = pick.kind === "house" ? await this.d.houseSrc(pick.clip.playback) : muxMp4(pick.clip.playback);
    // Outra carga (ou um reset) passou na frente durante o await do cache.
    if (!this.running || this.loadSeq[i] !== key) {
      if (isBlob(src)) URL.revokeObjectURL(src);
      return;
    }
    this.slots[i] = {
      key, kind: pick.kind, clip: pick.clip, src, phase: "loading", fromCache: isBlob(src), play: newPlay(),
      reported: false, after: pick.cursor, triedAlt: false,
    };
    this.emit();
    if (this.want === i) this.armStart(i);
  }

  private armStart(i: 0 | 1) {
    clearTimeout(this.startTimer);
    const s = this.slots[i];
    if (!s) return;
    const key = s.key;
    this.startTimer = setTimeout(() => {
      const cur = this.slots[i];
      if (cur && cur.key === key && cur.phase !== "playing" && this.want === i) this.fail(i, cur);
    }, START_TIMEOUT_MS);
  }

  private begin(i: 0 | 1) {
    this.want = i;
    const s = this.slots[i];
    const v = this.vids[i];
    if (!s || !v || this.paused) return;
    this.armStart(i);
    if (s.phase !== "ready") return; // começa no canplay
    mute(v);
    v.play().catch(() => {
      const cur = this.slots[i];
      if (cur && cur.key === s.key && cur.phase !== "playing") this.fail(i, cur);
    });
  }

  private playing(i: 0 | 1, s: Slot) {
    this.lastT = -1;
    if (s.phase === "playing") return; // volta de pausa: nada de novo
    if (this.want !== i || this.paused) {
      // Tocou sem ser a vez (navegador insistindo): segura.
      this.vids[i]?.pause();
      return;
    }
    s.phase = "playing";
    this.want = -1;
    clearTimeout(this.startTimer);
    this.fails = 0;
    this.preloadSkips = 0;
    this.cursor = s.after;
    if (!s.reported) {
      s.reported = true;
      const body = playBody({ kind: s.kind, id: s.clip.id, play: s.play, fromCache: s.fromCache, duration: this.vids[i]?.duration ?? NaN });
      if (body) this.d.report(body);
    }
    const old = this.front;
    this.front = i;
    this.shown[i] = true;
    this.on = true;
    this.emit();
    const other = (1 - i) as 0 | 1;
    clearTimeout(this.swapTimer);
    // Depois da troca, o de trás para, é esvaziado e já carrega o próximo.
    this.swapTimer = setTimeout(
      () => {
        if (this.front !== i) return;
        if (old >= 0) {
          this.shown[other] = false;
          this.vids[other]?.pause();
        }
        this.preload(other);
      },
      old >= 0 ? SWAP_MS : 0,
    );
  }

  private preload(i: 0 | 1) {
    const f = this.front >= 0 ? this.slots[this.front] : null;
    if (!this.program || !f) return;
    const pick = pickPlayable(this.program, f.after, this.offline);
    if (!pick) {
      this.drop(i);
      this.emit();
      return;
    }
    void this.load(i, pick);
  }

  private advance() {
    if (this.paused || this.front < 0) return;
    const f = this.slots[this.front];
    const nxt = (1 - this.front) as 0 | 1;
    const s = this.slots[nxt];
    const valid = s && s.phase !== "failed" && clipInProgram(this.program, s.kind, s.clip.id) && !(this.offline && s.kind === "client");
    if (s && valid) {
      this.begin(nxt);
      return;
    }
    // O de trás falhou: o próximo vem depois dele; saiu do programa: refaz a partir do que tocou.
    const base = s && s.phase === "failed" ? s.after : f?.after;
    const pick = this.program && base ? pickPlayable(this.program, base, this.offline) : null;
    if (!pick) {
      this.giveUp();
      return;
    }
    this.want = nxt;
    void this.load(nxt, pick);
  }

  private fail(i: 0 | 1, s: Slot) {
    // Parou no meio (rede caiu, arquivo quebrado): conta a falha e vai para o próximo.
    if (s.phase === "playing") {
      s.phase = "failed";
      this.fails += 1;
      if (this.fails >= GIVE_UP_FAILS) this.giveUp();
      else if (this.front === i) this.advance();
      return;
    }
    // Segunda chance com outra origem: cliente MP4 → HLS; institucional do cache → Mux.
    if (!s.triedAlt && !this.offline && (s.kind === "client" || isBlob(s.src))) {
      s.triedAlt = true;
      const old = s.src;
      s.src = s.kind === "client" ? muxHls(s.clip.playback) : muxMp4(s.clip.playback);
      s.fromCache = false;
      s.phase = "loading";
      if (isBlob(old)) setTimeout(() => URL.revokeObjectURL(old), 2_000);
      this.emit();
      if (this.want === i) this.armStart(i);
      return;
    }
    s.phase = "failed";
    // O pré-carregado falhou com o da frente tocando: tenta outro, no máximo 2 vezes por troca.
    if (this.want !== i) {
      const pick = this.program && this.preloadSkips < 2 ? pickPlayable(this.program, s.after, this.offline) : null;
      if (pick) {
        this.preloadSkips += 1;
        void this.load(i, pick);
      }
      return;
    }
    this.fails += 1;
    const pick = this.fails < GIVE_UP_FAILS && this.program ? pickPlayable(this.program, s.after, this.offline) : null;
    if (!pick) {
      this.giveUp();
      return;
    }
    void this.load(i, pick); // continua sendo a vez deste slot
  }

  private giveUp() {
    this.reset();
    if (!this.running) return;
    this.retryTimer = setTimeout(() => this.kick(), nextDelay(this.fails));
  }

  private checkStall() {
    if (this.paused || this.front < 0) return;
    const s = this.slots[this.front];
    const v = this.vids[this.front];
    if (!s || !v || s.phase !== "playing" || v.ended || document.visibilityState !== "visible") return;
    const t = v.currentTime;
    const now = Date.now();
    if (t !== this.lastT) {
      this.lastT = t;
      this.stuckSince = now;
      if (v.paused) v.play().catch(() => {});
      return;
    }
    if (v.paused) v.play().catch(() => {});
    if (now - this.stuckSince >= STALL_MS) {
      this.fails += 1;
      this.lastT = -1;
      if (this.fails >= GIVE_UP_FAILS) this.giveUp();
      else this.advance();
    }
  }
}

// ---------- Uma camada (A ou B) ----------

type SlotProps = {
  i: 0 | 1;
  view: SlotView | null;
  front: boolean;
  shown: boolean;
  active: boolean; // na frente, com o palco no ar
  plain: boolean;
  clipStyle: CSSProperties;
  engine: StageEngine;
  logo: string | null;
  houseName: string;
  qrSvg: string;
};

export function StageSlot({ i, view, front, shown, active, plain, clipStyle, engine, logo, houseName, qrSvg }: SlotProps) {
  const vid = useRef<HTMLVideoElement>(null);
  const bg = useRef<HTMLCanvasElement>(null);
  const src = view?.src ?? null;
  const hls = !!src && src.includes(".m3u8");

  useEffect(() => {
    const v = vid.current;
    engine.attach(i, v);
    if (v) mute(v);
    return () => engine.attach(i, null);
  }, [engine, i]);

  // Origem do vídeo: MP4 ou objectURL direto; HLS pelo useHls. A chave diz ao motor de qual exibição é cada evento.
  // Só muda quando muda a exibição (key) ou a origem (src): o resto do estado do palco não recarrega o vídeo.
  const key = view?.key ?? null;
  useEffect(() => {
    const v = vid.current;
    if (!v) return;
    v.dataset.key = key === null ? "" : String(key);
    if (key === null || !src) {
      v.removeAttribute("src");
      v.load();
      return;
    }
    if (hls) return;
    mute(v);
    v.src = src;
    v.load();
  }, [key, src, hls]);
  useHls(vid, hls ? src : null);

  // Fundo do cliente: o próprio vídeo desenhado num canvas de 64 px (no formato da tela) e
  // esticado: desfoca sem filter nem segundo vídeo (pesado em TV fraca). ~8 quadros por segundo.
  const client = view?.kind === "client";
  useEffect(() => {
    const v = vid.current;
    const cv = bg.current;
    if (!v || !cv || !client || plain) return;
    const size = tvBgSize(window.innerWidth, window.innerHeight);
    if (cv.width !== size.w) cv.width = size.w;
    if (cv.height !== size.h) cv.height = size.h;
    const ctx = cv.getContext("2d");
    // Passo intermediário em 1/4 do tamanho: reduzir e ampliar de novo desfoca de verdade (sem ele,
    // a ampliação de 64 px para a tela mostra blocos onde o vídeo tem contraste).
    const tiny = document.createElement("canvas");
    tiny.width = Math.max(1, Math.round(size.w / 4));
    tiny.height = Math.max(1, Math.round(size.h / 4));
    const tctx = tiny.getContext("2d");
    if (!ctx || !tctx) return;
    ctx.imageSmoothingQuality = "high";
    const draw = () => {
      if (v.readyState < 2 || !v.videoWidth) return;
      const k = Math.max(tiny.width / v.videoWidth, tiny.height / v.videoHeight);
      const w = tiny.width / k;
      const h = tiny.height / k;
      try {
        tctx.drawImage(v, (v.videoWidth - w) / 2, (v.videoHeight - h) / 2, w, h, 0, 0, tiny.width, tiny.height);
        ctx.drawImage(tiny, 0, 0, cv.width, cv.height);
      } catch {}
    };
    v.addEventListener("loadeddata", draw);
    draw();
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last >= 120) {
        last = t;
        draw();
      }
      raf = requestAnimationFrame(loop);
    };
    if (active) raf = requestAnimationFrame(loop);
    return () => {
      v.removeEventListener("loadeddata", draw);
      cancelAnimationFrame(raf);
    };
  }, [client, plain, active, view?.key]);

  const name = client ? (view.clip as ClientClip).name : null;
  return (
    <div className={`apt-slot${view ? ` k-${view.kind}` : ""}${front ? " front" : ""}${shown ? " shown" : ""}`} aria-hidden={!shown}>
      <div className="apt-bgw" aria-hidden>
        <canvas ref={bg} width={64} height={36} />
      </div>
      <div className="apt-clip" style={client ? clipStyle : undefined}>
        <video ref={vid} muted playsInline preload="auto" disablePictureInPicture disableRemotePlayback />
        {name && <p className="apt-name">{name}</p>}
      </div>
      {client && (
        <>
          {logo ? (
            <img className="apt-logo" src={logo} alt="" />
          ) : (
            <span className="apt-logo apt-initial fd" aria-hidden>
              {houseName.slice(0, 1)}
            </span>
          )}
          <aside className="apt-qr">
            <div className="tl-plate" role="img" aria-label="QR para aparecer na TV" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            <p className="apt-qcap">
              <b className="fd">Quer aparecer aqui?</b>
              <span>Escaneie!</span>
            </p>
          </aside>
        </>
      )}
    </div>
  );
}
