"use client";
/* eslint-disable @next/next/no-img-element -- logo, capa e fotos dos pratos já vêm no tamanho certo */

import {
  Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type SyntheticEvent,
} from "react";
import {
  backoff, clockSkew, clockText, houseHighlight, leaderOf, localTime, pollChime, pollTiming, questionText, TV_POLL_MS, tvMode,
  tvQuestionLong, tvReloadDue,
} from "@/lib/comunidade/client-logic";
import { ct, ctf, type CmuKey } from "@/lib/comunidade/i18n";
import { sha256Hex } from "@/lib/comunidade/sha256";
import type { PublicPoll, PublicState } from "@/lib/comunidade/types";
import { thumbSrc } from "@/lib/menu/media";
import type { MenuItem, PublicMenu } from "@/lib/menu/types";
import { useClock } from "../comunidade/parts";

// Telão da Comunidade (ficha: telas 17 a 20). Palco 1280×720 escalado para a tela da TV.
// - Pareamento sem token trafegando: a TV gera um segredo de 32 bytes (localStorage
//   tl-secret:<slug>), pede um código mandando só o SHA-256 dele (JS puro: em http://<IP>
//   não há crypto.subtle) e prova quem é pelo cabeçalho x-telao. Esperando o painel, consulta
//   o estado a cada 5 s; pareada, a cada 5 min. 401 apaga o segredo e volta ao código; 404
//   (Comunidade desligada) não apaga.
// - Dados: a mesma leitura pública da CDN dos celulares, a cada 4 s; em erro, tenta de novo
//   em 4, 8, 16 e 30 s, com "reconectando…" discreto e o último estado congelado.
// - Só porcentagem, nunca contagem. Logo, @ e QR sempre visíveis (menos na tela de parear).
// - Wake lock pedido de novo ao voltar a aba; recarrega sozinha a cada 3 h sem enquete
//   aberta; .tl-plain (sem desfoque nem luzes) em navegador fraco; som só depois de um toque.

const W = 1280;
const H = 720;
const PAIR_POLL_MS = 5_000;
const PAIRED_CHECK_MS = 5 * 60_000;
const RETRY_LATER_MS = 60_000; // desligada ou muitos códigos pedidos
const OFF_RELOAD_MS = 5 * 60_000; // tela "desligada": confere de novo se ligaram
const CAROUSEL_MS = 6_000;
const CAROUSEL_MAX = 8;
const RELOAD_CHECK_MS = 60_000;
const HEX64 = /^[0-9a-f]{64}$/;
const CODE = /^[A-Z2-9]{6}$/;
// Nome da parte do painel, que só existe em português.
const PANEL_SECTION = "Comunidade";

export type TvHouse = {
  name: string;
  instagram: string | null;
  logo: string | null;
  cover: string | null;
  accent: string | null;
  timezone: string;
};
type Props = { slug: string; lang: string } & ({ enabled: false } | { enabled: true; house: TvHouse; qrSvg: string; qrLink: string; menu: PublicMenu });

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

// 32 bytes aleatórios em hex. getRandomValues existe também fora de HTTPS.
function newSecret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Foto que não carregou (arquivo apagado, link antigo) some em vez de deixar um buraco na TV.
const hideBroken = (e: SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.style.display = "none";
};

const isState = (s: unknown): s is PublicState =>
  !!s && typeof s === "object" && typeof (s as PublicState).enabled === "boolean" && typeof (s as PublicState).v === "string";

export function TelaoApp(p: Props) {
  if (!p.enabled) return <OffScreen lang={p.lang} reload />;
  return <LiveTelao slug={p.slug} lang={p.lang} house={p.house} qrSvg={p.qrSvg} qrLink={p.qrLink} menu={p.menu} />;
}

// ---------- Palco 1280×720 escalado ----------

function Screen({ className = "", style, lang, children }: { className?: string; style?: CSSProperties; lang: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => el.style.setProperty("--tl-k", String(Math.min(window.innerWidth / W, window.innerHeight / H)));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <div className={`tl ${className}`} style={style} lang={lang}>
      <div className="tl-stage" ref={ref}>
        {children}
      </div>
    </div>
  );
}

