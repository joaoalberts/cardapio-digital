import "server-only";

// Fotos, capas de vídeo e logos no Vercel Blob (antes, Supabase Storage).
// A Vercel cria BLOB_READ_WRITE_TOKEN ao ligar um Blob store ao projeto.
// Caminho de cada arquivo: "<id do restaurante>/<nome>", e o app guarda a URL completa.

const API = process.env.VERCEL_BLOB_API_URL ?? "https://vercel.com/api/blob";

export const storageEnabled = () => !!process.env.BLOB_READ_WRITE_TOKEN;

function headers(extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`, "x-api-version": "11", ...extra };
}

export async function putFile(pathname: string, body: ArrayBuffer, contentType: string): Promise<string> {
  const res = await fetch(`${API}/?pathname=${encodeURIComponent(pathname)}`, {
    method: "PUT",
    headers: headers({
      "x-vercel-blob-access": "public",
      "x-content-type": contentType,
      "x-add-random-suffix": "0",
      "x-cache-control-max-age": "31536000",
    }),
    body,
  });
  if (!res.ok) throw new Error(`blob put ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  return ((await res.json()) as { url: string }).url;
}

const isBlobUrl = (p: string) => /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//.test(p);

// Arquivo do restaurante: URL do Blob na pasta dele (ou caminho antigo do Storage).
export function ownsFile(restaurantId: string, p: string) {
  if (isBlobUrl(p)) return new URL(p).pathname.startsWith(`/${restaurantId}/`);
  return p.startsWith(`${restaurantId}/`);
}

// Apaga do Blob; caminhos antigos (Supabase) e arquivos de demonstração ficam como estão.
export async function removeFiles(paths: (string | null | undefined)[]) {
  const urls = paths.filter((p): p is string => !!p && isBlobUrl(p));
  if (!urls.length || !storageEnabled()) return;
  await fetch(`${API}/delete`, {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({ urls }),
  }).catch(() => undefined);
}
