"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { clockSkew, minuteClock, pollDelay, refFrom } from "@/lib/comunidade/client-logic";
import type { FunnelKey, OptionId, PublicState } from "@/lib/comunidade/types";
import type { VoteResult } from "@/lib/comunidade/votes";
import { forgetTableMemory } from "@/lib/orders/table-memory";
import { useOrder } from "../order/order-context";

// Comunidade no cardápio (Palco da casa + Mural de pratos). Montado no MenuApp, dentro do
// OrderProvider: lê a mesa, o celular e o cardápio do pedido.
// - Consulta a leitura agregada (uma URL por restaurante, servida pela CDN): 12 s com a camada
//   aberta, 60 s só com o balão, 10 min com a Comunidade desligada, parada com a aba
//   escondida. Sem mesa, só com ?ref=telao.
// - Relógio por minuto (minute): o "agora" do destaque da casa e do "Pedir também", que anda
//   sozinho (a categoria do almoço fecha às 15h mesmo sem a leitura mudar).
// - Sem rede, mantém o último estado e avisa (offline).
// - O voto fica lembrado no celular por enquete (cmu-vote:<id>).
// - O funil é somado aqui e vai em lote (sendBeacon) quando a aba esconde e a cada 60 s com a
//   camada aberta; o servidor aceita no máximo 1 lote a cada 10 s por celular.

export type Tab = "palco" | "mural";
export type VoteOutcome = VoteResult | { ok: false; code: "network" };
type ClientKey = Exclude<FunnelKey, "vote">;

type Api = {
  state: PublicState | null;
  offline: boolean;
  skew: number; // ms a somar ao relógio do celular (0 se ele está certo)
  minute: number; // minuto cheio do relógio corrigido, em ms (0 antes de montar)
  open: boolean;
  setOpen: (v: boolean, tab?: Tab) => void;
  tab: Tab;
  setTab: (t: Tab) => void;
  vote: (option: OptionId) => Promise<VoteOutcome>;
  myVote: (pollId: string) => OptionId | null;
  track: (k: ClientKey) => void;
  canVote: boolean; // só quem leu o QR da mesa (lido agora ou lembrado) vota
  ref: "telao" | "story" | null;
};

const Ctx = createContext<Api | null>(null);
// A capa só precisa saber se a camada está aberta (pausa o vídeo): contexto à parte, para o
// cardápio inteiro não redesenhar a cada consulta.
const OpenCtx = createContext(false);

export function useComunidade() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useComunidade fora do ComunidadeProvider");
  return c;
}
export const useComunidadeOpen = () => useContext(OpenCtx);

const VOTE_KEY = (pollId: string) => `cmu-vote:${pollId}`;
const BEACON_GAP_MS = 10_500; // o servidor descarta o 2º lote do mesmo celular em menos de 10 s
const BEACON_EVERY_MS = 60_000;
const COUNTER_MAX = 20;
const REFETCH_AFTER_VOTE_MS = 5_000;
// Respostas conhecidas do voto; qualquer outra (503 do banco, proxy) conta como falha de rede.
const VOTE_CODES: readonly string[] = ["invalid", "not_found", "disabled", "table", "closed", "poll", "too_many"];

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

const isState = (s: unknown): s is PublicState =>
  !!s && typeof s === "object" && typeof (s as PublicState).enabled === "boolean" && typeof (s as PublicState).v === "string";

const defaultTab = (s: PublicState): Tab => (s.poll && !s.poll.closed ? "palco" : s.mural.length ? "mural" : "palco");

