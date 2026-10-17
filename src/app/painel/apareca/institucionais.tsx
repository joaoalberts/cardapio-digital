"use client";
/* eslint-disable @next/next/no-img-element -- miniatura do Mux */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { HOUSE_MAX_BYTES, HOUSE_MAX_S, HOUSE_TITLE_MAX } from "@/lib/apareca/panel-logic";
import { VIDEO_TYPES } from "@/lib/images/poster";
import { deleteHouse, moveHouse, setHouseActive, startHouseUpload, syncHouseVideos } from "./actions";

// Vídeos institucionais da casa: envio direto ao Mux (UpChunk, no molde do media-slot.tsx), lista
// na ordem da TV (subir e descer), ativar ou desativar e apagar. "Preparando" até o
// syncHouseVideos ver o asset pronto; acima de 3 min o asset é apagado e a linha avisa.
// A TV carrega cada institucional inteiro na memória, por isso o limite de 3 min e 200 MB.

export type HouseItem = {
  id: string; title: string; status: "processing" | "ready" | "failed"; active: boolean;
  duration_s: number | null; poster: string | null; too_long: boolean;
};

const SYNC_MS = 10_000;
const ACCEPT = "video/mp4,video/quicktime,video/webm,.mov,.mp4,.m4v";
const MB = 1024 * 1024;
const TOO_BIG = `Este vídeo tem mais de ${HOUSE_MAX_BYTES / MB} MB. Envie um de até ${HOUSE_MAX_BYTES / MB} MB e até ${HOUSE_MAX_S / 60} minutos.`;
const TOO_LONG = `Este vídeo tem mais de ${HOUSE_MAX_S / 60} minutos. Envie um de até ${HOUSE_MAX_S / 60} minutos.`;
const FAIL = "Não foi possível enviar o vídeo. Tente de novo.";
const SAVE_FAIL = "Não foi possível salvar. Confira a internet.";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

// Duração lida no navegador, só para avisar antes do envio; se não der para ler, segue (o servidor confere).
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (d: number | null) => {
      URL.revokeObjectURL(url);
      resolve(d);
    };
    const timer = setTimeout(() => done(null), 8_000);
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => {
      clearTimeout(timer);
      done(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null);
    };
    v.onerror = () => {
      clearTimeout(timer);
      done(null);
    };
    v.src = url;
  });
}

function statusText(h: HouseItem) {
  if (h.status === "processing") return "Preparando…";
  if (h.too_long) return `Mais de ${HOUSE_MAX_S / 60} minutos: o vídeo foi apagado. Envie um mais curto.`;
  if (h.status === "failed") return "Não foi possível preparar este vídeo. Apague e envie de novo.";
  return h.active ? "Na programação" : "Fora da programação";
}