// Navegador fraco (sem backdrop-filter, sem @property ou sem wake lock): fundo sólido, sem
// desfoque nem luzes. ?debug=1 mostra o v do estado, as falhas seguidas e o link do QR.
function useEnv() {
  const [env, setEnv] = useState({ plain: false, debug: false });
  useEffect(() => {
    const css = typeof CSS !== "undefined" && typeof CSS.supports === "function";
    const plain = !css || !CSS.supports("backdrop-filter", "blur(1px)") || !("registerProperty" in CSS) || !("wakeLock" in navigator);
    const debug = new URLSearchParams(location.search).get("debug") === "1";
    queueMicrotask(() => setEnv({ plain, debug }));
  }, []);
  return env;
}

// ---------- Pareamento ----------

type Phase = "boot" | "pair" | "live" | "off";
type PairView = { phase: Phase; code: string | null; busy: boolean };
type Estado = "paired" | "pending" | 401 | 404 | "error";
type Codigo = { code: string; exp: number } | "too_many" | "off" | "invalid" | "error";

function usePairing(slug: string): PairView {
  const [view, setView] = useState<PairView>({ phase: "boot", code: null, busy: false });
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const key = `tl-secret:${slug}`;
    const saved = store.get(key);
    // known: este segredo já pediu código antes (pode estar pareado). Um segredo novo vai
    // direto pedir o código, sem gastar um 401.
    let known = !!saved && HEX64.test(saved);
    let secret = known ? (saved as string) : newSecret();
    if (!known) store.set(key, secret);
    let code: { code: string; exp: number } | null = null;
    let live = false;

    const show = (v: PairView) => {
      if (alive) setView(v);
    };
    const later = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => void step(), ms);
    };
    // 401: o segredo não vale mais aqui (revogado ou apagado). Gera outro e pede código.
    const forget = () => {
      secret = newSecret();
      store.set(key, secret);
      known = false;
      code = null;
      live = false;
    };

    const estado = async (): Promise<Estado> => {
      try {
        const r = await fetch(`/api/comunidade/${slug}/telao/estado`, { method: "POST", headers: { "x-telao": secret }, cache: "no-store" });
        if (r.status === 401 || r.status === 404) return r.status;
        if (!r.ok) return "error";
        const j: unknown = await r.json();
        if (!j || typeof j !== "object" || (j as { ok?: unknown }).ok !== true) return "error";
        return (j as { paired?: unknown }).paired === true ? "paired" : "pending";
      } catch {
        return "error";
      }
    };
    const codigo = async (): Promise<Codigo> => {
      try {
        const r = await fetch(`/api/comunidade/${slug}/telao/codigo`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hash: sha256Hex(secret) }),
          cache: "no-store",
        });
        if (r.status === 429) return "too_many";
        if (r.status === 403 || r.status === 404) return "off";
        if (r.status === 400) return "invalid";
        const j = (await r.json().catch(() => null)) as { ok?: unknown; code?: unknown; expires_at?: unknown } | null;
        if (!r.ok || j?.ok !== true || typeof j.code !== "string" || !CODE.test(j.code)) return "error";
        // Prazo pelo relógio do servidor (cabeçalho Date): a TV pode estar com a hora errada.
        const exp = typeof j.expires_at === "string" ? Date.parse(j.expires_at) : NaN;
        const srv = Date.parse(r.headers.get("date") ?? "");
        const left = Number.isFinite(exp) ? exp - (Number.isFinite(srv) ? srv : Date.now()) : 10 * 60_000;
        return { code: j.code, exp: Date.now() + left };
      } catch {
        return "error";
      }
    };

    async function step() {
      if (!alive) return;
      if (known) {
        const st = await estado();
        if (!alive) return;
        if (st === "paired") {
          live = true;
          code = null;
          show({ phase: "live", code: null, busy: false });
          return later(PAIRED_CHECK_MS);
        }
        // Desligada (ou slug sumiu): guarda o segredo e confere de novo depois.
        if (st === 404) {
          if (!live) show({ phase: "off", code: null, busy: false });
          return later(live ? PAIRED_CHECK_MS : RETRY_LATER_MS);
        }
        if (st === "error") return later(live ? PAIRED_CHECK_MS : PAIR_POLL_MS);
        if (st === 401) forget();
      }
      // Sem pareamento: o código na tela (o mesmo enquanto vale; outro quando vence).
      if (!code || Date.now() >= code.exp - 2_000) {
        const c = await codigo();
        if (!alive) return;
        if (c === "too_many") {
          code = null;
          show({ phase: "pair", code: null, busy: true });
          return later(RETRY_LATER_MS);
        }
        if (c === "off") {
          show({ phase: "off", code: null, busy: false });
          return later(RETRY_LATER_MS);
        }
        if (c === "invalid") {
          forget(); // hash recusado (segredo revogado): outro segredo
          return later(PAIR_POLL_MS);
        }
        if (c === "error") return later(PAIR_POLL_MS);
        code = c;
        known = true;
      }
      show({ phase: "pair", code: code.code, busy: false });
      later(PAIR_POLL_MS);
    }

    void step();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [slug]);
  return view;
}

