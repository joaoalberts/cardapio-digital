"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { alertPattern, alertStep, type AlertState, type QueueItem } from "@/lib/apareca/panel-logic";
import { useHls } from "@/lib/menu/use-hls";
import { rejectVideo } from "./actions";

// Fila do Apareça no celular da equipe, em duas peças para a tela "Agora": PendingVideos (aprovar ou
// reprovar com um toque) e OnTvNow (o que passa na TV, com "Remover da TV agora"). Quem consulta a fila
// (a cada 10 s, com a aba visível) e chama as ações é a tela; aqui ficam o aviso sonoro e o "Desfazer".
// "Reprovar" espera 5 s com "Desfazer" antes de chamar o servidor (a reprovação apaga o vídeo no Mux).
// Vídeo novo toca um sinal curto e vibra, depois que alguém tocou em "Ativar aviso" (o navegador só
// libera o som depois de um toque).

const UNDO_MS = 5_000;

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

// "Ativar aviso" e "Para aprovar". O aviso fica sempre à vista (com a fila vazia também: é quando o vídeo
// novo chega); o cartão só aparece com vídeo esperando. loaded sobe a cada resposta de consulta da tela:
// é nela, e só nela, que o aviso confere se chegou vídeo novo (alertStep), como na Fila de antes.
// initialOk false: a leitura no servidor falhou; a primeira consulta boa não toca o aviso.
export function PendingVideos({
  rid, items, loaded, initialNewest, initialOk, now, busy, onApprove, onReject,
}: {
  rid: string; items: QueueItem[]; loaded: number; initialNewest: string | null; initialOk: boolean; now: number; busy: Set<string>;
  onApprove: (id: string) => void; onReject: (id: string) => void;
}) {
  const [undo, setUndo] = useState<Set<string>>(new Set()); // reprovações esperando os 5 s
  const [soundOn, setSoundOn] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  // A resposta do servidor na abertura da página é a "primeira carga": não toca som.
  const alert = useRef<AlertState>({ newest: initialNewest, primed: initialOk });
  const seen = useRef(loaded);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    if (seen.current === loaded) return; // só uma vez por resposta (e nunca na montagem)
    seen.current = loaded;
    const step = alertStep(alert.current, items);
    alert.current = { newest: step.newest, primed: step.primed };
    if (step.ring && audio.current) {
      chime(audio.current);
      navigator.vibrate?.(alertPattern());
    }
  }, [loaded, items]);

  const commitReject = useCallback(
    (id: string) => {
      timers.current.delete(id);
      setUndo((u) => {
        const n = new Set(u);
        n.delete(id);
        return n;
      });
      onReject(id);
    },
    [onReject],
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

  return (
    <>
      <div className="app-bar">
        <button type="button" className={`app-sound${soundOn ? " on" : ""}`} onClick={enableSound} aria-pressed={soundOn}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 003.4 0" />
          </svg>
          {soundOn ? "Aviso ativado" : "Ativar aviso"}
        </button>
        <span className="app-hint">A tela se atualiza sozinha a cada 10 s.</span>
      </div>

      {pending.length > 0 && (
        <section className="ap-card" aria-labelledby="app-h-pend">
          <div className="ap-card-head">
            <h2 id="app-h-pend">
              Vídeos para aprovar <span className="app-count">{pending.length}</span>
            </h2>
          </div>
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
                    <button type="button" className="app-btn app-btn-yes" onClick={() => onApprove(i.id)} disabled={busy.has(i.id)}>
                      Aprovar
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// "Na TV agora": vídeos de clientes na programação. Só aparece quando tem algum.
export function OnTvNow({ items, busy, onRemove }: { items: QueueItem[]; busy: Set<string>; onRemove: (id: string) => void }) {
  const onTv = items.filter((i) => i.status === "approved");
  if (!onTv.length) return null;
  return (
    <section className="ap-card" aria-labelledby="app-h-tv">
      <div className="ap-card-head">
        <h2 id="app-h-tv">Na TV agora</h2>
      </div>
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
            <button type="button" className="app-btn app-btn-out" onClick={() => onRemove(i.id)} disabled={busy.has(i.id)}>
              Remover da TV agora
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
