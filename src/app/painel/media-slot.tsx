"use client";
/* eslint-disable @next/next/no-img-element -- foto e vídeo enviados pelo restaurante */

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { extOf, IMAGE_TYPES, shrinkImage } from "@/lib/images/shrink";
import { capturePoster, VIDEO_TYPES } from "@/lib/images/poster";
import { mediaUrl } from "@/lib/menu/media";
import { discardVideo, startVideoUpload, type MediaInput } from "./cardapio/actions";

// Foto ou vídeo de um prato, categoria ou banner, já com o que o painel precisa mostrar.
export type SlotMedia = {
  kind: "photo" | "video";
  url: string;
  thumb: string;
  status: "processing" | "ready" | "failed";
  input?: MediaInput;
} | null;

// Sem Mux, o vídeo vai inteiro para o Storage, que aceita até 50 MB por arquivo.
const STORAGE_VIDEO_MAX = 50 * 1024 * 1024;

export const MEDIA_ACCEPT = "image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm,.mov,.mp4,.m4v";

// Envio em qualidade máxima: foto até 2560 px; vídeo no arquivo original (o Mux converte
// até 4K e cada cliente recebe a qualidade que a internet aguenta). O que foi enviado e
// não salvo é apagado ao fechar sem salvar.
export function useMediaSlot(restaurantId: string, folder: "items" | "categories" | "cover", initial: SlotMedia) {
  const [media, setMedia] = useState<SlotMedia>(initial);
  const [changed, setChanged] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploaded = useRef<string[]>([]);
  const muxUploads = useRef<string[]>([]);

  const put = (m: SlotMedia) => {
    setMedia(m);
    setChanged(true);
  };

  const uploadVideo = async (file: File) => {
    setUploading(true);
    setProgress(0);
    try {
      const start = await startVideoUpload(restaurantId);
      if (start.error) throw new Error(start.error);
      if (!start.mux && file.size > STORAGE_VIDEO_MAX) {
        throw new Error("Vídeo maior que 50 MB. Ligue o Mux para enviar vídeos sem limite de qualidade.");
      }
      const storage = createClient().storage.from("media");
      const id = crypto.randomUUID();
      const poster = await capturePoster(file).catch(() => null);
      if (!poster) throw new Error("Não foi possível ler este vídeo. Tente um MP4 ou MOV.");
      const posterPath = `${restaurantId}/${folder}/${id}-p.${extOf(poster)}`;
      const p = await storage.upload(posterPath, poster, { contentType: poster.type, cacheControl: "31536000" });
      if (p.error) throw p.error;
      uploaded.current.push(posterPath);

      let input: MediaInput;
      if (start.mux) {
        const { UpChunk } = await import("@mux/upchunk");
        await new Promise<void>((resolve, reject) => {
          const up = UpChunk.createUpload({ endpoint: start.url!, file, chunkSize: 16384 });
          up.on("progress", (e) => setProgress(Math.round(e.detail)));
          up.on("success", () => resolve());
          up.on("error", () => reject(new Error("upload")));
        });
        muxUploads.current.push(start.uploadId!);
        input = { kind: "video", poster: posterPath, uploadId: start.uploadId };
      } else {
        const ext = (file.name.split(".").pop() ?? "mp4").toLowerCase();
        const path = `${restaurantId}/${folder}/${id}.${ext}`;
        const v = await storage.upload(path, file, { contentType: file.type || "video/mp4", cacheControl: "31536000" });
        if (v.error) throw v.error;
        uploaded.current.push(path);
        input = { kind: "video", poster: posterPath, path };
      }
      put({
        kind: "video",
        url: URL.createObjectURL(file),
        thumb: mediaUrl(posterPath)!,
        status: start.mux ? "processing" : "ready",
        input,
      });
    } catch (e) {
      const msg = e instanceof Error && e.message.length > 12 ? e.message : null;
      setError(msg ?? "Não foi possível enviar o vídeo. Tente de novo.");
    } finally {
      setUploading(false);
      setProgress(null);
    }
  };

  const uploadPhoto = async (file: File) => {
    setUploading(true);
    try {
      const [full, small] = await Promise.all([
        shrinkImage(file, 2560, 0.92, "image/jpeg"),
        // Miniatura: lista e cards (categoria e banner ocupam a largura do celular, então maior).
        shrinkImage(file, folder === "items" ? 640 : 1080, 0.82, "image/jpeg"),
      ]);
      const id = crypto.randomUUID();
      const path = `${restaurantId}/${folder}/${id}.${extOf(full)}`;
      const thumbPath = `${restaurantId}/${folder}/${id}-t.${extOf(small)}`;
      const storage = createClient().storage.from("media");
      const opts = (b: Blob) => ({ contentType: b.type, cacheControl: "31536000" });
      const [a, b] = await Promise.all([storage.upload(path, full, opts(full)), storage.upload(thumbPath, small, opts(small))]);
      if (a.error || b.error) throw a.error ?? b.error;
      uploaded.current.push(path, thumbPath);
      put({
        kind: "photo",
        url: mediaUrl(path)!,
        thumb: mediaUrl(thumbPath)!,
        status: "ready",
        input: { kind: "photo", path, thumb: thumbPath },
      });
    } catch {
      setError("Não foi possível enviar a foto. Tente de novo.");
    } finally {
      setUploading(false);
    }
  };

  const pick = (file: File) => {
    setError(null);
    if (VIDEO_TYPES.test(file.type) || /\.(mov|mp4|m4v|webm)$/i.test(file.name)) return uploadVideo(file);
    if (!IMAGE_TYPES.test(file.type)) return setError("Use uma foto (PNG, JPG ou WebP) ou um vídeo (MP4 ou MOV).");
    return uploadPhoto(file);
  };

  return {
    media,
    changed,
    uploading,
    progress,
    error,
    pick,
    clear: () => put(null),
    // Para o servidor: undefined = não mexe; null = remove; objeto = a nova mídia.
    value: changed ? (media?.input ?? null) : undefined,
    // Salvou: o que foi enviado agora passa a ser do dono; o resto é apagado.
    committed() {
      const inp = changed ? media?.input : undefined;
      const kept = inp ? (inp.kind === "photo" ? [inp.path, inp.thumb] : [inp.poster, inp.path, inp.uploadId]) : [];
      uploaded.current = uploaded.current.filter((p) => !kept.includes(p));
      muxUploads.current = muxUploads.current.filter((u) => !kept.includes(u));
      this.discard();
    },
    discard() {
      if (uploaded.current.length) void createClient().storage.from("media").remove(uploaded.current);
      muxUploads.current.forEach((id) => void discardVideo(id));
      uploaded.current = [];
      muxUploads.current = [];
    },
  };
}