// ---------- Dados (leitura pública da CDN) ----------

type TvData = { state: PublicState; skew: number };

function useTvData(slug: string, active: boolean) {
  const [data, setData] = useState<TvData | null>(null);
  const [failures, setFailures] = useState(0);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    let busy = false;
    let fails = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => void tick(), ms);
    };
    async function tick() {
      clearTimeout(timer);
      // Aba escondida: para; volta no visibilitychange.
      if (!alive || busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const r = await fetch(`/api/comunidade/${slug}`);
        if (r.status === 404) {
          fails = 0;
          if (alive) {
            setGone(true);
            setData(null);
          }
        } else {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const s: unknown = await r.json();
          if (!isState(s)) throw new Error("estado inválido");
          fails = 0;
          if (alive) {
            setGone(false);
            setData({ state: s, skew: clockSkew(s.now, Date.now()) });
          }
        }
      } catch {
        fails += 1; // mantém o último estado
      } finally {
        busy = false;
      }
      if (!alive) return;
      setFailures(fails);
      schedule(fails ? backoff(fails - 1) : TV_POLL_MS);
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
  }, [slug, active]);
  return { data, failures, gone };
}

// ---------- Tela, wake lock, recarga e som ----------

function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let alive = true;
    const ask = async () => {
      if (!("wakeLock" in navigator) || document.visibilityState !== "visible" || (lock && !lock.released)) return;
      try {
        const l = await navigator.wakeLock.request("screen");
        if (alive) lock = l;
        else void l.release().catch(() => {});
      } catch {}
    };
    const onVisible = () => void ask();
    document.addEventListener("visibilitychange", onVisible);
    void ask();
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);
}

// Sinal curto (dois tons) com Web Audio, sem arquivo.
function chime(ctx: AudioContext) {
  const t = ctx.currentTime;
  [
    [880, 0],
    [1320, 0.16],
  ].forEach(([f, at]) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + at);
    g.gain.exponentialRampToValueAtTime(0.25, t + at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.32);
    o.connect(g).connect(ctx.destination);
    o.start(t + at);
    o.stop(t + at + 0.36);
  });
}

// ---------- Telão ----------

