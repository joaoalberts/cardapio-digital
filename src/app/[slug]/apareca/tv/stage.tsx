"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Program } from "@/lib/apareca/schedule";
import { LOGO_U, NAME_U, QR_U, stageLayout } from "@/lib/apareca/tv-layout";
import {
  houseCacheDropDue, MUX_STREAM, muxMp4, parseProgramReply, pollDelay, programAfter, type ProgramReply,
} from "@/lib/apareca/tv-stage";
import { cacheHouse, clearHouseCache, houseSrc } from "./house-cache";
import { EMPTY_VIEW, StageEngine, StageSlot, type StageView } from "./player";

// Palco do Apareça no telão (T14): os vídeos dos clientes aprovados e os institucionais da casa,
// numa camada por cima do pôster da Comunidade. Sem programa (Apareça desligado, fora do horário,
// nada aprovado, erro sem programa anterior) a camada fica transparente e aparece o pôster de
// sempre, que segue por baixo: nunca fica preto. Pausa com enquete aberta e no "Deu X" (quem
// decide é o telão, pela prop paused).
// - Programação: POST tv/programa a cada 5 s com o segredo da TV (localStorage tl-secret:<slug>,
//   lido a cada chamada: o telão troca o segredo depois de um 401). Erro: 10, 20, 30 s e continua
//   com o último programa; volta sozinho. Aba escondida: para; volta no visibilitychange e no online.
// - Sem rede (navegador offline ou 2 falhas seguidas): só institucionais, do cache local.
// - "Tocou": uma vez por exibição, sem guardar para depois (rede fora = descarta).

const POLL_PATH = (slug: string) => `/api/apareca/${slug}/tv/programa`;
const PLAY_PATH = (slug: string) => `/api/apareca/${slug}/tv/tocou`;
const OFFLINE_AFTER = 2; // falhas seguidas da programação para tratar como "sem rede"

const readSecret = (slug: string) => {
  try {
    return localStorage.getItem(`tl-secret:${slug}`);
  } catch {
    return null;
  }
};

type ProgramState = { program: Program | null; logo: string | null; failures: number; stream: string };

function useProgram(slug: string): ProgramState {
  const [st, setSt] = useState<ProgramState>({ program: null, logo: null, failures: 0, stream: MUX_STREAM });
  useEffect(() => {
    let alive = true;
    let busy = false;
    let fails = 0;
    let noProgramSince: number | null = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      clearTimeout(timer);
      if (!alive || busy || document.visibilityState !== "visible") return;
      busy = true;
      let res: { reply: ProgramReply } | { status: number };
      try {
        const secret = readSecret(slug);
        if (!secret) res = { status: 401 };
        else {
          const r = await fetch(POLL_PATH(slug), {
            method: "POST",
            headers: { "x-telao": secret, "content-type": "application/json" },
            body: "{}",
            cache: "no-store",
          });
          const reply = r.ok ? parseProgramReply(await r.json().catch(() => null)) : null;
          res = reply ? { reply } : { status: r.ok ? 0 : r.status };
        }
      } catch {
        res = { status: 0 };
      } finally {
        busy = false;
      }
      if (!alive) return;
      fails = "reply" in res ? 0 : fails + 1;
      const f = fails;
      const r = res;
      setSt((s) => ({
        program: programAfter(s.program, r),
        logo: "reply" in r ? r.reply.logo : s.logo,
        failures: f,
        stream: "reply" in r ? r.reply.stream : s.stream,
      }));
      // Sem programa (desligado, 401, 404) há 10 min: os institucionais guardados saem do aparelho.
      const has = "reply" in r ? r.reply.enabled : r.status !== 401 && r.status !== 404 && noProgramSince === null;
      if (has) noProgramSince = null;
      else {
        noProgramSince ??= Date.now();
        if (houseCacheDropDue(noProgramSince, Date.now())) void clearHouseCache();
      }
      timer = setTimeout(() => void tick(), pollDelay(r, fails));
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
      else clearTimeout(timer);
    };
    const onOnline = () => void tick();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [slug]);
  return st;
}

function useOnline(): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const read = () => setOn(navigator.onLine !== false);
    read();
    window.addEventListener("online", read);
    window.addEventListener("offline", read);
    return () => {
      window.removeEventListener("online", read);
      window.removeEventListener("offline", read);
    };
  }, []);
  return on;
}

function useViewport() {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const read = () => setSize((s) => (s.w === window.innerWidth && s.h === window.innerHeight ? s : { w: window.innerWidth, h: window.innerHeight }));
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return size;
}

