"use client";

import { useEffect, useRef, useState, type Dispatch } from "react";
import {
  cameraConstraints, canRedo, CLIP_MS, MIN_CLIP_MS, pickMime, recordingProblem, REDO_MAX, type Facing, type FlowEvent, type FlowState,
} from "@/lib/apareca/recording";

// Palco da gravação, em tela cheia: prévia da câmera em 9:16 (sem moldura), com botão para
// alternar entre a frontal (espelhada, como um espelho) e a traseira, contagem 3, 2, 1,
// gravação de até 6 s com a barra andando (o cliente pode parar antes), revisão e envio.
// O vídeo gravado não é espelhado: é o que vai para a TV. A miniatura é desenhada num canvas
// aqui no aparelho e só serve para a tela da fila.

export type Clip = { blob: Blob; url: string; mime: string; thumb: string | null };

const VIDEO_BPS = 6_000_000;
const THUMB_W = 270;
const THUMB_H = 480;

function stopStream(s: MediaStream | null) {
  s?.getTracks().forEach((t) => t.stop());
}

// Quadro atual do vídeo ao vivo, recortado em 9:16 (como object-fit: cover), em JPEG pequeno.
function grabThumb(v: HTMLVideoElement): string | null {
  try {
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!vw || !vh) return null;
    const c = document.createElement("canvas");
    c.width = THUMB_W;
    c.height = THUMB_H;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const scale = Math.max(THUMB_W / vw, THUMB_H / vh);
    const sw = THUMB_W / scale;
    const sh = THUMB_H / scale;
    ctx.drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, THUMB_W, THUMB_H);
    return c.toDataURL("image/jpeg", 0.72);
  } catch {
    return null;
  }
}

type Props = {
  flow: FlowState;
  dispatch: Dispatch<FlowEvent>;
  clip: Clip | null;
  onClip: (c: Clip | null) => void;
  onSend: () => void;
  progress: number; // 0..1 do envio
  sendMsg: string | null;
};