function LiveTelao({ slug, lang, house, qrSvg, qrLink, menu }: { slug: string; lang: string; house: TvHouse; qrSvg: string; qrLink: string; menu: PublicMenu }) {
  const env = useEnv();
  const pair = usePairing(slug);
  const { data, failures, gone } = useTvData(slug, pair.phase === "live");
  useWakeLock();

  const state = data?.state ?? null;
  const paused = failures > 0;
  const mode = gone ? "off" : state ? tvMode(state) : "wait";
  const poll = mode === "poll" ? state!.poll : null;
  const pollOpen = !!poll && !poll.closed;

  // Recarrega a cada 3 h sem enquete aberta, e só com a rede no ar (senão a TV fica na
  // página de erro do navegador).
  const loadedAt = useRef(0);
  const live = useRef({ pollOpen, paused });
  useEffect(() => {
    live.current = { pollOpen, paused };
  }, [pollOpen, paused]);
  useEffect(() => {
    loadedAt.current = Date.now();
    const id = setInterval(() => {
      const l = live.current;
      if (!l.paused && navigator.onLine && tvReloadDue(loadedAt.current, Date.now(), l.pollOpen)) location.reload();
    }, RELOAD_CHECK_MS);
    return () => clearInterval(id);
  }, []);

  // Som: liga com um toque (o navegador exige) e toca quando abre uma enquete nova.
  const [sound, setSound] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const lastOpen = useRef<string | null | undefined>(undefined);
  const pollKey = state ? `${state.enabled}|${state.poll?.id ?? ""}|${state.poll?.closed ?? ""}` : "";
  useEffect(() => {
    if (!state) return;
    const r = pollChime(lastOpen.current, state);
    lastOpen.current = r.open;
    if (r.chime && audio.current) chime(audio.current);
    // state entra pelo pollKey: só a enquete importa aqui, não cada leitura de 4 s.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollKey]);
  const toggleSound = () => {
    if (sound) {
      void audio.current?.close().catch(() => {});
      audio.current = null;
      setSound(false);
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      void ctx.resume().catch(() => {});
      audio.current = ctx;
      chime(ctx); // confirma que o som saiu
      setSound(true);
    } catch {}
  };

  const style = (house.accent ? { "--accent": house.accent } : undefined) as CSSProperties | undefined;
  const cls = env.plain ? "tl-plain" : "";
  // O @ vem da leitura ao vivo (a casa pode trocar com a TV ligada); antes dela, o da página.
  const instagram = (state ? state.instagram : house.instagram)?.replace(/^@+/, "") || null;

  if (pair.phase === "off" || mode === "off") return <OffScreen lang={lang} style={style} plain={env.plain} />;
  if (pair.phase === "boot") return <Waiting lang={lang} style={style} className={cls} />;
  if (pair.phase === "pair") return <PairScreen lang={lang} code={pair.code} busy={pair.busy} style={style} className={cls} />;

  return (
    <Screen className={`${cls}${paused ? " rec" : ""}`} style={style} lang={lang}>
      {!env.plain && house.cover && <div className="tl-bg" style={{ backgroundImage: `url("${house.cover.replace(/"/g, "%22")}")` }} />}
      <div className="tl-wash" />
      {!env.plain && (
        <>
          <i className="tl-beam" style={{ left: 60 }} />
          <i className="tl-beam b2" style={{ left: 420 }} />
        </>
      )}

      <header className="tl-brand">
        {house.logo ? <img src={house.logo} alt="" /> : <span className="tl-logo-l" aria-hidden>{house.name.slice(0, 1)}</span>}
        <div>
          <b>{house.name}</b>
          {instagram && <span>@{instagram}</span>}
        </div>
        {paused && (
          <span className="tl-rec" role="status">
            <i className="tl-spin" />
            {ct("tvReconnecting", lang)}
          </span>
        )}
      </header>

      {state && mode === "poll" && poll && (
        <PollPanel key={poll.id} poll={poll} lang={lang} menu={menu} seed={Date.parse(state.now)} skew={data!.skew} paused={paused} />
      )}
      {state && mode === "idle" && <IdlePanel state={state} lang={lang} menu={menu} house={house} paused={paused} />}

      {pollOpen && (
        <p className="tl-vote">
          <IconQr />
          {ct("tvVoteA", lang)} <b>{ct("tvVoteB", lang)}</b>
        </p>
      )}

      <aside className="tl-qr">
        <div className="tl-qrp" role="img" aria-label={`QR: /${slug}?ref=telao`} dangerouslySetInnerHTML={{ __html: qrSvg }} />
        <b>{ct("tvPoint", lang)}</b>
        <span>{ct(pollOpen ? "tvSeeResult" : "tvSeeMenu", lang)}</span>
        {pollOpen ? (
          <p className="tl-steps">{ct("tvVoteSteps", lang)}</p>
        ) : state?.next ? (
          <p className="tl-steps">{ctf("tvNextAt", lang, { t: localTime(state.next.starts_at, house.timezone, lang) })}</p>
        ) : null}
      </aside>

      <button className={`tl-sound${sound ? " on" : ""}`} onClick={toggleSound}>
        <IconSound on={sound} />
        {ct(sound ? "tvSoundIsOn" : "tvSoundOn", lang)}
      </button>
      {env.debug && (
        <small className="tl-debug">
          v {state?.v ?? "—"} · {failures} {failures === 1 ? "falha" : "falhas"} · {qrLink}
        </small>
      )}
    </Screen>
  );
}

// ---------- Enquete ----------

function useItems(menu: PublicMenu) {
  return useMemo(() => {
    const m = new Map<string, MenuItem>();
    for (const c of menu.categories) for (const i of c.items) if (!m.has(i.id)) m.set(i.id, i);
    return m;
  }, [menu]);
}

// Pergunta longa (.long, 46 px) quando ela passa de uma linha a 62 px. Mede um fantasma
// invisível com a mesma largura, sempre a 62 px, para a medida não depender da própria
// .long. useLayoutEffect decide antes da primeira pintura; o ResizeObserver mede de novo
// quando a fonte do título termina de carregar e a quebra muda.
function useLongQuestion(q: string) {
  const ghost = useRef<HTMLSpanElement>(null);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const el = ghost.current;
    if (!el) return;
    const check = () => setLong(tvQuestionLong(el.offsetHeight, parseFloat(getComputedStyle(el).fontSize)));
    check();
    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(check);
      ro.observe(el);
      return () => ro.disconnect();
    }
    // TV sem ResizeObserver: confere de novo quando as fontes terminarem de carregar.
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) check();
    });
    return () => {
      alive = false;
    };
  }, [q]);
  return { ghost, long };
}

