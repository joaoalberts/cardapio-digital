"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  alertPattern, alertStep, latestOnly, NOTICE_MS, noticeOn, noticeText, type AlertState, type Notice, type NoticeEvent, type QueueItem,
} from "@/lib/apareca/panel-logic";
import { useHls } from "@/lib/menu/use-hls";
import { approveVideo, listQueue, rejectVideo, removeFromTv, type QueueResult } from "./actions";

// Fila do Apareça no celular da equipe: aprovar ou reprovar com um toque. "Reprovar" espera 5 s
// com "Desfazer" antes de chamar o servidor (a reprovação apaga o vídeo no Mux). A fila é
// consultada a cada 10 s com a aba visível; vídeo novo toca um sinal curto e vibra, depois que
// alguém tocou em "Ativar aviso" (o navegador só libera o som depois de um toque).

const POLL_MS = 10_000;
const UNDO_MS = 5_000;
const LOAD_FAIL = "Não foi possível atualizar a fila. Confira a internet.";
const SAVE_FAIL = "Não foi possível salvar. Confira a internet.";

const WARN_TEXT = {
  warn: "O uso do Mux deste mês passou de 75%.",
  paused: "Envios pausados: o teto do Mux está perto.",
} as const;

// Dois sinais curtos gerados no navegador (sem arquivo de som).
function chime(ctx: AudioContext) {
  [0, 0.2].forEach((at) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = at ? 1175 : 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
    g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.16);
    o.connect(g).connect(ctx.destination);
    o.start(ctx.currentTime + at);
    o.stop(ctx.currentTime + at + 0.18);
  });
}

const ago = (iso: string, now: number) => {
  const t = Date.parse(iso.trim().replace(" ", "T"));
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.round((now - t) / 60_000));
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  return `há ${Math.floor(m / 60)} h`;
};

function where(i: QueueItem) {
  return [i.table_label ? `Mesa ${i.table_label.replace(/^mesa\s+/i, "")}` : "Sem mesa", i.zone].filter(Boolean).join(" · ");
}

function Clip({ item }: { item: QueueItem }) {
  const ref = useRef<HTMLVideoElement>(null);
  useHls(ref, item.hls, true);
  if (!item.hls) return <div className="app-clip app-clip-empty">Vídeo em preparo</div>;
  return (
    <video
      ref={ref}
      className="app-clip"
      poster={item.poster ?? undefined}
      muted
      playsInline
      loop
      autoPlay
      data-want="1"
      aria-label={`Vídeo de ${item.name ?? "cliente sem nome"}`}
    />
  );
}