export function Recorder({ flow, dispatch, clip, onClip, onSend, progress, sendMsg }: Props) {
  const live = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [liveOn, setLiveOn] = useState(false);
  const [muted, setMuted] = useState(true);
  const [facing, setFacing] = useState<Facing>("user");
  const rec = useRef<MediaRecorder | null>(null);
  const [canStop, setCanStop] = useState(false);
  const step = flow.step;
  // A revisão e o envio usam o vídeo gravado: a câmera (e o microfone) desligam ao entrar na
  // revisão, para o iOS voltar o som ao alto-falante normal, e só reabrem com "Regravar".
  const needCamera = step === "camera" || step === "countdown" || step === "recording";

  // Abre a câmera ao entrar no palco e a desliga ao sair (envio, cancelar, problema).
  useEffect(() => {
    if (!needCamera) return;
    let gone = false;
    const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    const mime = typeof MediaRecorder !== "undefined" ? pickMime((t) => MediaRecorder.isTypeSupported(t)) : null;
    if (!media?.getUserMedia || !mime) {
      queueMicrotask(() => dispatch({ type: "problem", problem: "unsupported" }));
      return;
    }
    media
      .getUserMedia(cameraConstraints(facing))
      .then((s) => {
        if (gone) return stopStream(s);
        stream.current = s;
        const v = live.current;
        if (v) {
          v.srcObject = s;
          v.play().catch(() => {});
        }
        setLiveOn(true);
      })
      .catch((e) => {
        if (!gone) dispatch({ type: "problem", problem: recordingProblem(e) });
      });
    return () => {
      gone = true;
      stopStream(stream.current);
      stream.current = null;
      setLiveOn(false);
    };
  }, [needCamera, facing, dispatch]);

  // Contagem: um "tick" por segundo, só com a câmera já mostrando a imagem (depois de
  // "Gravar de novo" a câmera reabre do zero).
  useEffect(() => {
    if (step !== "countdown" || !liveOn) return;
    const t = setTimeout(() => dispatch({ type: "tick" }), 1000);
    return () => clearTimeout(t);
  }, [step, flow.count, liveOn, dispatch]);

  // Gravação: começa ao entrar em "recording" e para sozinha aos 6 s ou quando o cliente toca em
  // parar (liberado depois de MIN_CLIP_MS). A miniatura sai logo no início e é trocada pelo quadro
  // do meio se a gravação chegar lá.
  useEffect(() => {
    if (step !== "recording") return;
    const s = stream.current;
    const mime = pickMime((t) => MediaRecorder.isTypeSupported(t));
    if (!s || !mime) {
      queueMicrotask(() => dispatch({ type: "problem", problem: "unsupported" }));
      return;
    }
    let r: MediaRecorder;
    try {
      r = new MediaRecorder(s, { mimeType: mime, videoBitsPerSecond: VIDEO_BPS });
    } catch {
      queueMicrotask(() => dispatch({ type: "problem", problem: "unsupported" }));
      return;
    }
    const parts: Blob[] = [];
    let thumb: string | null = null;
    let live_ = true;
    let started = 0;
    r.ondataavailable = (e) => {
      if (e.data && e.data.size) parts.push(e.data);
    };
    r.onstop = () => {
      if (!live_) return;
      const ms = Math.min(CLIP_MS, Math.round(performance.now() - started));
      if (ms < MIN_CLIP_MS) return dispatch({ type: "elapsed", ms, bytes: 0 });
      const type = (r.mimeType || mime).split(";")[0];
      const blob = new Blob(parts, { type });
      onClip({ blob, url: URL.createObjectURL(blob), mime: type, thumb });
      dispatch({ type: "elapsed", ms, bytes: blob.size });
    };
    r.start(500);
    started = performance.now();
    rec.current = r;
    const snap = () => {
      if (live.current) thumb = grabThumb(live.current) ?? thumb;
    };
    const early = setTimeout(snap, MIN_CLIP_MS / 2);
    const mid = setTimeout(snap, CLIP_MS / 2);
    const allow = setTimeout(() => setCanStop(true), MIN_CLIP_MS);
    // Pequena folga: o timer pode disparar alguns ms antes dos 6 s reais.
    const end = setTimeout(() => {
      if (r.state !== "inactive") r.stop();
    }, CLIP_MS + 50);
    return () => {
      live_ = false;
      clearTimeout(early);
      clearTimeout(mid);
      clearTimeout(allow);
      clearTimeout(end);
      rec.current = null;
      setCanStop(false);
      if (r.state !== "inactive") r.stop();
    };
  }, [step, dispatch, onClip]);

  const stop = () => {
    const r = rec.current;
    if (canStop && r && r.state !== "inactive") r.stop();
  };
  const redosLeft = REDO_MAX - flow.redos;
  const reviewing = step === "review" || step === "sending";

  return (
    <div className={`apa-stage is-${step}`}>
      <div className="apa-frame">
        <video ref={live} className={`apa-live${facing === "user" ? " is-mirror" : ""}`} playsInline muted autoPlay aria-hidden hidden={reviewing} />
        {reviewing && clip && (
          <video key={clip.url} className="apa-rec" src={clip.url} playsInline autoPlay loop muted={muted} />
        )}
        {!liveOn && needCamera && !reviewing && <div className="apa-wait">Abrindo a câmera…</div>}

        <div className="apa-stage-top">
          {step !== "sending" && (
            <button className="apa-x" onClick={() => dispatch({ type: "cancel" })} aria-label="Cancelar e voltar">
              <svg viewBox="0 0 24 24" className="apa-ic" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
          {step === "camera" && (
            <button
              className="apa-x apa-flip"
              onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
              disabled={!liveOn}
              aria-label={facing === "user" ? "Usar a câmera traseira" : "Usar a câmera frontal"}
            >
              <svg viewBox="0 0 24 24" className="apa-ic" aria-hidden>
                <path d="M4 8.5h3l1.6-2.2h6.8L17 8.5h3v10H4z" />
                <path d="M9 12.2a3.2 3.2 0 015.6-1.4M15 14.6a3.2 3.2 0 01-5.6 1.2" />
                <path d="M14.8 9.2v1.8H13M9.2 16.6v-1.8H11" />
              </svg>
            </button>
          )}
          {step === "recording" && (
            <span className="apa-recdot" role="status">
              <i aria-hidden /> Gravando
            </span>
          )}
          {reviewing && clip && (
            <button className="apa-x apa-sound" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Ligar o som" : "Desligar o som"}>
              <svg viewBox="0 0 24 24" className="apa-ic" aria-hidden>
                <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
                {muted ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M16 9a4.5 4.5 0 010 6M18.5 6.5a8 8 0 010 11" />}
              </svg>
            </button>
          )}
        </div>
        {step === "recording" && (
          <div className="apa-bar" aria-hidden>
            <i style={{ animationDuration: `${CLIP_MS}ms` }} />
          </div>
        )}

        {step === "countdown" && liveOn && (
          <div className="apa-count" aria-live="assertive">
            <span key={flow.count}>{flow.count}</span>
          </div>
        )}

        <div className="apa-stage-bottom">
          {step === "camera" && (
            <>
              <p className="apa-tip">Fique em pé, sorria e capriche: até 6 segundos.</p>
              <button className="apa-shoot" onClick={() => dispatch({ type: "ready" })} disabled={!liveOn} aria-label="Gravar até 6 segundos">
                <i aria-hidden />
              </button>
            </>
          )}
          {step === "recording" && (
            <>
              <p className="apa-tip">Toque para parar quando quiser.</p>
              <button className="apa-shoot is-stop" onClick={stop} disabled={!canStop} aria-label="Parar a gravação">
                <i aria-hidden />
              </button>
            </>
          )}
          {step === "review" && (
            <>
              {sendMsg && (
                <p className="apa-err" role="alert">
                  {sendMsg}
                </p>
              )}
              <div className="apa-row">
                {canRedo(flow) && (
                  <button className="apa-btn apa-btn-2" onClick={() => dispatch({ type: "redo" })}>
                    Regravar <small>{redosLeft === 1 ? "resta 1" : `restam ${redosLeft}`}</small>
                  </button>
                )}
                <button className="apa-btn" onClick={onSend}>
                  Enviar
                </button>
              </div>
              {!canRedo(flow) && <p className="apa-tip">Você já usou as {REDO_MAX} regravações.</p>}
            </>
          )}
          {step === "sending" && (
            <div className="apa-up" role="status" aria-live="polite">
              <span>Enviando… {Math.round(progress * 100)}%</span>
              <div className="apa-upbar">
                <i style={{ transform: `scaleX(${progress})` }} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
