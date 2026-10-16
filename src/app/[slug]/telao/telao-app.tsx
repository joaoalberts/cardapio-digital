"use client";
/* eslint-disable @next/next/no-img-element -- logo e fotos dos pratos já vêm no tamanho certo */

import {
  Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type SyntheticEvent,
} from "react";
import {
  backoff, clockSkew, houseHighlight, localTime, PAIR_RENEW_GRACE_MS, pairCodeDue, pairCodeRecord, pollChime, pollOutcome,
  pollTiming, priceInfo, questionText, ringText, savedPairCode, soleLeader, TV_POLL_MS, tvAccent, tvFeatSlides, tvLongQuestion,
  tvOrder, tvReloadDue, tvScreen, tvSlow, type SavedPairCode, type TvScreen, type TvSlide,
} from "@/lib/comunidade/client-logic";
import { ct, ctf } from "@/lib/comunidade/i18n";
import { sha256Hex } from "@/lib/comunidade/sha256";
import type { OptionId, PublicPoll, PublicState } from "@/lib/comunidade/types";
import { thumbSrc } from "@/lib/menu/media";
import type { MenuItem, PublicMenu } from "@/lib/menu/types";
import { priceText, useClock } from "../comunidade/parts";

// Telão da Comunidade, versão recomendada v2 (ficha: telas 18 a 37). Pôster vivo que se
// adapta a qualquer TV (unidade --u em telao.css): a líder sempre em primeiro com a foto dela
// grande, "Deu X" por 45 s quando a enquete fecha, o destaque da casa sem enquete.
// - Pareamento sem token trafegando: a TV gera um segredo de 32 bytes (localStorage
//   tl-secret:<slug>), pede um código mandando só o SHA-256 dele (JS puro: em http://<IP>
//   não há crypto.subtle) e prova quem é pelo cabeçalho x-telao. Esperando o painel, consulta
//   o estado a cada 5 s; pareada, a cada 5 min (e recebe o modo simples do painel). 401 apaga
//   o segredo e volta ao código; 404 (Comunidade desligada) não apaga. O código fica guardado
//   (tl-code:<slug>) e volta igual na recarga; só se pede outro depois que ele vence.
// - Dados: a mesma leitura pública da CDN dos celulares, a cada 4 s; em erro, tenta de novo
//   em 4, 8, 16 e 30 s, com "reconectando…" e o último estado congelado.
// - Só porcentagem, nunca contagem. Logo, @ e QR sempre visíveis (menos na tela de parear).
// - Modo simples (.tl-plain, sem animação): ?simples=1, o interruptor do painel, ou sozinho se
//   a TV passar de 24 ms por quadro nos primeiros 2 s.
// - Wake lock pedido de novo ao voltar a aba; recarrega sozinha a cada 3 h sem enquete
//   aberta; som só depois de um toque.

const PAIR_POLL_MS = 5_000;
const PAIRED_CHECK_MS = 5 * 60_000;
const RETRY_LATER_MS = 60_000; // desligada ou muitos códigos pedidos
const OFF_RELOAD_MS = 5 * 60_000; // tela "desligada": confere de novo se ligaram
const SLIDE_MS = 8_000;
const RELOAD_CHECK_MS = 60_000;
const SLOW_PROBE_MS = 2_000;
const SOUND_SHOW_MS = 6_000;
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
  fontTheme: string;
  ordersEnabled: boolean;
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
  del(k: string) {
    try {
      localStorage.removeItem(k);
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

// ?simples=1 liga o modo simples; ?debug=1 mostra o v do estado, as falhas e o link do QR.
function useEnv() {
  const [env, setEnv] = useState({ simple: false, debug: false });
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const next = { simple: q.get("simples") === "1", debug: q.get("debug") === "1" };
    queueMicrotask(() => setEnv(next));
  }, []);
  return env;
}

// Modo simples automático: conta os quadros dos primeiros 2 s com a tela no ar.
function useSlowTv(active: boolean) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active || typeof requestAnimationFrame !== "function") return;
    let frames = 0;
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      frames += 1;
      if (t - t0 < SLOW_PROBE_MS) raf = requestAnimationFrame(step);
      else if (tvSlow(frames, t - t0)) setSlow(true);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return slow;
}

