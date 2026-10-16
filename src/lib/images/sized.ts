// Foto no tamanho em que aparece: o celular baixa a versão reduzida em vez do original.
// Fotos do Blob (e as antigas do Supabase) passam por /api/img, que reduz e a Vercel
// guarda no cache; capas do Mux já vêm reduzidas pelo próprio Mux (?width=).

// Poucos tamanhos fixos: cada foto gera no máximo 5 versões, e o cache se repete.
// A rota nunca aumenta a foto: se o original é menor que o tamanho pedido, sai no tamanho dele.
export const IMG_WIDTHS = [240, 480, 828, 1080, 1440] as const;
export type ImgWidth = (typeof IMG_WIDTHS)[number];

const BLOB = /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//;
const SUPA = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\//;
const MUX = /^https:\/\/image\.mux\.com\//;

const snap = (w: number): ImgWidth => IMG_WIDTHS.find((x) => x >= w) ?? IMG_WIDTHS[IMG_WIDTHS.length - 1];

export function sizedSrc(url: string | null | undefined, width: number): string | null {
  if (!url) return null;
  const w = snap(width);
  if (MUX.test(url)) return `${url}${url.includes("?") ? "&" : "?"}width=${w}`;
  if (BLOB.test(url) || SUPA.test(url)) return `/api/img?w=${w}&u=${encodeURIComponent(url)}`;
  return url;
}

// ---- Lado do servidor (rota /api/img) ----

// O token do Blob tem o id do store: vercel_blob_rw_<store>_<segredo>.
export function blobHostFromToken(token: string | undefined): string | null {
  const m = token?.match(/^vercel_blob_rw_([a-zA-Z0-9]+)_/);
  return m ? `${m[1].toLowerCase()}.public.blob.vercel-storage.com` : null;
}

// Só o Blob deste app, o Supabase antigo e os hosts de IMG_HOSTS (separados por vírgula):
// a rota não busca imagem de qualquer endereço.
export function imgHostAllowed(url: URL, env: { blobToken?: string; supabaseUrl?: string; extraHosts?: string }): boolean {
  if (url.protocol !== "https:") return false;
  const extra = (env.extraHosts ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (extra.includes(url.hostname)) return true;
  const blob = blobHostFromToken(env.blobToken);
  if (blob && url.hostname === blob) return true;
  if (env.supabaseUrl) {
    try {
      const s = new URL(env.supabaseUrl);
      if (url.hostname === s.hostname && url.pathname.startsWith("/storage/v1/object/public/")) return true;
    } catch {}
  }
  return false;
}

// Endereço que o sizedSrc mandaria para a rota (Blob ou Supabase): fora da lista, a rota
// devolve o original em vez de reduzir.
export const isProxiable = (url: string) => BLOB.test(url) || SUPA.test(url);

export function parseImgQuery(q: URLSearchParams): { w: ImgWidth; url: URL } | null {
  const w = Number(q.get("w"));
  const u = q.get("u");
  if (!IMG_WIDTHS.includes(w as ImgWidth) || !u) return null;
  try {
    return { w: w as ImgWidth, url: new URL(u) };
  } catch {
    return null;
  }
}
