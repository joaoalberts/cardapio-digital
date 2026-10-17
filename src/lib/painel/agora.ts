import type { QueueResult } from "@/app/painel/apareca/actions";
import { questionText } from "@/lib/comunidade/client-logic";
import { pollPhase } from "@/lib/comunidade/clock";
import { parseResult } from "@/lib/comunidade/public-state";
import type { PollRow } from "@/lib/comunidade/types";
import { tvStatus, type TvStatus } from "./tv-status";

// Tela "Agora": o que o ciclo de 10 s devolve (fila, enquete no ar e TVs). Lógica pura; a leitura fica em
// painel/agora/actions.ts (loadAgora) e a tela só desenha.

export type AgoraPoll = { id: string; question: string; votes: number | null; endsAt: string };
export type AgoraTv = { id: string; label: string; status: TvStatus };
export type AgoraResult = {
  queue: QueueResult; poll: AgoraPoll | null; tvs: AgoraTv[]; communityOn: boolean; aparecaAllowed: boolean;
};

export const EMPTY_QUEUE: QueueResult = { items: [], newest: null, warn: "ok" };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
// O NocoDB devolve "AAAA-MM-DD HH:MM:SS+00:00"; o T no lugar do espaço vale em qualquer motor.
const at = (v: unknown) => {
  const t = typeof v === "string" && v.trim() ? Date.parse(v.trim().replace(" ", "T")) : NaN;
  return Number.isFinite(t) ? t : null;
};

// O result gravado pelo cron só traz porcentagens: diz "ninguém votou" (0), mas não quantos votaram.
// Sem número confiável fica null e a tela não mostra o total.
function votesOf(p: PollRow): number | null {
  const r = parseResult(p.result, p.options.map((o) => o.id));
  return r && !r.has_votes ? 0 : null;
}

export function agoraFrom(i: {
  queue: QueueResult; pollRows: PollRow[]; tvRows: Record<string, unknown>[]; now: Date; communityOn: boolean; aparecaAllowed: boolean;
  restaurantId: string;
}): AgoraResult {
  // A casa não agenda duas ao mesmo tempo (pollOverlap); se houver, vale a que abriu primeiro.
  const open = i.pollRows
    .filter((p) => p.restaurant_id === i.restaurantId && pollPhase(p, i.now) === "open")
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0];
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
    queue: i.aparecaAllowed ? i.queue : EMPTY_QUEUE,
    poll: open ? { id: open.id, question: questionText(open, "pt-BR"), votes: votesOf(open), endsAt: open.ends_at } : null,
    tvs,
    communityOn: i.communityOn,
    aparecaAllowed: i.aparecaAllowed,
  };
}