// ---------- Pareamento ----------

type Phase = "boot" | "pair" | "live" | "off";
type PairView = { phase: Phase; code: string | null; busy: boolean; simple: boolean };
type Estado = { kind: "paired"; simple: boolean } | { kind: "pending" } | { kind: 401 } | { kind: 404 } | { kind: "error" };
type Codigo = { code: string; exp: number } | "too_many" | "off" | "invalid" | "error";

function usePairing(slug: string): PairView {
  const [view, setView] = useState<PairView>({ phase: "boot", code: null, busy: false, simple: false });
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const key = `tl-secret:${slug}`;
    const codeKey = `tl-code:${slug}`;
    const saved = store.get(key);
    // known: este segredo já pediu código antes (pode estar pareado). Um segredo novo vai
    // direto pedir o código, sem gastar um 401.
    let known = !!saved && HEX64.test(saved);
    let secret = known ? (saved as string) : newSecret();
    if (!known) store.set(key, secret);
    let hash = sha256Hex(secret);
    // Código ainda no prazo de antes da recarga (do mesmo segredo): mostra o mesmo.
    let code: SavedPairCode | null = known ? savedPairCode(store.get(codeKey), hash, Date.now()) : null;
    if (!code) store.del(codeKey);
    let live = false;
    let simple = false;

    const show = (v: Omit<PairView, "simple">) => {
      if (alive) setView({ ...v, simple });
    };
    const later = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => void step(), ms);
    };
    // 401: o segredo não vale mais aqui (revogado ou apagado). Gera outro e pede código.
    const forget = () => {
      secret = newSecret();
      store.set(key, secret);
      hash = sha256Hex(secret);
      known = false;
      code = null;
      store.del(codeKey);
      live = false;
    };

    const estado = async (): Promise<Estado> => {
      try {
        const r = await fetch(`/api/comunidade/${slug}/telao/estado`, { method: "POST", headers: { "x-telao": secret }, cache: "no-store" });
        if (r.status === 401) return { kind: 401 };
        if (r.status === 404) return { kind: 404 };
        if (!r.ok) return { kind: "error" };
        const j: unknown = await r.json();
        if (!j || typeof j !== "object" || (j as { ok?: unknown }).ok !== true) return { kind: "error" };
        const o = j as { paired?: unknown; simple?: unknown };
        return o.paired === true ? { kind: "paired", simple: o.simple === true } : { kind: "pending" };
      } catch {
        return { kind: "error" };
      }
    };
    const codigo = async (): Promise<Codigo> => {
      try {
        const r = await fetch(`/api/comunidade/${slug}/telao/codigo`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hash }),
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
        if (st.kind === "paired") {
          live = true;
          simple = st.simple;
          code = null;
          store.del(codeKey);
          show({ phase: "live", code: null, busy: false });
          return later(PAIRED_CHECK_MS);
        }
        // Desligada (ou slug sumiu): guarda o segredo e confere de novo depois.
        if (st.kind === 404) {
          if (!live) show({ phase: "off", code: null, busy: false });
          return later(live ? PAIRED_CHECK_MS : RETRY_LATER_MS);
        }
        if (st.kind === "error") return later(live ? PAIRED_CHECK_MS : PAIR_POLL_MS);
        if (st.kind === 401) forget();
      }
      // Sem pareamento: o código na tela (o mesmo enquanto vale, até na recarga; outro só
      // depois que vence, com 1 s de folga, para o servidor já não devolver o mesmo).
      if (!code || pairCodeDue(code, Date.now())) {
        const c = await codigo();
        if (!alive) return;
        if (c === "too_many") {
          code = null;
          store.del(codeKey);
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
        store.set(codeKey, pairCodeRecord(c, hash));
      }
      show({ phase: "pair", code: code.code, busy: false });
      // Confere o painel a cada 5 s; na virada do prazo, acorda logo depois dele (+ 1 s).
      later(Math.max(250, Math.min(PAIR_POLL_MS, code.exp + PAIR_RENEW_GRACE_MS - Date.now())));
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

// closedSeen: quando esta TV viu a enquete atual fechada pela primeira vez (relógio do
// servidor), para o "Deu X" contar os 45 s mesmo quando o painel fecha antes da hora.
type TvData = { state: PublicState; skew: number; closedSeen: number | null };

function useTvData(slug: string, active: boolean) {
  const [data, setData] = useState<TvData | null>(null);
  const [failures, setFailures] = useState(0);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    let busy = false;
    let fails = 0;
    let seen: { id: string; at: number } | null = null;
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
          const skew = clockSkew(s.now, Date.now());
          if (s.poll?.closed) {
            if (seen?.id !== s.poll.id) seen = { id: s.poll.id, at: Date.now() + skew };
          } else seen = null;
          if (alive) {
            setGone(false);
            setData({ state: s, skew, closedSeen: seen?.at ?? null });
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

// ---------- Tela, wake lock e som ----------

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

// O botão de som só aparece quando alguém mexe (controle, mouse ou toque).
function useNudged() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const nudge = () => {
      setShown(true);
      clearTimeout(timer);
      timer = setTimeout(() => setShown(false), SOUND_SHOW_MS);
    };
    const evs = ["pointermove", "pointerdown", "keydown", "touchstart"] as const;
    evs.forEach((e) => window.addEventListener(e, nudge, { passive: true }));
    return () => {
      clearTimeout(timer);
      evs.forEach((e) => window.removeEventListener(e, nudge));
    };
  }, []);
  return shown;
}

