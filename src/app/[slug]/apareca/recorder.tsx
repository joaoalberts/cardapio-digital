"use client";

import { useEffect, useRef, useState, type Dispatch } from "react";
import {
  CAMERA_CONSTRAINTS, canRedo, CLIP_MS, pickMime, recordingProblem, REDO_MAX, type FlowEvent, type FlowState,
} from "@/lib/apareca/recording";

// Palco da gravação, em tela cheia: prévia da câmera frontal espelhada em 9:16 (sem moldura),
// contagem 3, 2, 1, gravação de exatamente 6 s com a barra andando, revisão e envio.
// O vídeo gravado não é espelhado: é o que vai para a TV. A miniatura (quadro do meio) é
// desenhada num canvas aqui no aparelho e só serve para a tela da fila.

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
      .getUserMedia(CAMERA_CONSTRAINTS)
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
  }, [needCamera, dispatch]);

  // Contagem: um "tick" por segundo, só com a câmera já mostrando a imagem (depois de
  // "Gravar de novo" a câmera reabre do zero).
  useEffect(() => {
    if (step !== "countdown" || !liveOn) return;
    const t = setTimeout(() => dispatch({ type: "tick" }), 1000);
    return () => clearTimeout(t);
  }, [step, flow.count, liveOn, dispatch]);

  // Gravação: começa ao entrar em "recording", pega a miniatura aos 3 s e para sozinha aos 6 s.
  useEffect(() => {
    if (step !== "recording") return;
    const s = stream.current;
    const mime = pickMime((t) => MediaRecorder.isTypeSupported(t));
    if (!s || !mime) {
      queueMicrotask(() => dispatch({ type: "problem", problem: "unsupported" }));
      return;
    }
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(s, { mimeType: mime, videoBitsPerSecond: VIDEO_BPS });
    } catch {
      queueMicrotask(() => dispatch({ type: "problem", problem: "unsupported" }));
      return;
    }
    const parts: Blob[] = [];
    let thumb: string | null = null;
    let live_ = true;
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) parts.push(e.data);
    };
    rec.onstop = () => {
      if (!live_) return;
      const type = (rec.mimeType || mime).split(";")[0];
      const blob = new Blob(parts, { type });
      onClip({ blob, url: URL.createObjectURL(blob), mime: type, thumb });
      dispatch({ type: "elapsed", ms: CLIP_MS, bytes: blob.size });
    };
    rec.start(500);
    const mid = setTimeout(() => {
      if (live.current) thumb = grabThumb(live.current);
    }, CLIP_MS / 2);
    const end = setTimeout(() => {
      if (rec.state !== "inactive") rec.stop();
    }, CLIP_MS);
    return () => {
      live_ = false;
      clearTimeout(mid);
      clearTimeout(end);
      if (rec.state !== "inactive") rec.stop();
    };
  }, [step, dispatch, onClip]);

  const redosLeft = REDO_MAX - flow.redos;
  const reviewing = step === "review" || step === "sending";

  return (
    <div className={`apa-stage is-${step}`}>
      <div className="apa-frame">
        <video ref={live} className="apa-live" playsInline muted autoPlay aria-hidden hidden={reviewing} />
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
              <p className="apa-tip">Fique em pé, sorria e capriche: são só 6 segundos.</p>
              <button className="apa-shoot" onClick={() => dispatch({ type: "ready" })} disabled={!liveOn} aria-label="Gravar 6 segundos">
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