/**
 * Tela cheia no primeiro toque, clique ou tecla do controle (o navegador exige um gesto). Só com o
 * Apareça no ar (active): sem ele, o telão da Comunidade fica como era (o toque só liga o som).
 */
export function useFullscreenOnFirstTouch(active = true) {
  useEffect(() => {
    if (!active) return;
    const evs = ["pointerup", "touchend", "keydown"] as const;
    const go = () => {
      const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
      const d = document as Document & { webkitFullscreenElement?: Element | null };
      if (!(document.fullscreenElement ?? d.webkitFullscreenElement)) {
        try {
          if (el.requestFullscreen) void el.requestFullscreen().catch(() => {});
          else el.webkitRequestFullscreen?.();
        } catch {}
      }
      evs.forEach((e) => window.removeEventListener(e, go));
    };
    evs.forEach((e) => window.addEventListener(e, go, { passive: true }));
    return () => evs.forEach((e) => window.removeEventListener(e, go));
  }, [active]);
}

type StageProps = {
  slug: string;
  paused: boolean;
  plain: boolean;
  houseName: string;
  houseLogo: string | null;
  qrSvg: string;
};

export function AparecaStage({ slug, paused, plain, houseName, houseLogo, qrSvg }: StageProps) {
  const { program, logo, failures, stream } = useProgram(slug);
  useFullscreenOnFirstTouch(program !== null);
  const online = useOnline();
  const offline = !online || failures >= OFFLINE_AFTER;
  const [view, setView] = useState<StageView>(EMPTY_VIEW);
  const [engine] = useState(
    () =>
      new StageEngine({
        render: setView,
        houseSrc: (playback, base) => houseSrc(playback, (id) => muxMp4(id, base)),
        report: (body) => {
          // Sem rede: descarta (não junta "tocou" para mandar em rajada depois).
          const secret = readSecret(slug);
          if (!secret || navigator.onLine === false) return;
          void fetch(PLAY_PATH(slug), {
            method: "POST",
            headers: { "x-telao": secret, "content-type": "application/json" },
            body: JSON.stringify(body),
            cache: "no-store",
            keepalive: true,
          }).catch(() => {});
        },
      }),
  );

  useEffect(() => {
    engine.start();
    return () => engine.stop();
  }, [engine]);
  useEffect(() => engine.setOffline(offline), [engine, offline]);
  useEffect(() => engine.setStream(stream), [engine, stream]);
  useEffect(() => engine.setProgram(program), [engine, program]);
  useEffect(() => engine.setPaused(paused), [engine, paused]);

  // Institucionais no cache local: a cada lista nova (não a cada consulta de 5 s).
  // A base entra na chave: as chaves do cache são as URLs completas.
  const houseKey = program ? `${stream}|${program.house.map((h) => h.playback).join(",")}` : null;
  useEffect(() => {
    if (houseKey === null || !program) return;
    void cacheHouse(program.house, (id) => muxMp4(id, stream));
    // program entra pela houseKey: só a lista de institucionais importa aqui.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseKey]);

  const { w, h } = useViewport();
  const layout = useMemo(() => stageLayout(w, h), [w, h]);
  const clipStyle = useMemo<CSSProperties>(() => {
    const W = w || 1280;
    const H = h || 720;
    return { width: `${(layout.clip.w / W) * 100}%`, height: `${(layout.clip.h / H) * 100}%` };
  }, [layout, w, h]);
  const vars = {
    "--apt-name": `calc(var(--u) * ${NAME_U})`,
    "--apt-qr": `calc(var(--u) * ${QR_U})`,
    "--apt-logo": `calc(var(--u) * ${LOGO_U})`,
  } as CSSProperties;

  return (
    <div
      className={`apt apt-${layout.orientation === "landscape" ? "land" : "port"}${view.on ? " on" : ""}${plain ? " apt-plain" : ""}`}
      style={vars}
      aria-hidden={!view.on}
    >
      {([0, 1] as const).map((i) => (
        <StageSlot
          key={i}
          i={i}
          view={view.slots[i]}
          front={view.front === i}
          shown={view.shown[i]}
          active={view.on && view.front === i}
          plain={plain}
          clipStyle={clipStyle}
          engine={engine}
          logo={logo ?? houseLogo}
          houseName={houseName}
          qrSvg={qrSvg}
        />
      ))}
    </div>
  );
}
