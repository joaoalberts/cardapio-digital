"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { latestOnly, NOTICE_MS, noticeOn, noticeText, WARN_TEXT, type Notice, type NoticeEvent } from "@/lib/apareca/panel-logic";
import type { AgoraResult } from "@/lib/painel/agora";
import { approveVideo, rejectVideo, removeFromTv } from "../apareca/actions";
import { OnTvNow, PendingVideos } from "../apareca/fila";
import { closePoll } from "../comunidade/actions";
import { Confirm } from "../comunidade/confirm";
import { HousePhotoSend, type HousePhotoData } from "../comunidade/house-photo";
import { NewPoll } from "../comunidade/poll-maker";
import { ICONS, Icon } from "../comunidade/shared";
import { loadAgora } from "./actions";

// Tela "Agora", a da noite: só o que pede um toque agora, na ordem do spec (avisos, Montar a casa, vídeos
// para aprovar, enquete no ar, Na TV agora, atalhos). Cada bloco só aparece com conteúdo. Uma consulta só
// (loadAgora: fila + enquete + TVs) a cada 10 s, com a aba visível, como a Fila de antes; o aviso sonoro
// de vídeo novo funciona com a tela aberta em qualquer bloco.

const POLL_MS = 10_000;
const LOAD_FAIL = "Não foi possível atualizar a tela. Confira a internet.";
const QUEUE_FAIL = "Não foi possível atualizar os vídeos. Confira a internet.";
const SAVE_FAIL = "Não foi possível salvar. Confira a internet.";

const minutesLeft = (iso: string, now: number) => Math.max(0, Math.ceil((Date.parse(iso) - now) / 60_000));