export type MediaSlotState = ReturnType<typeof useMediaSlot>;

// Imagem quadrada no centro, com "Alterar imagem" e "Excluir imagem" embaixo (como no DGuests).
export function MediaSlot({ slot, label, shape = "square" }: { slot: MediaSlotState; label: string; shape?: "square" | "wide" }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { media, uploading, progress } = slot;
  const open = () => fileRef.current?.click();
  return (
    <div className={`ms ms-${shape}`}>
      <button type="button" className="ms-box" onClick={open} disabled={uploading} aria-label={media ? `Alterar ${label}` : `Enviar ${label}`}>
        {media?.kind === "video" ? (
          <video
            src={media.url.startsWith("blob:") || (media.status === "ready" && !media.url.endsWith(".m3u8")) ? media.url : undefined}
            poster={media.thumb}
            muted
            playsInline
            loop
            autoPlay
          />
        ) : media ? (
          <img src={media.url} alt="" />
        ) : (
          <span className="ms-empty" aria-hidden>
            <svg viewBox="0 0 64 64">
              <rect x="6" y="10" width="44" height="38" rx="2" />
              <path d="M10 42l12-14 9 10 6-6 9 10" />
              <circle cx="49" cy="46" r="11" className="plus" />
              <path d="M49 40v12M43 46h12" className="plus-x" />
            </svg>
          </span>
        )}
        {media?.kind === "video" && <em className="ms-kind">vídeo</em>}
        {uploading && (
          <span className="ms-busy">
            Enviando…{progress != null && progress > 0 && <b>{progress}%</b>}
            {progress != null && <i style={{ width: `${progress}%` }} />}
          </span>
        )}
      </button>
      <button type="button" className="ms-link" onClick={open} disabled={uploading}>
        {media ? "Alterar imagem ou vídeo" : "Adicionar imagem ou vídeo"}
      </button>
      {media && (
        <button type="button" className="ms-del" onClick={slot.clear} disabled={uploading}>
          Excluir {media.kind === "video" ? "vídeo" : "imagem"}
        </button>
      )}
      {media?.kind === "video" && media.status === "processing" && (
        <small className="ms-note">O vídeo entra no cardápio assim que terminar de ser preparado, em poucos minutos.</small>
      )}
      {media?.status === "failed" && <small className="ms-note bad">Não foi possível preparar este vídeo. Envie de novo.</small>}
      {slot.error && (
        <small className="ms-note bad" role="alert">
          {slot.error}
        </small>
      )}
      <input
        ref={fileRef}
        type="file"
        accept={MEDIA_ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void slot.pick(f);
        }}
      />
    </div>
  );
}
