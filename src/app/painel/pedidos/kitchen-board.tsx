"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NEXT_STATUS, type OrderStatus } from "@/lib/orders/service";
import { advanceOrder, fetchOpenOrders, setOrdersEnabled, type KitchenOrder } from "./actions";

const COLS: { status: OrderStatus; title: string; action: string; empty: string }[] = [
  { status: "new", title: "Novos", action: "Começar preparo", empty: "Pedidos novos chegam aqui com um aviso sonoro." },
  { status: "preparing", title: "Preparando", action: "Marcar pronto", empty: "Nada sendo preparado." },
  { status: "ready", title: "Prontos", action: "Entregue", empty: "Nada pronto esperando." },
];

const ago = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  return m < 1 ? "agora" : `há ${m} min`;
};

// Dois bipes curtos, gerados no navegador (sem arquivo de som).
function beep(ctx: AudioContext) {
  [0, 0.22].forEach((at) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
    g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.16);
    o.connect(g).connect(ctx.destination);
    o.start(ctx.currentTime + at);
    o.stop(ctx.currentTime + at + 0.18);
  });
}

export function KitchenBoard({ restaurantId, initial, enabled: enabled0 }: { restaurantId: string; initial: KitchenOrder[]; enabled: boolean }) {
  const [orders, setOrders] = useState(initial);
  const [enabled, setEnabled] = useState(enabled0);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [soundOn, setSoundOn] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const seen = useRef(new Set(initial.map((o) => o.id)));

  const load = useCallback(async () => {
    const r = await fetchOpenOrders(restaurantId);
    if (r.error || !r.orders) return setErr(r.error ?? "Não foi possível atualizar.");
    setErr(null);
    const arrived = r.orders.filter((o) => !seen.current.has(o.id));
    arrived.forEach((o) => seen.current.add(o.id));
    if (arrived.length) {
      setFresh((f) => new Set([...f, ...arrived.map((o) => o.id)]));
      if (audio.current) beep(audio.current);
    }
    setOrders(r.orders);
    setNow(Date.now());
  }, [restaurantId]);

  // 5 s com a aba visível; 30 s escondida. Ao voltar à aba, consulta na hora.
  useEffect(() => {
    let cancelled = false;
    let gen = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      const my = ++gen;
      await load().catch(() => setErr("Não foi possível atualizar."));
      if (cancelled || my !== gen) return;
      timer = setTimeout(loop, document.visibilityState === "visible" ? 5000 : 30000);
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      void loop();
    };
    timer = setTimeout(loop, 5000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const newCount = orders.filter((o) => o.status === "new").length;
  useEffect(() => {
    document.title = newCount ? `(${newCount}) Pedidos` : "Pedidos";
  }, [newCount]);

  // Tenta manter a tela acesa; se o navegador recusar, segue sem isso.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    let busy = false;
    const ask = async () => {
      if (busy) return;
      busy = true;
      try {
        const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
        if (wl && document.visibilityState === "visible") {
          await lock?.release().catch(() => {});
          lock = await wl.request("screen");
        }
      } catch {
        lock = null;
      } finally {
        busy = false;
      }
    };
    void ask();
    document.addEventListener("visibilitychange", ask);
    return () => {
      document.removeEventListener("visibilitychange", ask);
      void lock?.release().catch(() => {});
    };
  }, []);

  const enableSound = () => {
    audio.current ??= new AudioContext();
    void audio.current.resume();
    beep(audio.current);
    setSoundOn(true);
  };

  const advance = async (o: KitchenOrder) => {
    const next = NEXT_STATUS[o.status];
    if (!next) return;
    setFresh((f) => {
      const n = new Set(f);
      n.delete(o.id);
      return n;
    });
    setOrders((list) => (next === "delivered" ? list.filter((x) => x.id !== o.id) : list.map((x) => (x.id === o.id ? { ...x, status: next } : x))));
    try {
      const r = await advanceOrder(restaurantId, o.id, next);
      if (r.error) setErr(r.error);
    } catch {
      setErr("Não foi possível atualizar. Confira a internet.");
    }
    void load();
  };

  const toggle = async () => {
    const on = !enabled;
    setEnabled(on);
    const r = await setOrdersEnabled(restaurantId, on);
    if (r.error) {
      setEnabled(!on);
      setErr(r.error);
    }
  };

  return (
    <section className="kb">
      <div className="kb-head">
        <label className="kb-switch">
          <input type="checkbox" checked={enabled} onChange={toggle} />
          <span>Receber pedidos pelo cardápio</span>
        </label>
        <span className="kb-live">Atualiza sozinho</span>
        <button className={`kb-sound${soundOn ? " on" : ""}`} onClick={enableSound}>
          {soundOn ? "Som ligado" : "Ativar som"}
        </button>
      </div>
      {!enabled && <p className="kb-off">Desligado: o cardápio só mostra os pratos. Ligue para os clientes enviarem pedidos pelo QR da mesa.</p>}
      {err && (
        <p className="kb-err" role="alert">
          {err}
        </p>
      )}
      <div className="kb-cols">
        {COLS.map((c) => {
          const list = orders.filter((o) => o.status === c.status);
          return (
            <section key={c.status} className="kb-col" aria-label={c.title}>
              <h3>
                {c.title} <span>{list.length}</span>
              </h3>
              {list.length ? (
                list.map((o) => (
                  <article key={o.id} className={`kb-card${fresh.has(o.id) && o.status === "new" ? " fresh" : ""}`}>
                    <header>
                      <strong>{o.table_label}</strong>
                      <span>{ago(o.created_at, now)}</span>
                    </header>
                    <ul>
                      {o.lines.map((l, i) => (
                        <li key={i}>
                          <b>{l.qty}×</b>
                          {l.half_name ? `Meio a meio${l.option ? ` ${l.option}` : ""}` : `${l.name}${l.option ? ` ${l.option}` : ""}`}
                          {l.special && <span className="kb-offer">Oferta</span>}
                          {l.half_name && (
                            <span className="kb-halves">
                              ½ {l.name} · ½ {l.half_name}
                            </span>
                          )}
                          {l.note && <span className="kb-note">Obs.: {l.note}</span>}
                        </li>
                      ))}
                    </ul>
                    <button className={`kb-go${c.status === "ready" ? " dark" : ""}`} onClick={() => advance(o)}>
                      {c.action}
                    </button>
                  </article>
                ))
              ) : (
                <p className="kb-empty">{c.empty}</p>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