export function AgoraLive({
  rid, isOwner, initial, initialOk, aparecaOff, maker, setup,
}: {
  rid: string; isOwner: boolean; initial: AgoraResult; initialOk: boolean; aparecaOff: boolean; maker: HousePhotoData; setup?: ReactNode;
}) {
  const [data, setData] = useState(initial);
  // Cada resposta de consulta sobe loaded: é quando o aviso sonoro confere se chegou vídeo novo.
  const [loaded, setLoaded] = useState(0);
  // router.refresh (enquete criada, foto enviada) traz uma leitura nova do servidor: vale como consulta.
  const [prev, setPrev] = useState(initial);
  if (initialOk && initial !== prev) {
    setPrev(initial);
    setData((d) => (initial.queueOk ? initial : { ...initial, queue: d.queue }));
    setLoaded((n) => n + 1);
  }
  const [notice, setNotice] = useState<Notice>({ load: null, action: null });
  const note = useCallback((ev: NoticeEvent) => setNotice((n) => noticeOn(n, ev)), []);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const queries = useRef(latestOnly());

  // auto: consulta do relógio (pula se já há uma em andamento). Sem auto: leitura depois de uma
  // ação, que sempre vai. Em qualquer caso, só a resposta do pedido mais novo chega à tela.
  const load = useCallback(
    async (auto = false) => {
      const q = queries.current;
      if (auto && q.busy()) return;
      const n = q.begin();
      let r: AgoraResult;
      try {
        r = await loadAgora(rid);
      } catch {
        if (q.current(n)) note({ type: "load_fail", text: LOAD_FAIL });
        return;
      } finally {
        q.end(n);
      }
      if (!q.current(n)) return;
      note({ type: "load_ok" });
      // Fila que falhou: fica a última lista boa (o aviso do bloco de vídeos diz que não atualizou).
      setData((d) => (r.queueOk ? r : { ...r, queue: d.queue }));
      setLoaded((k) => k + 1);
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
          setData((d) => ({
            ...d,
            queue: {
              ...d.queue,
              items: approved
                ? d.queue.items.map((x) => (x.id === id ? { ...x, status: "approved" as const } : x))
                : d.queue.items.filter((x) => x.id !== id),
            },
          }));
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
  const commitReject = useCallback((id: string) => void run(id, rejectVideo), [run]);
  const remove = async (id: string) => {
    mark(id, true);
    await run(id, removeFromTv);
    mark(id, false);
  };

  const endPoll = async (id: string) => {
    let error: string | undefined;
    try {
      error = (await closePoll(rid, id)).error;
    } catch {
      error = SAVE_FAIL;
    }
    queries.current.bump();
    note({ type: "action", text: error ?? null, at: Date.now() });
    if (error) return false;
    setData((d) => ({ ...d, poll: null }));
    void load();
  };

  const { queue, queueOk, poll, tvs, communityOn, aparecaAllowed } = data;
  const items = queue.items;
  const silent = tvs.filter((t) => !t.status.on);
  const pending = items.some((i) => i.status === "pending");
  const onTv = items.some((i) => i.status === "approved");
  const showPoll = communityOn && poll !== null;

  return (
    <div className="cp app-fila ag">
      {/* 1. Avisos que travam a noite */}
      {!communityOn && (
        <p className="app-band app-band-off" role="status">
          A Comunidade está desligada: sem enquete, sem Mural e sem telão.{" "}
          {/* O interruptor é só do dono. */}
          {isOwner ? <Link href="/painel/comunidade">Abrir Comunidade</Link> : <b>Peça ao dono.</b>}
        </p>
      )}
      {aparecaAllowed && aparecaOff && (
        <p className="app-band app-band-stop" role="status">
          O Apareça na TV está desligado no sistema agora. Os clientes não conseguem enviar vídeo.
        </p>
      )}
      {aparecaAllowed && !aparecaOff && queue.warn !== "ok" && (
        <p className={`app-band ${queue.warn === "paused" ? "app-band-stop" : "app-band-off"}`} role="status">
          {WARN_TEXT[queue.warn]}
        </p>
      )}
      {silent.length > 0 && (
        <p className="app-band app-band-off" role="status">
          {silent.map((t) => `${t.label}: ${t.status.text}`).join(" · ")}. Confira se a TV está ligada e com o endereço aberto.{" "}
          <Link href="/painel/tvs">Ver TVs</Link>
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

      {/* 2. Montar a casa (lido uma vez, no servidor). Com vídeo para aprovar, ela desce para depois dos vídeos
          (Ruling 13). As duas posições são casas fixas da lista: o PendingVideos não muda de lugar nem remonta. */}
      {!pending && setup}

      {/* 3. Vídeos para aprovar, com o aviso sonoro */}
      {aparecaAllowed && !queueOk && (
        <p className="app-band app-band-off" role="status">
          {QUEUE_FAIL}
        </p>
      )}
      {aparecaAllowed && (
        <PendingVideos
          rid={rid}
          items={items}
          loaded={loaded}
          initialNewest={initial.queue.newest}
          initialOk={initialOk}
          now={now}
          busy={busy}
          onApprove={approve}
          onReject={commitReject}
        />
      )}
      {pending && setup}

      {!pending && !onTv && !showPoll && (
        <p className="ag-empty">{aparecaAllowed ? "Tudo em dia. Quando um cliente enviar um vídeo, ele aparece aqui." : "Tudo em dia."}</p>
      )}

      {/* 4. Enquete no ar */}
      {showPoll && (
        <section className="ap-card ag-poll" aria-labelledby="ag-h-poll">
          <div className="ap-card-head">
            <h2 id="ag-h-poll">Enquete no ar</h2>
          </div>
          <p className="ag-q">{poll.question}</p>
          <p className="ag-meta">
            {poll.votes !== null && `${poll.votes} ${poll.votes === 1 ? "voto" : "votos"} · `}
            <span suppressHydrationWarning>termina em {minutesLeft(poll.endsAt, now)} min</span>
          </p>
          <Confirm key={poll.id} label="Encerrar" ask="Encerrar a enquete agora?" yes="Sim, encerrar" onYes={() => endPoll(poll.id)} />
        </section>
      )}

      {/* 5. Na TV agora */}
      {aparecaAllowed && <OnTvNow items={items} busy={busy} onRemove={remove} />}

      {/* 6. Atalhos */}
      <section className="ag-short" aria-label="Atalhos">
        {communityOn && (
          <div className="ag-short-poll">
            <NewPoll data={maker} />
          </div>
        )}
        <details className="ag-photo">
          <summary className="btn outline">
            <Icon d={ICONS.camera} />
            Foto de prato
          </summary>
          <HousePhotoSend data={maker} />
        </details>
      </section>
    </div>
  );
}
