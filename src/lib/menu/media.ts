import { sizedSrc } from "@/lib/images/sized";
import type { MenuItem, MenuMedia } from "./types";

// Larguras das fotos no cardápio (ver sizedSrc), sempre na resolução em que aparecem
// num celular de tela 3x: lista e carrinho (pequenos) usam a miniatura; cards e banner
// ocupam a largura do celular; o story em tela cheia vai até 1440 px.
export const THUMB_W = 480;
export const CARD_W = 1080;
export const STORY_W = 1440;

const BUCKET = "media";

// "/demo/x.jpg" e URLs completas passam direto; o resto é caminho no Supabase Storage.
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("/") || /^https?:\/\//.test(path)) return path;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${base}/storage/v1/object/public/${BUCKET}/${path}`;
}

// Banner e cards da capa: MP4 de 720p, que começa a tocar com o primeiro pedaço. Medido
// em 16/10 no 5G simulado: mais rápido que streaming, inclusive recortado (o banner levava
// 3,9 s em vez de 1,3 s). Sem o MP4, streaming dos primeiros 10 s em 720p. Story: vídeo
// inteiro, HLS até Full HD. O painel aceita vídeo de qualquer duração.
export const LOOP_SECONDS = 10;
const clip = `max_resolution=720p&asset_start_time=0&asset_end_time=${LOOP_SECONDS}`;
export function videoSrc(m: MenuMedia, size: "story" | "card" = "story"): string | null {
  if (m.mux_playback_id) {
    if (size === "card" && m.mux_mp4) return `https://stream.mux.com/${m.mux_playback_id}/${m.mux_mp4}`;
    if (size === "card") return `https://stream.mux.com/${m.mux_playback_id}.m3u8?${clip}`;
    return `https://stream.mux.com/${m.mux_playback_id}.m3u8`;
  }
  return mediaUrl(m.storage_path);
}

// Sem largura: o original. Com largura: reduzida (o celular baixa bem menos).
export function posterSrc(m: MenuMedia, width?: number): string | null {
  const raw = m.poster_path
    ? mediaUrl(m.poster_path)
    : m.mux_playback_id
      ? `https://image.mux.com/${m.mux_playback_id}/thumbnail.jpg`
      : null;
  return width ? sizedSrc(raw, width) : raw;
}

export function photoSrc(m: MenuMedia, width: number): string | null {
  return sizedSrc(mediaUrl(m.storage_path), width);
}

// Imagem pequena para cards e lista: miniatura da foto ou capa do vídeo.
export function thumbSrc(item: MenuItem | undefined, width = THUMB_W): string | null {
  const m = item?.media[0];
  if (!m) return null;
  return posterSrc(m, width) ?? (m.kind === "photo" ? photoSrc(m, width) : null);
}

// Valor fechado sem ",00" (R$ 64); com centavos, as duas casas (R$ 57,40).
export function formatPrice(cents: number, lang: string) {
  const digits = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat(lang, { style: "currency", currency: "BRL", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(cents / 100);
}