// ---------- Telão ----------

type Photo = { key: string; src: string };

function LiveTelao({ slug, lang, house, qrSvg, qrLink, menu }: { slug: string; lang: string; house: TvHouse; qrSvg: string; qrLink: string; menu: PublicMenu }) {
  const env = useEnv();
  const pair = usePairing(slug);
  const { data, failures, gone } = useTvData(slug, pair.phase === "live");
  const slow = useSlowTv(pair.phase === "live");
  useWakeLock();
  const nudged = useNudged();

  const state = data?.state ?? null;
  const paused = failures > 0;
  // Relógio do servidor que anda por segundo (anel do tempo e o fim dos 45 s do "Deu").
  const now = useClock(!!state && !paused, state ? Date.parse(state.now) : 0, data?.skew ?? 0);
  const screen: TvScreen | "wait" = gone ? "off" : state ? tvScreen(state, data!.closedSeen, now) : "wait";
  const poll = state?.poll ?? null;
  const pollOpen = screen === "poll";

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

  const plain = env.simple || pair.simple || slow;
  const accent = useMemo(() => tvAccent(house.accent) as CSSProperties, [house.accent]);
  // O @ vem da leitura ao vivo (a casa pode trocar com a TV ligada); antes dela, o da página.
  const instagram = (state ? state.instagram : house.instagram)?.replace(/^@+/, "") || null;
  const items = useItems(menu);

  if (pair.phase === "off" || screen === "off") return <OffScreen lang={lang} plain={plain} />;
  if (pair.phase === "boot") return <Waiting lang={lang} plain={plain} />;
  if (pair.phase === "pair") return <PairScreen lang={lang} code={pair.code} busy={pair.busy} plain={plain} />;

  const kind = screen === "wait" ? "feat" : screen;
  return (
    <div className={`tl${plain ? " tl-plain" : ""}`} data-font={house.fontTheme} style={accent} lang={lang}>
      <Poster
        kind={kind}
        state={state}
        poll={poll}
        now={now}
        paused={paused}
        lang={lang}
        house={house}
        instagram={instagram}
        qrSvg={qrSvg}
        slug={slug}
        menu={menu}
        items={items}
        plain={plain}
      />
      <button className={`tl-sound${sound ? " on" : ""}${nudged ? " show" : ""}`} onClick={toggleSound}>
        <IconSound on={sound} />
        {ct(sound ? "tvSoundIsOn" : "tvSoundOn", lang)}
      </button>
      {env.debug && (
        <small className="tl-debug">
          v {state?.v ?? "—"} · {failures} {failures === 1 ? "falha" : "falhas"} · {plain ? "simples" : "normal"} · {qrLink}
        </small>
      )}
    </div>
  );
}