export function Institucionais({ rid, items, muxOn }: { rid: string; items: HouseItem[]; muxOn: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const processing = items.filter((h) => h.status === "processing").length;

  // Em preparo: confere no Mux a cada 10 s com a aba visível; algum saiu do preparo → recarrega a
  // lista (e o efeito recomeça com a contagem nova).
  useEffect(() => {
    if (!processing) return;
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const r = await syncHouseVideos(rid).catch(() => null);
      if (!stop && r && r.pending < processing) router.refresh();
    };
    void tick();
    const t = setInterval(tick, SYNC_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [processing, rid, router]);

  const pick = async (file: File) => {
    setError(null);
    const name = title.trim();
    if (!name) return setError("Dê um título ao vídeo antes de escolher o arquivo.");
    if (!(VIDEO_TYPES.test(file.type) || /\.(mov|mp4|m4v|webm)$/i.test(file.name))) return setError("Use um vídeo MP4 ou MOV.");
    if (file.size > HOUSE_MAX_BYTES) return setError(TOO_BIG);
    const d = await readDuration(file);
    if (d !== null && d > HOUSE_MAX_S) return setError(TOO_LONG);

    setUploading(true);
    setProgress(0);
    let id: string | undefined;
    try {
      const start = await startHouseUpload(rid, name);
      if (start.error || !start.url || !start.id) throw new Error(start.error ?? FAIL);
      id = start.id;
      const { UpChunk } = await import("@mux/upchunk");
      await new Promise<void>((resolve, reject) => {
        const up = UpChunk.createUpload({ endpoint: start.url!, file, chunkSize: 16384 });
        up.on("progress", (e) => setProgress(Math.round(e.detail)));
        up.on("success", () => resolve());
        up.on("error", () => reject(new Error(FAIL)));
      });
      setTitle("");
    } catch (e) {
      // Envio que não terminou: a linha em preparo não fica sobrando.
      if (id) await deleteHouse(rid, id).catch(() => {});
      setError(e instanceof Error && e.message.length > 12 ? e.message : FAIL);
    } finally {
      setUploading(false);
      setProgress(null);
      router.refresh();
    }
  };

  const act = async (id: string, fn: () => Promise<{ error?: string }>) => {
    setBusy(id);
    setError(null);
    const r = await fn().catch(() => ({ error: SAVE_FAIL }));
    if (r.error) setError(r.error);
    setBusy(null);
    setConfirm(null);
    router.refresh();
  };

  return (
    <section className="ap-card app-house" aria-labelledby="app-h-house">
      <div className="ap-card-head">
        <h2 id="app-h-house">Vídeos institucionais</h2>
      </div>
      <p className="app-small">
        Vídeos da casa que passam na TV entre os vídeos dos clientes, na ordem desta lista. Até {HOUSE_MAX_S / 60} minutos e{" "}
        {HOUSE_MAX_BYTES / MB} MB cada.
      </p>

      {muxOn ? (
        <div className="app-up">
          <label className="app-fld">
            <span>Título</span>
            <input
              type="text"
              value={title}
              maxLength={HOUSE_TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Promoção de terça"
              disabled={uploading}
            />
          </label>
          <button type="button" className="app-save" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? `Enviando… ${progress ?? 0}%` : "Escolher vídeo e enviar"}
          </button>
          {uploading && (
            <span className="app-progress" aria-hidden>
              <i style={{ transform: `scaleX(${(progress ?? 0) / 100})` }} />
            </span>
          )}
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void pick(f);
            }}
          />
        </div>
      ) : (
        <p className="app-band app-band-off">O envio de vídeos está desligado neste servidor (Mux sem chave).</p>
      )}

      {error && (
        <p className="app-msg" role="alert">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <p className="app-empty">Nenhum vídeo institucional. Sem eles, a TV passa só os vídeos dos clientes.</p>
      ) : (
        <ol className="app-hlist">
          {items.map((h, k) => (
            <li key={h.id} className={`app-hrow${h.status === "failed" ? " bad" : ""}`}>
              {h.poster ? <img className="app-hthumb" src={h.poster} alt="" loading="lazy" /> : <i className="app-hthumb" aria-hidden />}
              <div className="app-meta">
                <b>{h.title}</b>
                <span>
                  {statusText(h)}
                  {h.duration_s !== null && h.status === "ready" ? ` · ${clock(h.duration_s)}` : ""}
                </span>
              </div>
              <div className="app-hacts">
                <button
                  type="button"
                  className="app-icon"
                  aria-label={`Subir ${h.title}`}
                  disabled={k === 0 || busy !== null}
                  onClick={() => act(h.id, () => moveHouse(rid, h.id, -1))}
                >
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <path d="M6 15l6-6 6 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="app-icon"
                  aria-label={`Descer ${h.title}`}
                  disabled={k === items.length - 1 || busy !== null}
                  onClick={() => act(h.id, () => moveHouse(rid, h.id, 1))}
                >
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {h.status === "ready" && (
                  <button
                    type="button"
                    className="app-sw"
                    role="switch"
                    aria-checked={h.active}
                    aria-label={`${h.title} na programação`}
                    disabled={busy !== null}
                    onClick={() => act(h.id, () => setHouseActive(rid, h.id, !h.active))}
                  >
                    <i />
                  </button>
                )}
                {confirm === h.id ? (
                  <button type="button" className="app-del sure" disabled={busy !== null} onClick={() => act(h.id, () => deleteHouse(rid, h.id))}>
                    Confirmar
                  </button>
                ) : (
                  <button type="button" className="app-del" disabled={busy !== null} onClick={() => setConfirm(h.id)}>
                    Apagar
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
