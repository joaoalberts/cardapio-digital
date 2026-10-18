"use client";
/* eslint-disable @next/next/no-img-element -- logo e fotos dos pratos já vêm no tamanho certo */

import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from "react";
import { thumbSrc } from "@/lib/menu/media";
import type { PublicMenu } from "@/lib/menu/types";
import {
  houseHighlight, PAIR_RENEW_GRACE_MS, pairCodeDue, pairCodeRecord, priceInfo, priceText, savedPairCode, tvAccent, tvBgSize,
  tvReloadDue, tvSlow, type SavedPairCode,
} from "@/lib/tv/client-logic";
import { tt } from "@/lib/tv/i18n";
import { sha256Hex } from "@/lib/tv/sha256";
import { AparecaStage } from "../apareca/tv/stage";
import "../apareca/tv/stage.css";

// Telão da TV do salão. Pôster vivo que se adapta a qualquer TV (unidade --u em telao.css):
// o destaque da casa, a logo, o @ e o QR do cardápio, com o Apareça na TV por cima.
// - Pareamento sem token trafegando: a TV gera um segredo de 32 bytes (localStorage
//   tl-secret:<slug>), pede um código mandando só o SHA-256 dele (JS puro: em http://<IP>
//   não há crypto.subtle) e prova quem é pelo cabeçalho x-telao. Esperando o painel, consulta
//   o estado a cada 5 s; pareada, a cada 5 min (e recebe o modo simples do painel). 401 apaga
//   o segredo e volta ao código. O código fica guardado (tl-code:<slug>) e volta igual na
//   recarga; só se pede outro depois que ele vence.
// - Modo simples (.tl-plain, sem animação): ?simples=1, o interruptor do painel, ou sozinho se
//   a TV passar de 24 ms por quadro nos primeiros 2 s.
// - Wake lock pedido de novo ao voltar a aba; recarrega sozinha a cada 3 h (com o Apareça no ar,
//   o primeiro toque põe em tela cheia).
// - Apareça na TV (AparecaStage): camada por cima do pôster; sem programa, some.

const PAIR_POLL_MS = 5_000;
const PAIRED_CHECK_MS = 5 * 60_000;
const RETRY_LATER_MS = 60_000; // muitos códigos pedidos ou slug sumiu
const RELOAD_CHECK_MS = 60_000;
const SLOW_PROBE_MS = 2_000;
const HEX64 = /^[0-9a-f]{64}$/;
const CODE = /^[A-Z2-9]{6}$/;
// Nome da tela do painel, que só existe em português.
const PANEL_SECTION = "TVs";

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
type Props = { slug: string; lang: string; house: TvHouse; qrSvg: string; qrLink: string; menu: PublicMenu };

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

// ?simples=1 liga o modo simples; ?debug=1 mostra o link do QR.
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

type Phase = "boot" | "pair" | "live";
type PairView = { phase: Phase; code: string | null; busy: boolean; simple: boolean };
type Estado = { kind: "paired"; simple: boolean } | { kind: "pending" } | { kind: 401 } | { kind: 404 } | { kind: "error" };
type Codigo = { code: string; exp: number } | "too_many" | "invalid" | "error";

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
        const r = await fetch(`/api/tv/${slug}/estado`, { method: "POST", headers: { "x-telao": secret }, cache: "no-store" });
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
        const r = await fetch(`/api/tv/${slug}/codigo`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hash }),
          cache: "no-store",
        });
        if (r.status === 429) return "too_many";
        if (r.status === 404) return "error";
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
        // Slug sumiu: guarda o segredo e confere de novo depois.
        if (st.kind === 404) return later(live ? PAIRED_CHECK_MS : RETRY_LATER_MS);
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

// ---------- Tela e wake lock ----------

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

// Minuto atual, que anda sozinho: o destaque da casa segue o horário das categorias.
function useMinute() {
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60_000));
  useEffect(() => {
    const id = setInterval(() => setMinute(Math.floor(Date.now() / 60_000)), 15_000);
    return () => clearInterval(id);
  }, []);
  return minute;
}

// ---------- Telão ----------

type Photo = { key: string; src: string };

export function TelaoApp({ slug, lang, house, qrSvg, qrLink, menu }: Props) {
  const env = useEnv();
  const pair = usePairing(slug);
  const slow = useSlowTv(pair.phase === "live");
  useWakeLock();

  // Recarrega a cada 3 h, e só com a rede no ar (senão a TV fica na página de erro do navegador).
  const loadedAt = useRef(0);
  useEffect(() => {
    loadedAt.current = Date.now();
    const id = setInterval(() => {
      if (navigator.onLine && tvReloadDue(loadedAt.current, Date.now())) location.reload();
    }, RELOAD_CHECK_MS);
    return () => clearInterval(id);
  }, []);

  const plain = env.simple || pair.simple || slow;
  const accent = useMemo(() => tvAccent(house.accent) as CSSProperties, [house.accent]);
  const instagram = house.instagram?.replace(/^@+/, "") || null;

  if (pair.phase === "boot") return <Waiting lang={lang} plain={plain} />;
  if (pair.phase === "pair") return <PairScreen lang={lang} code={pair.code} busy={pair.busy} plain={plain} />;

  return (
    <div className={`tl${plain ? " tl-plain" : ""}`} data-font={house.fontTheme} style={accent} lang={lang}>
      <Poster lang={lang} house={house} instagram={instagram} qrSvg={qrSvg} slug={slug} menu={menu} />
      {/* Apareça na TV: por cima do pôster. */}
      <AparecaStage slug={slug} paused={false} plain={plain} houseName={house.name} houseLogo={house.logo} qrSvg={qrSvg} />
      {env.debug && <small className="tl-debug">{plain ? "simples" : "normal"} · {qrLink}</small>}
    </div>
  );
}

