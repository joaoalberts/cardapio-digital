import "server-only";

// Vídeos dos pratos no Mux: ele converte o arquivo original e entrega em HLS,
// que ajusta a qualidade à internet de cada cliente (sem travar).
// Chaves só no servidor: MUX_TOKEN_ID e MUX_TOKEN_SECRET (variáveis da Vercel).

const API = process.env.MUX_API_BASE ?? "https://api.mux.com/video/v1"; // base trocável só para testes

export const muxEnabled = () => !!(process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET);

async function mux<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const auth = Buffer.from(`${process.env.MUX_TOKEN_ID}:${process.env.MUX_TOKEN_SECRET}`).toString("base64");
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`mux ${res.status}: ${await res.text().catch(() => "")}`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as { data: T }).data;
}

// Qualidade máxima (até 4K). Conta que não tem a qualidade "plus" cai para a básica.
export async function createUpload(origin: string, passthrough: string) {
  const settings = (video_quality: string) => ({
    cors_origin: origin,
    new_asset_settings: { playback_policies: ["public"], video_quality, max_resolution_tier: "2160p", passthrough },
  });
  type Upload = { id: string; url: string };
  try {
    return await mux<Upload>("/uploads", { method: "POST", body: settings("plus") });
  } catch {
    return await mux<Upload>("/uploads", { method: "POST", body: settings("basic") });
  }
}

export type VideoState =
  | { status: "processing"; assetId?: string }
  | { status: "ready"; assetId: string; playbackId: string }
  | { status: "failed" };

export async function videoState(uploadId: string): Promise<VideoState> {
  const up = await mux<{ status: string; asset_id?: string }>(`/uploads/${uploadId}`);
  if (["errored", "cancelled", "timed_out"].includes(up.status)) return { status: "failed" };
  if (!up.asset_id) return { status: "processing" };
  const asset = await mux<{ status: string; playback_ids?: { id: string; policy: string }[] }>(`/assets/${up.asset_id}`);
  if (asset.status === "errored") return { status: "failed" };
  const pb = asset.playback_ids?.find((p) => p.policy === "public");
  if (asset.status !== "ready" || !pb) return { status: "processing", assetId: up.asset_id };
  return { status: "ready", assetId: up.asset_id, playbackId: pb.id };
}

export async function deleteAsset(assetId: string) {
  await mux(`/assets/${assetId}`, { method: "DELETE" }).catch(() => {});
}
