import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

// Fotos, capas de vídeo e logos no Vercel Blob (antes, Supabase Storage).
// A Vercel cria BLOB_READ_WRITE_TOKEN ao ligar um Blob store ao projeto.
// Caminho de cada arquivo: "<id do restaurante>/<nome>", e o app guarda a URL completa.
//
// Para teste local e Docker, STORAGE_DRIVER=local troca o Blob por arquivos em
// <raiz>/.local-blob/<pathname> (ou em LOCAL_BLOB_DIR), servidos pela rota
// /api/arquivos-locais/<pathname>. Nesse modo nada vai ao Blob: nem envio, nem exclusão.

const API = process.env.VERCEL_BLOB_API_URL ?? "https://vercel.com/api/blob";

export const storageDriver = (): "blob" | "local" => (process.env.STORAGE_DRIVER === "local" ? "local" : "blob");

export const storageEnabled = () => storageDriver() === "local" || !!process.env.BLOB_READ_WRITE_TOKEN;

function headers(extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`, "x-api-version": "11", ...extra };
}

export async function putFile(pathname: string, body: ArrayBuffer, contentType: string): Promise<string> {
  if (storageDriver() === "local") return putLocal(pathname, body);
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
// URL local só vale com o driver local ligado.
export function ownsFile(restaurantId: string, p: string) {
  if (isLocalUrl(p)) {
    const parts = storageDriver() === "local" ? localUrlSegments(p) : null;
    return !!parts && parts.length >= 2 && parts[0] === restaurantId;
  }
  if (isBlobUrl(p)) return new URL(p).pathname.startsWith(`/${restaurantId}/`);
  return p.startsWith(`${restaurantId}/`);
}

// Apaga do Blob; caminhos antigos (Supabase) e arquivos de demonstração ficam como estão.
// No driver local, apaga só os arquivos locais e nunca chama o Blob.
export async function removeFiles(paths: (string | null | undefined)[]) {
  if (storageDriver() === "local") {
    for (const p of paths) {
      const parts = typeof p === "string" && isLocalUrl(p) ? localUrlSegments(p) : null;
      const file = parts && localFile(parts);
      if (file) await unlink(file).catch(() => undefined);
    }
    return;
  }
  const urls = paths.filter((p): p is string => !!p && isBlobUrl(p));
  if (!urls.length || !storageEnabled()) return;
  await fetch(`${API}/delete`, {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({ urls }),
  }).catch(() => undefined);
}

// ---------- driver local (teste e Docker) ----------

const LOCAL_PREFIX = "/api/arquivos-locais/";
const LOCAL_TYPES: Record<string, string> = { webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };

const isLocalUrl = (p: string) => p.startsWith(LOCAL_PREFIX);

// O comentário evita que o Turbopack rastreie o projeto inteiro por causa do process.cwd().
const localRoot = () => path.resolve(process.env.LOCAL_BLOB_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), ".local-blob"));

// Cada pedaço do caminho: não vazio, sem "." nem "..", sem barra, contrabarra, "%", "?", "#" ou NUL.
const safeSegment = (s: string) => s !== "." && s !== ".." && /^[^/\\%?#\0]+$/.test(s);

// Arquivo dentro da raiz local, ou null se o caminho tentar sair dela.
function localFile(parts: string[]): string | null {
  if (!parts.length || !parts.every(safeSegment)) return null;
  const root = localRoot();
  const file = path.resolve(root, ...parts);
  return file.startsWith(root + path.sep) ? file : null;
}

function localUrlSegments(url: string): string[] | null {
  try {
    const parts = url.slice(LOCAL_PREFIX.length).split("/").map(decodeURIComponent);
    return parts.every(safeSegment) ? parts : null;
  } catch {
    return null;
  }
}

async function putLocal(pathname: string, body: ArrayBuffer): Promise<string> {
  const parts = pathname.split("/");
  const file = localFile(parts);
  if (!file) throw new Error("arquivo local: caminho inválido");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, new Uint8Array(body));
  return LOCAL_PREFIX + parts.map(encodeURIComponent).join("/");
}

// Para a rota /api/arquivos-locais: só fotos (webp, jpg, png) dentro da raiz local.
export async function readLocalFile(parts: string[]): Promise<{ body: Uint8Array<ArrayBuffer>; type: string } | null> {
  const file = localFile(parts);
  const type = LOCAL_TYPES[path.extname(parts[parts.length - 1] ?? "").slice(1).toLowerCase()];
  if (!file || !type) return null;
  try {
    return { body: new Uint8Array(await readFile(file)), type };
  } catch {
    return null;
  }
}