function useItems(menu: PublicMenu) {
  return useMemo(() => {
    const m = new Map<string, MenuItem>();
    for (const c of menu.categories) for (const i of c.items) if (!m.has(i.id)) m.set(i.id, i);
    return m;
  }, [menu]);
}

type PosterProps = {
  kind: "poll" | "win" | "feat";
  state: PublicState | null;
  poll: PublicPoll | null;
  now: number;
  paused: boolean;
  lang: string;
  house: TvHouse;
  instagram: string | null;
  qrSvg: string;
  slug: string;
  menu: PublicMenu;
  items: Map<string, MenuItem>;
  plain: boolean;
};

function Poster(p: PosterProps) {
  const { kind, state, poll, lang, house, items } = p;
  const photoOf = (id: string | null | undefined) => (id ? thumbSrc(items.get(id)) : null);

  // Sem enquete: o destaque da casa e as fotos da casa marcadas para o telão, uma de cada vez.
  const minute = Math.floor(p.now / 60_000);
  const highlight = useMemo(() => houseHighlight(p.menu, new Date(minute * 60_000)), [p.menu, minute]);
  const slides = useMemo(
    () => (kind === "feat" ? tvFeatSlides(state?.mural ?? [], new Set(items.keys()), highlight?.id ?? null) : []),
    [kind, state?.mural, items, highlight],
  );
  const [slideIdx, setSlideIdx] = useState(0);
  const count = slides.length;
  useEffect(() => {
    if (count < 2 || p.paused) return;
    const id = setInterval(() => setSlideIdx((i) => (i + 1) % count), SLIDE_MS);
    return () => clearInterval(id);
  }, [count, p.paused]);
  const slide: TvSlide | null = count ? slides[slideIdx % count] : null;

  // Fotos da coluna da direita (e do fundo): cada opção da enquete, ou cada slide.
  let photos: Photo[] = [];
  let on: string | null = null;
  let order: OptionId[] = [];
  let lead: OptionId | null = null;
  const pcts: Partial<Record<OptionId, number>> = {};
  if (poll && kind !== "feat") {
    for (const o of poll.options) pcts[o.id] = o.pct;
    order = tvOrder(poll.options);
    const outcome = pollOutcome(poll);
    lead = kind === "win" && outcome.kind === "win" ? outcome.id : soleLeader(pcts);
    photos = poll.options.flatMap((o) => {
      const src = photoOf(o.item_id);
      return src ? [{ key: o.id, src }] : [];
    });
    on = lead ?? order[0] ?? null;
  } else {
    photos = slides.flatMap((s) => {
      const src = s.kind === "post" ? s.post.photo : photoOf(s.item_id);
      return src ? [{ key: slideKey(s), src }] : [];
    });
    on = slide ? slideKey(slide) : null;
  }
  if (!photos.some((ph) => ph.key === on)) {
    // A da vez não tem foto (opção que não é prato): a capa da casa.
    if (house.cover) photos = [...photos, { key: "cover", src: house.cover }];
    on = house.cover ? "cover" : null;
  }

  const clockOn = kind === "poll" && !!poll && !p.paused;
  const timing = poll ? pollTiming(poll, p.now) : null;
  const ring = timing ? ringText(timing.left) : null;

  return (
    <div className={`tl-tv k-${kind}${p.paused ? " k-rec" : ""}`}>
      <TinyBg photos={photos} on={on} />
      <header className="tl-mast">
        {house.logo ? (
          <img className="tl-logo" src={house.logo} alt="" />
        ) : (
          <span className="tl-logo fd" aria-hidden>
            {house.name.slice(0, 1)}
          </span>
        )}
        <div className="tl-id">
          <b className="tl-n fd">{house.name}</b>
          {p.instagram && (
            <span className="tl-ig">
              <IconIg />@{p.instagram}
            </span>
          )}
        </div>
        {p.paused ? (
          <span className="tl-rec" role="status">
            <i className="tl-spin" />
            {ct("tvReconnecting", lang)}
          </span>
        ) : clockOn && timing && ring ? (
          <span className="tl-clock" style={{ "--tl-ring": `${timing.angle}deg` } as CSSProperties} aria-label={`${ring.n} ${ring.unit}`}>
            <span>
              <b>{ring.n}</b>
              {ring.unit && <small>{ct(ring.unit === "min" ? "ringMin" : "ringSec", lang)}</small>}
            </span>
          </span>
        ) : null}
      </header>

      <div className="tl-side">
        <div className={`tl-photo${kind === "feat" ? " zoom" : ""}`}>
          {photos.map((ph) => (
            <img key={ph.key} className={ph.key === on ? "on" : undefined} src={ph.src} alt="" onError={hideBroken} />
          ))}
          <span className="tl-streak" />
        </div>
        <aside className="tl-qr">
          <div className="tl-plate" role="img" aria-label={`QR: /${p.slug}?ref=telao`} dangerouslySetInnerHTML={{ __html: p.qrSvg }} />
          <div className="tl-qcap">
            <b className="tl-qa fd">{ct("tvPoint", lang)}</b>
            <span className="tl-qb">{ct("tvQrSub", lang)}</span>
            {p.instagram && (
              <span className="tl-qc">
                <IconIg />
                <span>@{p.instagram}</span>
              </span>
            )}
          </div>
        </aside>
      </div>

      {kind === "poll" && poll && (
        <PollBody key={poll.id} poll={poll} order={order} lead={lead} paused={p.paused} plain={p.plain} lang={lang} items={items} />
      )}
      {kind === "win" && poll && lead && <WinBody key={poll.id} poll={poll} id={lead} lang={lang} items={items} house={house} />}
      {kind === "feat" && (
        <FeatBody key={slide ? slideKey(slide) : "none"} slide={slide} state={state} lang={lang} items={items} house={house} />
      )}
    </div>
  );
}

