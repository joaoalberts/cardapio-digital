"use client";
/* eslint-disable @next/next/no-img-element -- logo e miniatura local (data: URL), já no tamanho certo */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { cleanName, NAME_MAX } from "@/lib/apareca/name";
import { FLOW_START, flowNext, inAppBrowser, PROBLEM_TEXT } from "@/lib/apareca/recording";
import { uuid } from "@/lib/uuid";
import { mineKey, pruneMine, TvIcon, type MineSaved } from "./invite";
import { Recorder, type Clip } from "./recorder";

// Tela do cliente: nome ou @ e aceite → gravação (recorder.tsx) → envio direto ao Mux → fila.
// O id do vídeo e o device ficam em localStorage['apa-meu:<slug>'] até o prazo, para a fila
// sobreviver a recarregar a página. A fila consulta o "meu vídeo" a cada 8 s, só com a aba
// visível. Textos da spec (16/10).

type Props = { slug: string; mesa: string; mesaLabel: string; name: string; logo: string | null; back: string };

type MyState = "sending" | "preparing" | "review" | "queue" | "on_tv" | "shown" | "not_shown" | "gone";
type Status = { state: MyState; position: number | null; eta_ms: number | null; first_shown_at: string | null; download: string | null };
type Mine = MineSaved;

const DEVICE_KEY = "cardapio-device";
const POLL_MS = 8_000;
const VIS_GAP_MS = 2_000; // minha escolha: trocar de aba várias vezes não vira rajada de consultas
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SEND_FAIL = "Não foi possível enviar. Tente de novo.";
const SEND_TEXT: Record<string, string> = {
  too_many: "Você já enviou o máximo de vídeos por agora. Tente de novo mais tarde.",
  name: "Esse nome não pode aparecer na TV. Volte e escolha outro.",
  closed: "A casa fechou para novos vídeos. Volte durante nosso horário.",
  paused: "Os envios estão pausados por agora. Tente daqui a pouco.",
  table: "Leia o QR da sua mesa de novo para participar.",
  off: "Os vídeos para a TV não estão disponíveis agora.",
};


const ls = {
  get(k: string): string | null {
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

// O vídeo guardado neste aparelho, se ainda vale e é deste device (senão, a chave é apagada).
function readMine(slug: string, device: string, now: number): Mine | null {
  const m = pruneMine(slug, now);
  if (m && m.device !== device) {
    ls.del(mineKey(slug));
    return null;
  }
  return m;
}

// PUT do vídeo inteiro na URL assinada do Mux, com progresso (até 8 MB: um pedido só basta).
function putBlob(url: string, blob: Blob, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    if (blob.type) x.setRequestHeader("Content-Type", blob.type);
    x.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error(`put ${x.status}`)));
    x.onerror = () => reject(new Error("put rede"));
    x.ontimeout = () => reject(new Error("put prazo"));
    x.timeout = 120_000;
    x.send(blob);
  });
}

function etaText(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms)) return null;
  const min = Math.round(ms / 60_000);
  return min < 1 ? "menos de 1 minuto" : min === 1 ? "cerca de 1 minuto" : `cerca de ${min} minutos`;
}

