import "server-only";
import { muxEnabled, muxRequest } from "@/lib/mux";

// Mux do Apareça na TV: vídeo de 6 s do cliente em qualidade basic (codificação grátis), até 1080p,
// com o MP4 "highest" para o cliente baixar. Usa o mesmo cliente HTTP dos vídeos de prato (mux.ts).
// MUX_STREAM_BASE e MUX_IMAGE_BASE só existem para o Mux falso da verificação ponta a ponta.

const STREAM = process.env.MUX_STREAM_BASE ?? "https://stream.mux.com";
const IMAGE = process.env.MUX_IMAGE_BASE ?? "https://image.mux.com";
const PASSTHROUGH_MAX = 255;
// Ids do Mux são letras e números; qualquer outra coisa não vira caminho da API.
const MUX_ID = /^[A-Za-z0-9]{1,128}$/;

function checkId(id: string) {
  if (!MUX_ID.test(id)) throw new Error("mux: id inválido");
}

export async function createAparecaUpload(origin: string, passthrough: string): Promise<{ id: string; url: string }> {
  if (!muxEnabled()) throw new Error("mux desligado");
  if (passthrough.length > PASSTHROUGH_MAX) throw new Error("mux: passthrough acima de 255 caracteres");
  return muxRequest<{ id: string; url: string }>("/uploads", {
    method: "POST",
    body: {
      cors_origin: origin,
      new_asset_settings: {
        playback_policies: ["public"],
        video_quality: "basic",
        max_resolution_tier: "1080p",
        static_renditions: [{ resolution: "highest" }],
        passthrough,
      },
    },
  });
}

export type AssetInfo =
  | { status: "processing" }
  | { status: "failed" }
  | { status: "ready"; assetId: string; playbackId: string; durationS: number; mp4: boolean };

type Asset = {
  status: string;
  duration?: number;
  playback_ids?: { id: string; policy: string }[];
  static_renditions?: { files?: { name?: string; resolution?: string; status?: string }[] };
};

// Segue videoState (mux.ts), mas sem pedir MP4 depois: o "highest" nasce junto com o asset.
export async function assetInfo(uploadId: string): Promise<AssetInfo> {
  checkId(uploadId);
  const up = await muxRequest<{ status: string; asset_id?: string }>(`/uploads/${uploadId}`);
  if (["errored", "cancelled", "timed_out"].includes(up.status)) return { status: "failed" };
  if (!up.asset_id) return { status: "processing" };
  checkId(up.asset_id);
  const asset = await muxRequest<Asset>(`/assets/${up.asset_id}`);
  if (asset.status === "errored") return { status: "failed" };
  const pb = asset.playback_ids?.find((p) => p.policy === "public");
  if (asset.status !== "ready" || !pb) return { status: "processing" };
  const f = asset.static_renditions?.files?.find((x) => x.resolution === "highest" || x.name === "highest.mp4");
  const durationS = typeof asset.duration === "number" && Number.isFinite(asset.duration) ? asset.duration : 0;
  return { status: "ready", assetId: up.asset_id, playbackId: pb.id, durationS, mp4: f?.status === "ready" };
}

// Lança se não conseguir apagar: quem chama segura a linha e tenta de novo na próxima leitura.
// Asset que já não existe (404) conta como apagado, senão a linha ficaria presa para sempre.
export async function deleteMuxAsset(assetId: string): Promise<void> {
  checkId(assetId);
  if (!muxEnabled()) throw new Error("mux desligado");
  try {
    await muxRequest(`/assets/${assetId}`, { method: "DELETE" });
  } catch (e) {
    if (!is404(e)) throw e;
    // Sem o id no log; um 404 em série aponta token ou MUX_API_BASE errados.
    console.warn("apareca: asset do Mux não encontrado ao apagar (404); contado como apagado");
  }
}

const is404 = (e: unknown) => /^Error: mux 404\b/.test(String(e));
const UPLOAD_DONE = ["errored", "cancelled", "timed_out"];

// Envio parado sem asset na linha: confere o upload no Mux antes de a linha sumir, para não ficar
// mídia pública órfã. Virou asset → apaga o asset; ainda esperando → cancela; cancelado ou com
// erro → nada a fazer. Lança se o Mux não confirmar (a linha fica para a próxima leitura).
export async function releaseMuxUpload(uploadId: string): Promise<void> {
  checkId(uploadId);
  if (!muxEnabled()) throw new Error("mux desligado");
  let up: { status: string; asset_id?: string };
  try {
    up = await muxRequest<{ status: string; asset_id?: string }>(`/uploads/${uploadId}`);
  } catch (e) {
    if (!is404(e)) throw e;
    console.warn("apareca: upload do Mux não encontrado ao liberar (404); contado como liberado");
    return;
  }
  if (up.asset_id) return deleteMuxAsset(up.asset_id);
  if (UPLOAD_DONE.includes(up.status)) return;
  await muxRequest(`/uploads/${uploadId}/cancel`, { method: "PUT" });
}

export function mp4Url(playbackId: string): string {
  return `${STREAM}/${playbackId}/highest.mp4`;
}

export function hlsUrl(playbackId: string): string {
  return `${STREAM}/${playbackId}.m3u8`;
}

export function frameUrl(playbackId: string, t: number): string {
  return `${IMAGE}/${playbackId}/thumbnail.jpg?time=${t}&width=640`;
}