// Foto que não carregou (arquivo apagado, link antigo) some em vez de deixar um buraco na TV.
const hideBroken = (e: SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.style.display = "none";
};

type PosterProps = { lang: string; house: TvHouse; instagram: string | null; qrSvg: string; slug: string; menu: PublicMenu };

function Poster(p: PosterProps) {
  const { lang, house } = p;
  const minute = useMinute();
  const item = useMemo(() => houseHighlight(p.menu, new Date(minute * 60_000)), [p.menu, minute]);
  const src = item ? thumbSrc(item) : null;
  // Destaque sem foto (ou nenhum): a capa da casa.
  const photo: Photo | null = src && item ? { key: `hl-${item.id}`, src } : house.cover ? { key: "cover", src: house.cover } : null;
  const photos = photo ? [photo] : [];
  const on = photo?.key ?? null;
  const price = priceText(priceInfo(item ?? undefined), lang);

  return (
    <div className="tl-tv k-feat">
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
              <IconIg />
              <span>@{p.instagram}</span>
            </span>
          )}
        </div>
      </header>

      <div className="tl-side">
        <div className="tl-photo zoom">
          {photos.map((ph) => (
            <img key={ph.key} className={ph.key === on ? "on" : undefined} src={ph.src} alt="" onError={hideBroken} />
          ))}
        </div>
        <aside className="tl-qr">
          <div className="tl-plate" role="img" aria-label={`QR: /${p.slug}`} dangerouslySetInnerHTML={{ __html: p.qrSvg }} />
          <div className="tl-qcap">
            <b className="tl-qa fd">{tt("tvPoint", lang)}</b>
            <span className="tl-qb">{tt("tvQrSub", lang)}</span>
            {p.instagram && (
              <span className="tl-qc">
                <IconIg />
                <span>@{p.instagram}</span>
              </span>
            )}
          </div>
        </aside>
      </div>

      <section key={item?.id ?? "none"} className="tl-body tl-enter">
        {item && (
          <>
            <div className="tl-kick">
              <span>{`★ ${tt("highlightTitle", lang)}`}</span>
            </div>
            <h2 className="tl-q fd">{item.name}</h2>
            {item.description && <p className="tl-desc">{item.description}</p>}
            {(price || house.ordersEnabled) && (
              <p className="tl-price">
                {price && <b>{price}</b>}
                {house.ordersEnabled && <span>{tt("tvOrderQr", lang)}</span>}
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// Fundo: a foto da vez desenhada num canvas pequeno no formato da tela (64 px no lado maior:
// 64×36 deitada, 36×64 em pé) e esticado (o navegador suaviza, sem filter). Foto de outro
// domínio deixa o canvas "sujo", o que só impede ler os pixels: para mostrar, tanto faz.
function TinyBg({ photos, on }: { photos: Photo[]; on: string | null }) {
  const size = useBgSize();
  return (
    <div className="tl-bgb" aria-hidden>
      {photos.map((ph) => (
        <TinyCanvas key={ph.key} src={ph.src} on={ph.key === on} size={size} />
      ))}
    </div>
  );
}

// Formato da tela, refeito quando a TV gira ou a janela muda de tamanho.
function useBgSize() {
  const [size, setSize] = useState(() => tvBgSize(0, 0));
  useEffect(() => {
    const read = () => {
      const next = tvBgSize(window.innerWidth, window.innerHeight);
      setSize((cur) => (cur.w === next.w && cur.h === next.h ? cur : next));
    };
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return size;
}

function TinyCanvas({ src, on, size }: { src: string; on: boolean; size: { w: number; h: number } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const img = new Image();
    let alive = true;
    img.onload = () => {
      const ctx = alive ? cv.getContext("2d") : null;
      if (!ctx || !img.naturalWidth) return;
      // "cover": recorta a foto na proporção do canvas (a da tela).
      const k = Math.max(cv.width / img.naturalWidth, cv.height / img.naturalHeight);
      const w = cv.width / k;
      const h = cv.height / k;
      ctx.drawImage(img, (img.naturalWidth - w) / 2, (img.naturalHeight - h) / 2, w, h, 0, 0, cv.width, cv.height);
    };
    img.src = src;
    return () => {
      alive = false;
    };
  }, [src, size.w, size.h]);
  return <canvas ref={ref} width={size.w} height={size.h} className={on ? "on" : undefined} />;
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
  const [before, after] = tt("tvPairHelp", lang).split("{c}");
  return (
    <Frame plain={plain} lang={lang}>
      <section className="tl-pair">
        <div className="tl-in">
          <small>{tt("tvPairKicker", lang)}</small>
          <h2>{tt("tvPairTitle", lang)}</h2>
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
            {tt(busy ? "tvPairBusy" : "tvPairWait", lang)}
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
          {tt("tvConnecting", lang)}
        </span>
      </section>
    </Frame>
  );
}

// ---------- Ícones ----------

const IconIg = () => (
  <svg className="tl-ico" viewBox="0 0 24 24" aria-hidden>
    <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <path d="M17.2 6.8v.01" />
  </svg>
);