const slideKey = (s: TvSlide) => (s.kind === "post" ? `post-${s.post.id}` : `hl-${s.item_id}`);

// Fundo: a foto da vez desenhada num canvas de 64×36 e esticada (o navegador suaviza, sem
// filter). Foto de outro domínio deixa o canvas "sujo", o que só impede ler os pixels: para
// mostrar, tanto faz.
function TinyBg({ photos, on }: { photos: Photo[]; on: string | null }) {
  return (
    <div className="tl-bgb" aria-hidden>
      {photos.map((ph) => (
        <TinyCanvas key={ph.key} src={ph.src} on={ph.key === on} />
      ))}
    </div>
  );
}

function TinyCanvas({ src, on }: { src: string; on: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const img = new Image();
    let alive = true;
    img.onload = () => {
      const ctx = alive ? cv.getContext("2d") : null;
      if (!ctx || !img.naturalWidth) return;
      // "cover": recorta a foto na proporção 16:9 do canvas.
      const k = Math.max(cv.width / img.naturalWidth, cv.height / img.naturalHeight);
      const w = cv.width / k;
      const h = cv.height / k;
      ctx.drawImage(img, (img.naturalWidth - w) / 2, (img.naturalHeight - h) / 2, w, h, 0, 0, cv.width, cv.height);
    };
    img.src = src;
    return () => {
      alive = false;
    };
  }, [src]);
  return <canvas ref={ref} width={64} height={36} className={on ? "on" : undefined} />;
}

// ---------- Enquete aberta ----------

