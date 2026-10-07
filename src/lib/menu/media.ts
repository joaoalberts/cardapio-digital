import type { MenuItem, MenuMedia } from "./types";

const BUCKET = "media";

// "/demo/x.jpg" e URLs completas passam direto; o resto é caminho no Supabase Storage.
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("/") || /^https?:\/\//.test(path)) return path;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${base}/storage/v1/object/public/${BUCKET}/${path}`;
}

// Banner e cards da capa são pequenos e em loop: até 720p basta e carrega bem mais rápido.
// No story (tela cheia) vai até Full HD; o player escolhe a qualidade conforme a internet.
export function videoSrc(m: MenuMedia, size: "story" | "card" = "story"): string | null {
  if (m.mux_playback_id) {
    const cap = size === "card" ? "?max_resolution=720p" : "";
    return `https://stream.mux.com/${m.mux_playback_id}.m3u8${cap}`;
  }
  return mediaUrl(m.storage_path);
}

export function posterSrc(m: MenuMedia): string | null {
  if (m.poster_path) return mediaUrl(m.poster_path);
  if (m.mux_playback_id) return `https://image.mux.com/${m.mux_playback_id}/thumbnail.jpg`;
  return null;
}

// Imagem pequena para cards e lista: miniatura da foto ou capa do vídeo.
export function thumbSrc(item: MenuItem | undefined): string | null {
  const m = item?.media[0];
  if (!m) return null;
  return posterSrc(m) ?? (m.kind === "photo" ? mediaUrl(m.storage_path) : null);
}

export function formatPrice(cents: number, lang: string) {
  return new Intl.NumberFormat(lang, { style: "currency", currency: "BRL" }).format(cents / 100);
}