export function AparecaApp({ slug, mesa, mesaLabel, name, logo, back }: Props) {
  const [device, setDevice] = useState<string | null>(null);
  const [mine, setMine] = useState<Mine | null>(null);
  const [thumb, setThumb] = useState<string | null>(null); // só na memória; recarregar mostra o ícone
  const [flow, dispatch] = useReducer(flowNext, FLOW_START);
  const [nick, setNick] = useState("");
  const [consentAt, setConsentAt] = useState<string | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [progress, setProgress] = useState(0);
  const [sendMsg, setSendMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pending = useRef<{ id: string; upload_url: string; expires_at: string } | null>(null);
  const clipRef = useRef<Clip | null>(null);

  // Device anônimo do cardápio (o mesmo do carrinho) e o vídeo guardado.
  useEffect(() => {
    let d = ls.get(DEVICE_KEY);
    if (!d || !UUID.test(d)) {
      d = uuid();
      ls.set(DEVICE_KEY, d);
    }
    const m = readMine(slug, d, Date.now());
    const inApp = inAppBrowser(navigator.userAgent);
    queueMicrotask(() => {
      setDevice(d);
      setMine(m);
      if (inApp && !m) dispatch({ type: "problem", problem: "in_app" });
    });
  }, [slug]);

  // Cancelar (volta ao intro) esquece o envio aberto: o próximo leva o nome e o aceite de agora.
  useEffect(() => {
    if (flow.step === "intro") pending.current = null;
  }, [flow.step]);

  // Um vídeo gravado por vez: o anterior é solto ao regravar e ao sair da tela.
  const onClip = useCallback((c: Clip | null) => {
    const old = clipRef.current;
    if (old && old.url !== c?.url) URL.revokeObjectURL(old.url);
    if (!c) pending.current = null;
    clipRef.current = c;
    setClip(c);
  }, []);
  useEffect(() => {
    const drop = () => onClip(null);
    window.addEventListener("pagehide", drop);
    return () => {
      window.removeEventListener("pagehide", drop);
      drop();
    };
  }, [onClip]);

  const named = cleanName(nick);
  const nameOk = named.ok;
  const nameVal = named.ok ? named.name : null;
  const nameErr = !named.ok ? (named.error === "long" ? `Use até ${NAME_MAX} caracteres.` : "Esse nome não pode aparecer na TV. Escolha outro.") : null;

  const send = useCallback(async () => {
    const c = clipRef.current;
    if (!c || !device || !nameOk) return;
    setSendMsg(null);
    setProgress(0);
    dispatch({ type: "send" });
    try {
      // Reaproveita o envio já aberto se só o PUT falhou (não gasta outro do limite por hora).
      let p = pending.current;
      if (!p) {
        const r = await fetch(`/api/apareca/${slug}/enviar`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mesa, device, name: nameVal, consent: true, consent_at: consentAt ?? new Date().toISOString() }),
        });
        const j = (await r.json().catch(() => null)) as
          | { ok?: boolean; code?: string; detail?: string; id?: string; upload_url?: string; expires_at?: string }
          | null;
        if (!r.ok || !j?.ok || !j.id || !j.upload_url || !j.expires_at) {
          // O motivo curto (código do servidor ou status HTTP) vai junto: é o que o suporte precisa para achar a causa.
          const why = typeof j?.detail === "string" ? j.detail : (j?.code ?? `http ${r.status}`);
          setSendMsg((j?.code && SEND_TEXT[j.code]) || `${SEND_FAIL} (${why.slice(0, 40)})`);
          dispatch({ type: "send_failed" });
          return;
        }
        p = { id: j.id, upload_url: j.upload_url, expires_at: j.expires_at };
        pending.current = p;
      }
      await putBlob(p.upload_url, c.blob, setProgress);
      pending.current = null;
      const m: Mine = { id: p.id, device, expires_at: p.expires_at, ext: c.mime.includes("webm") ? "webm" : "mp4" };
      ls.set(mineKey(slug), JSON.stringify(m));
      setThumb(c.thumb);
      setMine(m);
      dispatch({ type: "sent" });
    } catch (e) {
      // "put 4xx", "put rede" ou "put prazo": o vídeo não chegou ao Mux.
      setSendMsg(`${SEND_FAIL} (${(e instanceof Error ? e.message : "erro").slice(0, 40)})`);
      dispatch({ type: "send_failed" });
    }
  }, [device, nameOk, nameVal, slug, mesa, consentAt]);

  const forget = useCallback(() => {
    ls.del(mineKey(slug));
  }, [slug]);
  // A vibração do "Olhe para a TV agora!" acontece uma vez só, mesmo depois de recarregar.
  const buzz = useCallback(() => {
    if (mine) ls.set(mineKey(slug), JSON.stringify({ ...mine, buzzed: true }));
  }, [mine, slug]);

  const head = (
    <header className="apa-top">
      <a className="apa-back" href={back} aria-label="Voltar ao cardápio">
        <svg viewBox="0 0 24 24" className="apa-ic" aria-hidden>
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </a>
      <span className="apa-house">
        {logo && <img src={logo} alt="" />}
        <span>{name}</span>
      </span>
      <span className="apa-mesa">{mesaLabel}</span>
    </header>
  );

  if (!device) return <main className="apa-page" aria-busy="true" />;

  if (mine) {
    return (
      <main className="apa-page">
        {head}
        <Queue slug={slug} mine={mine} thumb={thumb} clip={clip} onGone={forget} onBuzz={buzz} back={back} />
      </main>
    );
  }

  if (flow.step === "problem" && flow.problem) {
    const p = flow.problem;
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        setCopied(true);
      } catch {
        window.prompt("Copie o link:", location.href);
      }
    };
    return (
      <main className="apa-page">
        {head}
        <section className="apa-card apa-problem" role="alert">
          <span className="apa-badge" aria-hidden>
            {p === "in_app" ? "↗" : p === "too_big" ? "6s" : "!"}
          </span>
          <p className="apa-lead">{PROBLEM_TEXT[p]}</p>
          {p === "in_app" ? (
            <button className="apa-btn" onClick={copy}>
              {copied ? "Link copiado" : "Copiar link"}
            </button>
          ) : (
            <button className="apa-btn" onClick={() => dispatch({ type: "retry" })}>
              {p === "too_big" ? "Gravar de novo" : "Tentar de novo"}
            </button>
          )}
          <a className="apa-link" href={back}>
            Voltar ao cardápio
          </a>
        </section>
      </main>
    );
  }

  if (flow.step !== "intro") {
    return <Recorder flow={flow} dispatch={dispatch} clip={clip} onClip={onClip} onSend={send} progress={progress} sendMsg={sendMsg} />;
  }

  const count = [...nick].length;
  return (
    <main className="apa-page">
      {head}
      <section className="apa-hero">
        <div className="apa-tv" aria-hidden>
          <TvIcon />
        </div>
        <h1 className="fd">Apareça na TV!</h1>
        <p className="apa-lead">Grave um vídeo de 6 segundos. Depois que a equipe aprovar, ele passa na TV da casa.</p>
        <ol className="apa-steps">
          <li>
            <b>1</b>Grave 6 s
          </li>
          <li>
            <b>2</b>A casa aprova
          </li>
          <li>
            <b>3</b>Você na TV
          </li>
        </ol>
      </section>

      <form
        className="apa-card apa-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (consentAt && !nameErr) dispatch({ type: "consent_ok" });
        }}
      >
        <label className="apa-field">
          <span>
            Seu nome ou @ <em>(opcional)</em>
          </span>
          <input
            value={nick}
            onChange={(e) => {
              pending.current = null; // nome novo: o próximo envio abre outro, com este nome
              setNick([...e.target.value].slice(0, NAME_MAX).join(""));
            }}
            placeholder="@seuperfil"
            autoComplete="nickname"
            autoCapitalize="none"
            enterKeyHint="done"
            aria-invalid={!!nameErr}
            aria-describedby="apa-nick-help"
          />
          <small id="apa-nick-help" className={nameErr ? "is-err" : ""}>
            {nameErr ?? "Aparece embaixo do vídeo na TV."}
            <i>
              {count}/{NAME_MAX}
            </i>
          </small>
        </label>

        <label className="apa-check">
          <input type="checkbox" checked={!!consentAt} onChange={(e) => setConsentAt(e.target.checked ? new Date().toISOString() : null)} />
          <span className="apa-box" aria-hidden>
            <svg viewBox="0 0 24 24">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          <span>
            Autorizo o uso da minha imagem e do nome acima na TV da casa e li os{" "}
            <a href={`/${slug}/apareca/termos`} target="_blank" rel="noopener">
              termos de uso e a política de privacidade
            </a>
            .
          </span>
        </label>

        <button className="apa-btn apa-btn-cam" type="submit" disabled={!consentAt || !!nameErr}>
          <svg viewBox="0 0 24 24" className="apa-ic" aria-hidden>
            <path d="M3.5 8.5a2 2 0 012-2h2l1.5-2h6l1.5 2h2a2 2 0 012 2v9a2 2 0 01-2 2h-13a2 2 0 01-2-2z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
          Abrir a câmera
        </button>
        <p className="apa-fine">Seu vídeo só passa na TV depois que a equipe aprovar, e é apagado no prazo definido pela casa (de 6 horas a 7 dias).</p>
      </form>
    </main>
  );
}