function PollBody({
  poll, order, lead, paused, plain, lang, items,
}: { poll: PublicPoll; order: OptionId[]; lead: OptionId | null; paused: boolean; plain: boolean; lang: string; items: Map<string, MenuItem> }) {
  const q = questionText(poll, lang);
  const byId = new Map(poll.options.map((o) => [o.id, o]));

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

  // FLIP: quando a liderança muda, cada barra sai de onde estava e desliza até o lugar novo
  // (só transform, 0,7 s no CSS). No modo simples, vai direto.
  const rows = useRef(new Map<OptionId, HTMLDivElement>());
  const tops = useRef(new Map<OptionId, number>());
  const orderKey = order.join("");
  useLayoutEffect(() => {
    const next = new Map<OptionId, number>();
    for (const [id, el] of rows.current) next.set(id, el.offsetTop);
    const reduce = plain || matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) {
      for (const [id, el] of rows.current) {
        const before = tops.current.get(id);
        const d = before === undefined ? 0 : before - (next.get(id) ?? before);
        if (!d) continue;
        el.style.transition = "none";
        el.style.transform = `translateY(${d}px)`;
        requestAnimationFrame(() => {
          el.style.transition = "";
          el.style.transform = "";
        });
      }
    }
    tops.current = next;
  }, [orderKey, plain]);

  return (
    <section className="tl-body" aria-label={ct("housePoll", lang)}>
      <div className="tl-kick">
        <i className={`tl-dot${paused ? " off" : ""}`} aria-hidden />
        <span>{ct(paused ? "tvPollPaused" : "tvPollLive", lang)}</span>
      </div>
      <h2 className={`tl-q fd${tvLongQuestion(q) ? " long" : ""}`}>{q}</h2>
      <div className="tl-bars">
        {order.map((id) => {
          const o = byId.get(id)!;
          const item = o.item_id ? items.get(o.item_id) : undefined;
          const th = item ? thumbSrc(item) : null;
          const pct = grown ? o.pct : 0;
          return (
            <div
              key={id}
              ref={(el) => {
                if (el) rows.current.set(id, el);
                else rows.current.delete(id);
              }}
              className={`tl-bar${lead === id ? " lead" : ""}${th ? "" : " noimg"}`}
            >
              {th && <img src={th} alt="" onError={hideBroken} />}
              <div className="tl-track">
                <span className="tl-fill" style={{ "--p": pct } as CSSProperties} />
                <span className="tl-nm fd">{item?.name ?? o.label}</span>
                <Pct value={o.pct} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="tl-vote">
        <IconQr />
        <span>
          {ct("tvVoteA", lang)} {ct("tvVoteB", lang)}
        </span>
      </p>
    </section>
  );
}

const Pct = ({ value }: { value: number }) => (
  <span className="tl-pc">
    {value}
    <small>%</small>
  </span>
);

// ---------- Deu na enquete (45 s) ----------

function WinBody({ poll, id, lang, items, house }: { poll: PublicPoll; id: OptionId; lang: string; items: Map<string, MenuItem>; house: TvHouse }) {
  const win = poll.options.find((o) => o.id === id)!;
  const item = win.item_id ? items.get(win.item_id) : undefined;
  const name = item?.name ?? win.label;
  const rest = tvOrder(poll.options)
    .filter((o) => o !== id)
    .map((o) => poll.options.find((x) => x.id === o)!);
  const price = priceText(priceInfo(item), lang);
  return (
    <section className="tl-body tl-enter">
      <div className="tl-kick">
        <span>{ct("tvPollEnded", lang)}</span>
      </div>
      <p className="tl-pq fd">{questionText(poll, lang)}</p>
      <h2 className="tl-q fd">{ctf("won", lang, { name })}</h2>
      <div className="tl-res">
        <span className="tl-big">
          {win.pct}
          <small>%</small>
        </span>
        <span className="tl-rest">
          {rest.map((o) => {
            const it = o.item_id ? items.get(o.item_id) : undefined;
            const th = it ? thumbSrc(it) : null;
            return (
              <span key={o.id}>
                {th && <img src={th} alt="" onError={hideBroken} />}
                {it?.name ?? o.label} <b>{o.pct}%</b>
              </span>
            );
          })}
        </span>
      </div>
      {item && (price || house.ordersEnabled) && (
        <>
          <div className="tl-line" />
          <p className="tl-price">
            {price && <b>{price}</b>}
            {house.ordersEnabled && <span>{ctf("tvOrderThis", lang, { name })}</span>}
          </p>
        </>
      )}
    </section>
  );
}

// ---------- Sem enquete: destaque da casa e fotos da casa ----------

function FeatBody({ slide, state, lang, items, house }: { slide: TvSlide | null; state: PublicState | null; lang: string; items: Map<string, MenuItem>; house: TvHouse }) {
  const item = slide ? items.get(slide.item_id) : undefined;
  const price = priceText(priceInfo(item), lang);
  const next = state?.next ?? null;
  return (
    <section className="tl-body tl-enter">
      {item && (
        <>
          <div className="tl-kick">
            <span>{slide?.kind === "post" ? ct("artKitchen", lang) : `★ ${ct("highlightTitle", lang)}`}</span>
          </div>
          <h2 className="tl-q fd">{item.name}</h2>
          {item.description && <p className="tl-desc">{item.description}</p>}
          {(price || house.ordersEnabled) && (
            <p className="tl-price">
              {price && <b>{price}</b>}
              {house.ordersEnabled && <span>{ct("tvOrderQr", lang)}</span>}
            </p>
          )}
        </>
      )}
      {next && (
        <p className="tl-next">
          <IconClock />
          <span>
            {ctf("tvNextAt", lang, { t: localTime(next.starts_at, house.timezone, lang) })}
            <b>{questionText(next, lang)}</b>
          </span>
        </p>
      )}
    </section>
  );
}

// ---------- Telas sem dados ----------

function Frame({ plain, lang, children }: { plain?: boolean; lang: string; children: ReactNode }) {
  return (
    <div className={`tl${plain ? " tl-plain" : ""}`} lang={lang}>
      {children}
    </div>
  );
}

function PairScreen({ lang, code, busy, plain }: { lang: string; code: string | null; busy: boolean; plain: boolean }) {
  const chars = (code ?? "······").split("");
  const [before, after] = ct("tvPairHelp", lang).split("{c}");
  return (
    <Frame plain={plain} lang={lang}>
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
    </Frame>
  );
}

function Waiting({ lang, plain }: { lang: string; plain: boolean }) {
  return (
    <Frame plain={plain} lang={lang}>
      <section className="tl-pair">
        <span className="tl-wait" role="status">
          <i className="tl-spin" />
          {ct("tvConnecting", lang)}
        </span>
      </section>
    </Frame>
  );
}

// Comunidade desligada: nada dela na tela. Aberta com a Comunidade já desligada, a página
// confere de novo a cada 5 min (com a rede no ar), para voltar sozinha quando a casa ligar.
function OffScreen({ lang, reload, plain }: { lang: string; reload?: boolean; plain?: boolean }) {
  useEffect(() => {
    if (!reload) return;
    const id = setInterval(() => {
      if (navigator.onLine) location.reload();
    }, OFF_RELOAD_MS);
    return () => clearInterval(id);
  }, [reload]);
  return (
    <Frame plain={plain} lang={lang}>
      <section className="tl-pair">
        <div className="tl-in">
          <small>{ct("tvPairKicker", lang)}</small>
          <h2>{ct("tvOff", lang)}</h2>
          <p>{ct("tvOffSub", lang)}</p>
        </div>
      </section>
    </Frame>
  );
}

// ---------- Ícones ----------

const IconQr = () => (
  <svg className="tl-ico" viewBox="0 0 24 24" aria-hidden>
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <path d="M14 14h2v2M20 14v.01M14 20h.01M17 17h3v3" />
  </svg>
);
const IconIg = () => (
  <svg className="tl-ico" viewBox="0 0 24 24" aria-hidden>
    <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <path d="M17.2 6.8v.01" />
  </svg>
);
const IconClock = () => (
  <svg className="tl-ico" viewBox="0 0 24 24" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
const IconSound = ({ on }: { on: boolean }) => (
  <svg className="tl-ico" viewBox="0 0 24 24" aria-hidden>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    {on ? <path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11" /> : <path d="M16 9.5l5 5M21 9.5l-5 5" />}
  </svg>
);