export function ComunidadeProvider({ children }: { children: ReactNode }) {
  const { slug, table, device } = useOrder();
  const [state, setState] = useState<PublicState | null>(null);
  const [offline, setOffline] = useState(false);
  const [skew, setSkew] = useState(0);
  const [minute, setMinute] = useState(0);
  const [open, setOpenState] = useState(false);
  const [tab, setTabState] = useState<Tab>("palco");
  const [ref, setRef] = useState<"telao" | "story" | null>(null);
  const [ready, setReady] = useState(false);
  const [votes, setVotes] = useState<Record<string, OptionId>>({});
  const [pending, setPending] = useState<{ poll: string; option: OptionId } | null>(null);

  // Espelhos para o código fora do desenho (consultas, funil, voto).
  const stateRef = useRef<PublicState | null>(null);
  const openRef = useRef(false);
  const tableRef = useRef(table);
  const deviceRef = useRef(device);
  const refRef = useRef<"telao" | "story" | null>(null);
  const hadMesa = useRef(false);
  const seq = useRef(0);
  const loaded = useRef(false);
  const autoOpened = useRef(false);
  const qrSent = useRef(false);
  const refSent = useRef(false);
  const events = useRef<Partial<Record<ClientKey, number>>>({});
  const lastBeacon = useRef(0);
  useEffect(() => {
    tableRef.current = table;
    deviceRef.current = device;
  }, [table, device]);

  const track = useCallback((k: ClientKey) => {
    events.current[k] = (events.current[k] ?? 0) + 1;
  }, []);

  // Chegada pelo QR do telão ou do story (uma vez por carga) e se a URL trouxe ?mesa=.
  useEffect(() => {
    const r = refFrom(location.search);
    refRef.current = r;
    hadMesa.current = new URLSearchParams(location.search).has("mesa");
    // Uma vez por carga, mesmo com o efeito rodando de novo (StrictMode, remontagem).
    if (r && !refSent.current) {
      refSent.current = true;
      track(r === "telao" ? "ref_telao" : "ref_story");
    }
    queueMicrotask(() => {
      setRef(r);
      setReady(true);
    });
  }, [track]);

  const openLayer = useCallback(
    (t: Tab) => {
      if (!openRef.current) track("open");
      openRef.current = true;
      setTabState(t);
      setOpenState(true);
    },
    [track],
  );

  const apply = useCallback(
    (s: PublicState) => {
      setOffline(false);
      setSkew(clockSkew(s.now, Date.now()));
      stateRef.current = s;
      setState((prev) => (prev && prev.v === s.v && prev.enabled === s.enabled ? prev : s));
      if (!s.enabled || !s.open) {
        openRef.current = false;
        setOpenState(false);
        return;
      }
      if (s.poll) {
        const id = s.poll.id;
        const saved = store.get(VOTE_KEY(id));
        if (saved === "a" || saved === "b" || saved === "c") setVotes((v) => (v[id] === saved ? v : { ...v, [id]: saved }));
      }
      // Denominador do funil: carga com a mesa do QR (?mesa=) e a Comunidade ligada.
      if (!qrSent.current && hadMesa.current && tableRef.current) {
        qrSent.current = true;
        track("qr");
      }
      // Veio pelo QR do telão, sem mesa: abre direto no resultado (não vota; fechando, volta
      // à capa sem balão).
      if (!autoOpened.current && refRef.current === "telao" && !tableRef.current) {
        autoOpened.current = true;
        openLayer(defaultTab(s));
      }
    },
    [openLayer, track],
  );

  const load = useCallback(async () => {
    const my = ++seq.current;
    try {
      const r = await fetch(`/api/comunidade/${slug}`);
      if (my !== seq.current) return;
      if (!r.ok) {
        // 404: o slug não existe; 5xx: mantém o último estado e tenta de novo na próxima.
        if (r.status === 404) {
          stateRef.current = null;
          setState(null);
        }
        return;
      }
      const s: unknown = await r.json();
      if (my !== seq.current || !isState(s)) return;
      loaded.current = true;
      apply(s);
    } catch {
      if (my === seq.current) setOffline(true);
    }
  }, [slug, apply]);

  // Sem mesa, só com ?ref=telao: lê ao abrir e enquanto a camada estiver aberta.
  const want = ready && (!!table || (ref === "telao" && (open || !state)));
  useEffect(() => {
    if (!want) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    const schedule = () => {
      clearTimeout(timer);
      const d = pollDelay({
        open: openRef.current,
        visible: document.visibilityState === "visible",
        enabled: stateRef.current ? stateRef.current.enabled : null,
      });
      if (d != null) timer = setTimeout(tick, d);
    };
    const tick = async () => {
      await load();
      if (alive) schedule();
    };
    const now = () => {
      clearTimeout(timer);
      void tick();
    };
    const onVis = () => (document.visibilityState === "visible" ? now() : clearTimeout(timer));
    const onOffline = () => setOffline(true);
    // Abriu a camada (ou primeira leitura): consulta já; fechou: só reagenda (60 s, ou 10 min
    // com a Comunidade desligada).
    if (openRef.current || !loaded.current) now();
    else schedule();
    document.addEventListener("visibilitychange", onVis);
    addEventListener("online", now);
    addEventListener("offline", onOffline);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
      removeEventListener("online", now);
      removeEventListener("offline", onOffline);
    };
  }, [want, open, load]);

  // ---------- Relógio por minuto ----------
  // Começa no primeiro quadro depois de montar e acorda na virada de cada minuto.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const c = minuteClock(Date.now() + skew);
      setMinute(c.minute);
      timer = setTimeout(tick, c.next + 50);
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [skew]);

  // ---------- Funil ----------
  const flush = useCallback(() => {
    const d = deviceRef.current;
    const e = events.current;
    const keys = Object.keys(e) as ClientKey[];
    if (!d || !keys.length) return;
    // Só manda com a Comunidade sabidamente ligada; a chegada pelo telão/story vale sozinha
    // (o servidor confere a cabeça e descarta se estiver desligada).
    if (!stateRef.current?.enabled && !e.ref_story && !e.ref_telao) return;
    const now = Date.now();
    if (now - lastBeacon.current < BEACON_GAP_MS) return;
    const batch: Partial<Record<ClientKey, number>> = {};
    const rest: Partial<Record<ClientKey, number>> = {};
    for (const k of keys) {
      const v = e[k] ?? 0;
      if (v <= 0) continue;
      batch[k] = Math.min(v, COUNTER_MAX);
      if (v > COUNTER_MAX) rest[k] = v - COUNTER_MAX;
    }
    const body = JSON.stringify({ mesa: tableRef.current?.code ?? null, device: d, e: batch });
    const url = `/api/comunidade/${slug}/eventos`;
    let sent = false;
    try {
      sent = navigator.sendBeacon?.(url, body) ?? false;
    } catch {}
    if (!sent) void fetch(url, { method: "POST", body, keepalive: true, headers: { "content-type": "text/plain" } }).catch(() => {});
    events.current = rest;
    lastBeacon.current = now;
  }, [slug]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      removeEventListener("pagehide", flush);
    };
  }, [flush]);
  useEffect(() => {
    if (!open) return;
    const id = setInterval(flush, BEACON_EVERY_MS);
    return () => clearInterval(id);
  }, [open, flush]);

  // ---------- Camada ----------
  const setOpen = useCallback(
    (v: boolean, t?: Tab) => {
      const s = stateRef.current;
      if (v) {
        if (!s?.enabled || !s.open) return;
        openLayer(t ?? defaultTab(s));
        return;
      }
      openRef.current = false;
      setOpenState(false);
    },
    [openLayer],
  );

  // ---------- Voto ----------
  const vote = useCallback(
    async (option: OptionId): Promise<VoteOutcome> => {
      const s = stateRef.current;
      const t = tableRef.current;
      const d = deviceRef.current;
      if (!s?.poll || s.poll.closed || !t || !d) return { ok: false, code: "invalid" };
      const pollId = s.poll.id;
      setPending({ poll: pollId, option });
      try {
        const r = await fetch(`/api/comunidade/${slug}/votar`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mesa: t.code, device: d, poll: pollId, option }),
        });
        const res = (await r.json().catch(() => null)) as VoteResult | null;
        if (!res || typeof res.ok !== "boolean" || (!res.ok && !VOTE_CODES.includes(res.code))) return { ok: false, code: "network" };
        if (res.ok) {
          // Vale o voto que o servidor guardou (o primeiro deste celular nesta enquete).
          store.set(VOTE_KEY(pollId), res.option);
          setVotes((v) => ({ ...v, [pollId]: res.option }));
          setTimeout(() => void load(), REFETCH_AFTER_VOTE_MS);
        } else if (res.code === "table") {
          // Mesa lembrada que não vale mais (desativada no painel): esquece.
          forgetTableMemory(typeof localStorage === "undefined" ? null : localStorage, slug);
        } else if (res.code === "poll" || res.code === "closed" || res.code === "disabled") {
          void load();
        }
        return res;
      } catch {
        return { ok: false, code: "network" };
      } finally {
        setPending(null);
      }
    },
    [slug, load],
  );

  const myVote = useCallback(
    (pollId: string) => votes[pollId] ?? (pending?.poll === pollId ? pending.option : null),
    [votes, pending],
  );

  const setTab = useCallback((t: Tab) => setTabState(t), []);

  const api = useMemo<Api>(
    () => ({ state, offline, skew, minute, open, setOpen, tab, setTab, vote, myVote, track, canVote: !!table && !!device, ref }),
    [state, offline, skew, minute, open, setOpen, tab, setTab, vote, myVote, track, table, device, ref],
  );
  return (
    <OpenCtx.Provider value={open}>
      <Ctx.Provider value={api}>{children}</Ctx.Provider>
    </OpenCtx.Provider>
  );
}