function PollPanel({ poll, lang, menu, seed, skew, paused }: { poll: PublicPoll; lang: string; menu: PublicMenu; seed: number; skew: number; paused: boolean }) {
  const items = useItems(menu);
  // O relógio anda por segundo só com a enquete aberta e a rede no ar (reconectando, congela).
  const now = useClock(!poll.closed && !paused, seed, skew);
  const timing = pollTiming(poll, now);
  const pcts = Object.fromEntries(poll.options.map((o) => [o.id, o.pct]));
  const lead = poll.closed ? (poll.winner ?? leaderOf(pcts)) : leaderOf(pcts);
  const q = questionText(poll, lang);
  const { ghost, long } = useLongQuestion(q);
  const tag: CmuKey = poll.closed ? "tvClosed" : paused ? "tvPaused" : "tvLive";

  // As barras nascem em 0 e crescem até o valor (duas pinturas: a transição precisa do 0).
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setGrown(true));
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, []);

  return (
    <section className="tl-poll" aria-label={ct("housePoll", lang)}>
      <div className="tl-ph">
        <span className="tl-lb">
          {!poll.closed && !paused && <i className="tl-live" aria-hidden />}
          {ct("housePoll", lang)} · {ct(tag, lang)}
        </span>
        {!poll.closed && (
          <span className="tl-tm">
            {ct("closesIn", lang)} <b>{clockText(timing.left)}</b>
            <span className="tl-tmr" style={{ "--tl-ring": `${timing.angle}deg` } as CSSProperties} aria-hidden>
              <i />
            </span>
          </span>
        )}
      </div>
      <h2 className={long ? "long" : undefined}>{q}</h2>
      <span className="tl-qm" ref={ghost} aria-hidden>
        {q}
      </span>
      <div className="tl-bars">
        {poll.options.map((o) => {
          const item = o.item_id ? items.get(o.item_id) : undefined;
          const th = item ? thumbSrc(item) : null;
          const pct = grown ? o.pct : 0;
          return (
            <div key={o.id} className={`tl-bar${lead === o.id ? " lead" : ""}`}>
              <i className="tl-fill" style={{ transform: `scaleX(${pct / 100})` }} />
              {th && <img className="tl-em" src={th} alt="" onError={hideBroken} />}
              <b>{item?.name ?? o.label}</b>
              <Pct value={pct} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Porcentagem que sobe até o valor em 0,7 s (direto no valor com "reduzir movimento").
function Pct({ value }: { value: number }) {
  const el = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const from = shown.current;
    shown.current = value;
    if (from === value || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      node.textContent = `${value}%`;
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 700);
      node.textContent = `${Math.round(from + (value - from) * (1 - Math.pow(1 - k, 3)))}%`;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <span className="tl-pc" ref={el}>
      0%
    </span>
  );
}

// ---------- Sem enquete: fotos da casa, destaque e a próxima ----------

function IdlePanel({ state, lang, menu, house, paused }: { state: PublicState; lang: string; menu: PublicMenu; house: TvHouse; paused: boolean }) {
  const items = useItems(menu);
  const minute = Math.floor(Date.parse(state.now) / 60_000);
  const highlight = useMemo(() => houseHighlight(menu, new Date(minute * 60_000)), [menu, minute]);
  const hlThumb = highlight ? thumbSrc(highlight) : null;

  // Só as fotos que a casa marcou para o telão (o prato, sem pessoas). Sem nenhuma, a foto do
  // destaque da casa.
  const slides = useMemo(() => {
    const own = state.mural
      .filter((p) => p.on_tv)
      .slice(0, CAROUSEL_MAX)
      .map((p) => ({ key: p.id, src: p.photo, name: items.get(p.item_id)?.name ?? "", house: true }));
    if (own.length) return own;
    return highlight && hlThumb ? [{ key: `hl-${highlight.id}`, src: hlThumb, name: highlight.name, house: false }] : [];
  }, [state.mural, items, highlight, hlThumb]);

  const [idx, setIdx] = useState(0);
  const count = slides.length;
  useEffect(() => {
    if (count < 2 || paused) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % count), CAROUSEL_MS);
    return () => clearInterval(id);
  }, [count, paused]);
  const cur = count ? idx % count : 0;
  const next = state.next;

  return (
    <section className="tl-idle">
      {count > 0 && (
        <div className="tl-car">
          {slides.map((s, i) => (
            <img key={s.key} className={i === cur ? "on" : undefined} src={s.src} alt="" />
          ))}
          <span className="tl-ctag">
            {house.logo && <img src={house.logo} alt="" onError={hideBroken} />}
            {ct(slides[cur].house ? "tvHousePhoto" : "highlightLower", lang)}
          </span>
          {slides[cur].name && <span className="tl-cname">{slides[cur].name}</span>}
        </div>
      )}
      {(highlight || next) && (
        <div className={`tl-row${highlight && next ? "" : " one"}`}>
          {highlight && (
            <div className="tl-card">
              {hlThumb && <img src={hlThumb} alt="" onError={hideBroken} />}
              <div>
                <small>
                  <i>★</i> {ct("highlightTitle", lang)}
                </small>
                <b>{highlight.name}</b>
              </div>
            </div>
          )}
          {next && (
            <div className="tl-card">
              <IconClock />
              <div>
                <small>{ct("tvNext", lang)}</small>
                <b>{ctf("tvAt", lang, { t: localTime(next.starts_at, house.timezone, lang) })}</b>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ---------- Telas sem dados ----------

function PairScreen({ lang, code, busy, style, className }: { lang: string; code: string | null; busy: boolean; style?: CSSProperties; className: string }) {
  const chars = (code ?? "······").split("");
  const [before, after] = ct("tvPairHelp", lang).split("{c}");
  return (
    <Screen className={className} style={style} lang={lang}>
      <section className="tl-pair">
        <div className="tl-in">
          <small>{ct("tvPairKicker", lang)}</small>
          <h2>{ct("tvPairTitle", lang)}</h2>
          <div className={`tl-code${code ? "" : " empty"}`} aria-label={code ?? undefined} role={code ? "img" : undefined}>
            {chars.map((c, i) => (
              <Fragment key={i}>
                {i === 3 && <i className="tl-gap" aria-hidden />}
                <i aria-hidden>{c}</i>
              </Fragment>
            ))}
          </div>
          <p>
            {before}
            <b>{PANEL_SECTION}</b>
            {after}
          </p>
          <span className="tl-wait" role="status">
            <i className="tl-spin" />
            {ct(busy ? "tvPairBusy" : "tvPairWait", lang)}
          </span>
        </div>
      </section>
    </Screen>
  );
}

function Waiting({ lang, style, className }: { lang: string; style?: CSSProperties; className: string }) {
  return (
    <Screen className={className} style={style} lang={lang}>
      <section className="tl-pair">
        <span className="tl-wait" role="status">
          <i className="tl-spin" />
          {ct("tvConnecting", lang)}
        </span>
      </section>
    </Screen>
  );
}

// Comunidade desligada: nada dela na tela. Aberta com a Comunidade já desligada, a página
// confere de novo a cada 5 min (com a rede no ar), para voltar sozinha quando a casa ligar.
function OffScreen({ lang, reload, style, plain }: { lang: string; reload?: boolean; style?: CSSProperties; plain?: boolean }) {
  useEffect(() => {
    if (!reload) return;
    const id = setInterval(() => {
      if (navigator.onLine) location.reload();
    }, OFF_RELOAD_MS);
    return () => clearInterval(id);
  }, [reload]);
  return (
    <Screen className={plain ? "tl-plain" : ""} style={style} lang={lang}>
      <section className="tl-pair">
        <div className="tl-in">
          <small>{ct("tvPairKicker", lang)}</small>
          <h2>{ct("tvOff", lang)}</h2>
          <p>{ct("tvOffSub", lang)}</p>
        </div>
      </section>
    </Screen>
  );
}

// ---------- Ícones ----------

const IconQr = () => (
  <svg className="tl-icon" viewBox="0 0 24 24" aria-hidden>
    <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" />
    <path d="M14 14h2v2h-2zM18 14h2M14 18v2M18 18h2v2" />
  </svg>
);
const IconClock = () => (
  <svg className="tl-icon" viewBox="0 0 24 24" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
const IconSound = ({ on }: { on: boolean }) => (
  <svg className="tl-icon" viewBox="0 0 24 24" aria-hidden>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    {on ? <path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11" /> : <path d="M16 9.5l5 5M21 9.5l-5 5" />}
  </svg>
);
