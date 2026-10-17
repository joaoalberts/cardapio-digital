// Institucionais guardados na TV (Cache API "apareca-casa-v1"): tocam do aparelho, sem gastar
// entrega do Mux a cada volta, e continuam tocando com a rede fora. A Cache API só existe em
// contexto seguro (https ou localhost); numa TV aberta por http://<IP> as funções viram atalho
// para a URL do Mux, sem erro.
import type { HouseClip } from "@/lib/apareca/schedule";

export const HOUSE_CACHE = "apareca-casa-v1";

const cacheApi = (): CacheStorage | null => {
  try {
    return typeof caches !== "undefined" ? caches : null;
  } catch {
    return null;
  }
};

let running: Promise<void> | null = null;
let queued: { clips: HouseClip[]; mp4: (id: string) => string } | null = null;

/**
 * Deixa no cache exatamente os MP4 dos institucionais do programa: apaga o que saiu e baixa o que
 * falta, um por vez (não disputa banda com o vídeo que está tocando). Chamadas durante uma rodada
 * viram uma só, com a lista mais nova. Nunca lança.
 */
export function cacheHouse(clips: HouseClip[], mp4: (id: string) => string): Promise<void> {
  queued = { clips, mp4 };
  if (!running) {
    running = (async () => {
      while (queued) {
        const job = queued;
        queued = null;
        await syncOnce(job.clips, job.mp4).catch(() => {});
      }
      running = null;
    })();
  }
  return running;
}

async function syncOnce(clips: HouseClip[], mp4: (id: string) => string): Promise<void> {
  const api = cacheApi();
  if (!api) return;
  const cache = await api.open(HOUSE_CACHE);
  const want = new Set(clips.map((c) => mp4(c.playback)));
  for (const req of await cache.keys()) if (!want.has(req.url)) await cache.delete(req);
  for (const url of want) {
    if (queued) return; // chegou uma lista mais nova: recomeça com ela
    if (await cache.match(url)) continue;
    try {
      const r = await fetch(url, { mode: "cors", cache: "no-store" });
      // Só resposta inteira (200) e legível; 206 ou opaca não servem para tocar do cache.
      if (r.status === 200 && r.type !== "opaque") await cache.put(url, r);
    } catch {}
  }
}

/** Apaga os institucionais guardados (Apareça desligado ou sem programa há 10 min). Nunca lança. */
export async function clearHouseCache(): Promise<void> {
  const api = cacheApi();
  queued = null;
  if (!api) return;
  try {
    await api.delete(HOUSE_CACHE);
  } catch {}
}

/**
 * Endereço para tocar um institucional: objectURL do MP4 guardado, ou a URL do Mux quando ainda
 * não está no cache (ou não há Cache API). Quem toca sabe a origem pelo prefixo "blob:" e revoga o
 * objectURL ao trocar de vídeo.
 */
export async function houseSrc(playback: string, mp4: (id: string) => string): Promise<string> {
  const url = mp4(playback);
  const api = cacheApi();
  if (!api) return url;
  try {
    const hit = await (await api.open(HOUSE_CACHE)).match(url);
    if (!hit) return url;
    return URL.createObjectURL(await hit.blob());
  } catch {
    return url;
  }
}