// ---------- Fila ----------

function Queue({
  slug, mine, thumb, clip, onGone, onBuzz, back,
}: { slug: string; mine: Mine; thumb: string | null; clip: Clip | null; onGone: () => void; onBuzz: () => void; back: string }) {
  const [st, setSt] = useState<Status | null>(null);
  const buzzed = useRef(mine.buzzed === true);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    let inFlight = false;
    let lastAt = 0;
    const tick = async () => {
      if (!alive || done || inFlight || document.hidden) return;
      clearTimeout(timer);
      inFlight = true;
      lastAt = Date.now();
      try {
        const r = await fetch(`/api/apareca/${slug}/meu`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: mine.id, device: mine.device }),
        });
        if (!alive) return;
        if (r.status === 404) {
          // Apagado, vencido ou de outro aparelho: igual ao "gone".
          done = true;
          onGone();
          setSt({ state: "gone", position: null, eta_ms: null, first_shown_at: null, download: null });
          return;
        }
        if (r.ok) {
          const s = (await r.json()) as Status;
          if (!alive) return;
          setSt(s);
          if (s.state === "gone") onGone();
          if (s.state === "gone" || s.state === "not_shown") done = true;
          if (s.first_shown_at && !buzzed.current) {
            buzzed.current = true;
            onBuzz();
            try {
              navigator.vibrate?.([200, 100, 200]);
            } catch {}
          }
        }
      } catch {
        // rede caiu: tenta na próxima volta
      } finally {
        inFlight = false;
      }
      // Um timer só: quem chega aqui agenda a próxima; voltar à aba durante um fetch não dobra.
      clearTimeout(timer);
      if (alive && !done) timer = setTimeout(tick, POLL_MS);
    };
    const onVis = () => {
      // Escondida: a volta seguinte para sozinha. Visível: consulta na hora, a não ser que uma
      // esteja em andamento ou tenha acabado de sair (o timer único segue valendo).
      if (document.hidden || inFlight || Date.now() - lastAt < VIS_GAP_MS) return;
      void tick();
    };
    void tick();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [slug, mine.id, mine.device, onGone, onBuzz]);

  const state = st?.state;
  const beacon = () => {
    try {
      const body = new Blob([JSON.stringify({ id: mine.id, device: mine.device })], { type: "application/json" });
      navigator.sendBeacon?.(`/api/apareca/${slug}/baixou`, body);
    } catch {}
  };

  let title = "Preparando seu vídeo…";
  let text: string | null = "Já já ele entra na fila.";
  let tone = "wait";
  if (state === "review" || state === "queue") {
    title = "Seu vídeo está na fila!";
    tone = "queue";
    const pos = st?.position ? `Você é o ${st.position}º da fila` : null;
    const eta = etaText(st?.eta_ms ?? null);
    const when = [pos, eta && `tempo estimado: ${eta}`].filter(Boolean).join(" · ");
    text = state === "review" ? `A equipe vai dar uma olhada antes de ele ir para a TV.${when ? ` ${when}.` : ""}` : `Aprovado! ${when ? `${when}.` : "Fique de olho na TV."}`;
  } else if (state === "on_tv") {
    title = "Olhe para a TV agora!";
    text = "Seu vídeo está passando.";
    tone = "tv";
  } else if (state === "shown") {
    title = "Seu vídeo passou na TV!";
    text = "Obrigado por participar.";
    tone = "done";
  } else if (state === "not_shown") {
    title = "Seu vídeo não pôde ser exibido";
    text = null;
    tone = "off";
  } else if (state === "gone") {
    title = "Este vídeo não está mais disponível";
    text = null;
    tone = "off";
  }

  const ended = state === "gone" || state === "not_shown";
  // Logo depois de enviar: o arquivo da memória do celular. Depois: o MP4 do Mux, só do dono.
  const muxHref = st?.download ? `${st.download}&device=${encodeURIComponent(mine.device)}` : null;
  const localHref = !ended && clip ? clip.url : null;

  return (
    <section className={`apa-queue is-${tone}`} aria-live="polite">
      <div className="apa-thumb">
        {thumb ? <img src={thumb} alt="Miniatura do seu vídeo" /> : <span aria-hidden><TvIcon /></span>}
        {tone === "tv" && <i className="apa-pulse" aria-hidden />}
      </div>
      <h1 className="fd">{title}</h1>
      {text && <p className="apa-lead">{text}</p>}
      <div className="apa-acts">
        {muxHref ? (
          <a className="apa-btn" href={muxHref} target="_blank" rel="noopener" onClick={beacon}>
            Baixar meu vídeo
          </a>
        ) : localHref ? (
          <a className="apa-btn" href={localHref} download={`meu-video.${mine.ext}`} onClick={beacon}>
            Baixar meu vídeo
          </a>
        ) : null}
        <a className="apa-btn apa-btn-2" href={back}>
          Voltar ao cardápio
        </a>
      </div>
    </section>
  );
}