// initialOk false: a leitura no servidor falhou; a primeira consulta boa não toca o aviso.
export function Fila({ rid, initial, initialOk, communityOn }: { rid: string; initial: QueueResult; initialOk: boolean; communityOn: boolean }) {
  const [items, setItems] = useState(initial.items);
  const [warn, setWarn] = useState(initial.warn);
  const [notice, setNotice] = useState<Notice>({ load: null, action: null });
  const note = useCallback((ev: NoticeEvent) => setNotice((n) => noticeOn(n, ev)), []);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [undo, setUndo] = useState<Set<string>>(new Set()); // reprovações esperando os 5 s
  const [soundOn, setSoundOn] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  // A resposta do servidor na abertura da página é a "primeira carga": não toca som.
  const alert = useRef<AlertState>({ newest: initial.newest, primed: initialOk });
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const queries = useRef(latestOnly());

  // auto: consulta do relógio (pula se já há uma em andamento). Sem auto: leitura depois de uma
  // ação, que sempre vai. Em qualquer caso, só a resposta do pedido mais novo chega à tela.
  const load = useCallback(
    async (auto = false) => {
      const q = queries.current;
      if (auto && q.busy()) return;
      const n = q.begin();
      let r: QueueResult;
      try {
        r = await listQueue(rid);
      } catch {
        if (q.current(n)) note({ type: "load_fail", text: LOAD_FAIL });
        return;
      } finally {
        q.end(n);
      }
      if (!q.current(n)) return;
      note({ type: "load_ok" });
      const step = alertStep(alert.current, r.items);
      alert.current = { newest: step.newest, primed: step.primed };
      if (step.ring && audio.current) {
        chime(audio.current);
        navigator.vibrate?.(alertPattern());
      }
      setItems(r.items);
      setWarn(r.warn);
      setNow(Date.now());
    },
    [rid, note],
  );

  // 10 s com a aba visível; escondida, não consulta. Ao voltar à aba, consulta na hora.
  // Um timer só: cada rodada limpa o anterior antes de marcar o próximo.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    };
    const tick = async () => {
      clearTimeout(timer);
      if (document.visibilityState === "visible") await load(true);
      schedule();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // A mensagem de uma ação some sozinha depois de NOTICE_MS (ou antes, em "Fechar").
  const actionAt = notice.action?.at;
  useEffect(() => {
    if (actionAt === undefined) return;
    const t = setTimeout(() => note({ type: "tick", at: Date.now() }), Math.max(0, actionAt + NOTICE_MS - Date.now()));
    return () => clearTimeout(t);
  }, [actionAt, note]);

  const mark = (id: string, on: boolean) =>
    setBusy((b) => {
      const n = new Set(b);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  const run = useCallback(
    // Aprovado passa para "Na TV agora" na hora; reprovado e removido saem da lista.
    async (id: string, act: typeof approveVideo, approved = false) => {
      try {
        const r = await act(rid, id);
        queries.current.bump(); // consulta que saiu antes da ação traria a lista velha
        note({ type: "action", text: r.error ?? null, at: Date.now() });
        if (!r.error)
          setItems((list) =>
            approved ? list.map((x) => (x.id === id ? { ...x, status: "approved" as const } : x)) : list.filter((x) => x.id !== id),
          );
      } catch {
        note({ type: "action", text: SAVE_FAIL, at: Date.now() });
      }
      await load();
    },
    [rid, load, note],
  );

  const approve = async (id: string) => {
    mark(id, true);
    await run(id, approveVideo, true);
    mark(id, false);
  };

  const commitReject = useCallback(
    (id: string) => {
      timers.current.delete(id);
      setUndo((u) => {
        const n = new Set(u);
        n.delete(id);
        return n;
      });
      void run(id, rejectVideo);
    },
    [run],
  );

  const reject = (id: string) => {
    setUndo((u) => new Set(u).add(id));
    timers.current.set(id, setTimeout(() => commitReject(id), UNDO_MS));
  };

  const cancelReject = (id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setUndo((u) => {
      const n = new Set(u);
      n.delete(id);
      return n;
    });
  };

  // Saiu da página com reprovação esperando: a pessoa já decidiu, então envia agora.
  useEffect(() => {
    const t = timers.current;
    return () => {
      for (const [id, h] of t) {
        clearTimeout(h);
        void rejectVideo(rid, id).catch(() => {});
      }
      t.clear();
    };
  }, [rid]);

  const remove = async (id: string) => {
    mark(id, true);
    await run(id, removeFromTv);
    mark(id, false);
  };

  const enableSound = () => {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audio.current ??= new Ctor();
    void audio.current.resume();
    chime(audio.current);
    navigator.vibrate?.(alertPattern());
    setSoundOn(true);
  };

  const pending = items.filter((i) => i.status === "pending");
  const onTv = items.filter((i) => i.status === "approved");

  return (
    <div className="app-fila">
      {!communityOn && (
        <p className="app-band app-band-off" role="status">
          O Apareça usa o telão da Comunidade. Ligue a Comunidade primeiro.
        </p>
      )}
      {warn !== "ok" && (
        <p className={`app-band ${warn === "paused" ? "app-band-stop" : "app-band-off"}`} role="status">
          {WARN_TEXT[warn]}
        </p>
      )}
      {noticeText(notice) && (
        <div className="app-band app-band-stop app-note" role="alert">
          <span>{noticeText(notice)}</span>
          {notice.action && (
            <button type="button" className="app-note-x" onClick={() => note({ type: "close" })}>
              Fechar
            </button>
          )}
        </div>
      )}

      <div className="app-bar">
        <button type="button" className={`app-sound${soundOn ? " on" : ""}`} onClick={enableSound} aria-pressed={soundOn}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 003.4 0" />
          </svg>
          {soundOn ? "Aviso ativado" : "Ativar aviso"}
        </button>
        <span className="app-hint">A fila se atualiza sozinha a cada 10 s.</span>
      </div>

      <section className="ap-card" aria-labelledby="app-h-pend">
        <div className="ap-card-head">
          <h2 id="app-h-pend">
            Para aprovar {pending.length > 0 && <span className="app-count">{pending.length}</span>}
          </h2>
        </div>
        {pending.length === 0 ? (
          <p className="app-empty">Nenhum vídeo esperando. Quando um cliente enviar, ele aparece aqui.</p>
        ) : (
          <ul className="app-grid">
            {pending.map((i) => (
              <li key={i.id} className="app-item">
                <Clip item={i} />
                <div className="app-meta">
                  <b>{i.name ?? "Sem nome"}</b>
                  <span>{where(i)}</span>
                  <span>{ago(i.created_at, now)}</span>
                </div>
                {undo.has(i.id) ? (
                  <div className="app-undo" role="status">
                    <span>Vídeo reprovado.</span>
                    <button type="button" className="app-btn app-btn-undo" onClick={() => cancelReject(i.id)}>
                      Desfazer
                    </button>
                    <i className="app-undo-bar" aria-hidden />
                  </div>
                ) : (
                  <div className="app-actions">
                    <button type="button" className="app-btn app-btn-no" onClick={() => reject(i.id)} disabled={busy.has(i.id)}>
                      Reprovar
                    </button>
                    <button type="button" className="app-btn app-btn-yes" onClick={() => approve(i.id)} disabled={busy.has(i.id)}>
                      Aprovar
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ap-card" aria-labelledby="app-h-tv">
        <div className="ap-card-head">
          <h2 id="app-h-tv">Na TV agora</h2>
        </div>
        {onTv.length === 0 ? (
          <p className="app-empty">Nenhum vídeo de cliente na programação.</p>
        ) : (
          <ul className="app-list">
            {onTv.map((i) => (
              <li key={i.id} className="app-row">
                {i.poster ? (
                  // eslint-disable-next-line @next/next/no-img-element -- miniatura do Mux
                  <img className="app-thumb" src={i.poster} alt="" loading="lazy" />
                ) : (
                  <i className="app-thumb" aria-hidden />
                )}
                <div className="app-meta">
                  <b>{i.name ?? "Sem nome"}</b>
                  <span>{where(i)}</span>
                  <span>
                    Passou {Math.min(i.plays, i.plays_target)} de {i.plays_target} {i.plays_target === 1 ? "vez" : "vezes"}
                  </span>
                </div>
                <button type="button" className="app-btn app-btn-out" onClick={() => remove(i.id)} disabled={busy.has(i.id)}>
                  Remover da TV agora
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
