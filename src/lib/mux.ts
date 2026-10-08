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

// Full HD com a melhor codificação que a conta aceitar: nítido em qualquer celular,
// mais leve e pronto mais rápido que 4K. Conta que não permite "plus" (plano grátis,
// por exemplo) cai para "basic", sem o dono precisar fazer nada.
export async function createUpload(origin: string, passthrough: string) {
  // Junto, um MP4 leve em 720p para os vídeos em loop da capa (ver mp4Of).
  const settings = (video_quality: string, mp4: boolean) => ({
    cors_origin: origin,
    new_asset_settings: {
      playback_policies: ["public"],
      video_quality,
      max_resolution_tier: "1080p",
      passthrough,
      ...(mp4 ? { static_renditions: [{ resolution: MP4_RES }] } : {}),
    },
  });
  type Upload = { id: string; url: string };
  const tries: [string, boolean][] = [
    ["plus", true],
    ["basic", true],
    ["plus", false],
    ["basic", false],
  ];
  let last: unknown;
  for (const [q, mp4] of tries) {
    try {
      return await mux<Upload>("/uploads", { method: "POST", body: settings(q, mp4) });
    } catch (e) {
      last = e;
      // Chave errada ou sem permissão: não adianta tentar outra qualidade.
      if (/mux 40[13]/.test(String(e))) break;
    }
  }
  throw last;
}

const MP4_RES = "720p";

type Asset = {
  status: string;
  playback_ids?: { id: string; policy: string }[];
  static_renditions?: { files?: { name?: string; resolution?: string; status?: string }[] };
};

// MP4 leve do asset: nome do arquivo quando pronto, "" quando não vai existir
// (vídeo original menor que 720p ou falha), null enquanto prepara ou falta pedir.
function mp4Of(asset: Asset): { mp4: string | null; missing: boolean } {
  const f = asset.static_renditions?.files?.find((x) => x.resolution === MP4_RES || x.name === `${MP4_RES}.mp4`);
  if (!f) return { mp4: null, missing: true };
  if (f.status === "ready") return { mp4: f.name ?? `${MP4_RES}.mp4`, missing: false };
  if (f.status === "preparing") return { mp4: null, missing: false };
  return { mp4: "", missing: false };
}

export type VideoState =
  | { status: "processing"; assetId?: string }
  | { status: "ready"; assetId: string; playbackId: string; mp4: string | null }
  | { status: "failed" };

export async function videoState(uploadId: string): Promise<VideoState> {
  const up = await mux<{ status: string; asset_id?: string }>(`/uploads/${uploadId}`);
  if (["errored", "cancelled", "timed_out"].includes(up.status)) return { status: "failed" };
  if (!up.asset_id) return { status: "processing" };
  const asset = await mux<Asset>(`/assets/${up.asset_id}`);
  if (asset.status === "errored") return { status: "failed" };
  const pb = asset.playback_ids?.find((p) => p.policy === "public");
  if (asset.status !== "ready" || !pb) return { status: "processing", assetId: up.asset_id };
  const found = mp4Of(asset);
  let mp4 = found.mp4;
  // Vídeo enviado antes do MP4 leve existir (ou conta que não aceitou no envio): pede agora.
  if (found.missing) {
    mp4 = await mux(`/assets/${up.asset_id}/static-renditions`, { method: "POST", body: { resolution: MP4_RES } }).then(
      () => null,
      () => "",
    );
  }
  return { status: "ready", assetId: up.asset_id, playbackId: pb.id, mp4 };
}

export async function deleteAsset(assetId: string) {
  await mux(`/assets/${assetId}`, { method: "DELETE" }).catch(() => {});
}
