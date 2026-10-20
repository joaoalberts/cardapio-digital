import type { QueueResult } from "@/app/painel/apareca/actions";
import { tvStatus, type TvStatus } from "./tv-status";

// Tela "Agora": o que o ciclo de 10 s devolve (fila e TVs). Lógica pura; a leitura fica em
// painel/agora/actions.ts (loadAgora) e a tela só desenha.

export type AgoraTv = { id: string; label: string; status: TvStatus };
// queueOk false: a leitura da fila falhou; as TVs continuam valendo e a tela avisa só no bloco de vídeos.
export type AgoraResult = { queue: QueueResult; queueOk: boolean; tvs: AgoraTv[]; aparecaAllowed: boolean };

export const EMPTY_QUEUE: QueueResult = { items: [], newest: null, warn: "ok" };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
// O NocoDB devolve "AAAA-MM-DD HH:MM:SS+00:00"; o T no lugar do espaço vale em qualquer motor.
const at = (v: unknown) => {
  const t = typeof v === "string" && v.trim() ? Date.parse(v.trim().replace(" ", "T")) : NaN;
  return Number.isFinite(t) ? t : null;
};

export function agoraFrom(i: {
  queue: QueueResult | null; tvRows: Record<string, unknown>[]; now: Date; aparecaAllowed: boolean; restaurantId: string;
}): AgoraResult {
  const tvs = i.tvRows
    .flatMap((t) => {
      const id = str(t.id);
      const paired = at(t.paired_at);
      if (!id || t.restaurant_id !== i.restaurantId || paired === null || t.revoked === true) return [];
      return [{ paired, tv: { id, label: str(t.label) ?? "TV", status: tvStatus(str(t.last_seen_at), i.now) } }];
    })
    .sort((a, b) => b.paired - a.paired)
    .map((x) => x.tv);
  return {
    queue: (i.aparecaAllowed && i.queue) || EMPTY_QUEUE,
    queueOk: !i.aparecaAllowed || i.queue !== null,
    tvs,
    aparecaAllowed: i.aparecaAllowed,
  };
}
