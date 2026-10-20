// Limpeza diária das TVs (cron em /api/cron/diario): sai a TV pendente (sem paired_at, não revogada)
// cujo código de conexão já venceu. TV conectada ou revogada nunca sai por aqui.
// Data vazia ou ilegível nunca conta como vencida: na dúvida, a linha fica.
import type { TvRow } from "./types";

// "AAAA-MM-DDTHH:MM[:SS[.mmm]]" com fuso; o NocoDB devolve "AAAA-MM-DD HH:MM:SS+00:00".
const ISO_DATE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/;

// Data do banco em ms; vazia ou ilegível = NaN (e NaN nunca passa na comparação).
function ms(v: unknown): number {
  if (typeof v !== "string" || !ISO_DATE.test(v.trim())) return NaN;
  return Date.parse(v.trim().replace(" ", "T"));
}

export function expiredPendingTvs(tvs: TvRow[], now: Date): string[] {
  const t = now.getTime();
  return tvs.filter((tv) => !tv.paired_at && tv.revoked !== true && ms(tv.pair_expires_at) <= t).map((tv) => tv.id);
}

export type TvSweepDb = {
  list<T>(t: "community_tvs", w: Record<string, never>): Promise<T[]>;
  removeIds(t: "community_tvs", ids: number[]): Promise<void>;
};

// Uma consulta pela tabela inteira e um removeIds (o nocodb.ts manda em lotes de 100). Só linhas com
// uid e o Id do NocoDB (é por ele que se apaga).
export async function sweepPendingTvs(d: { db: TvSweepDb; now?: () => Date }): Promise<number> {
  const rows = (await d.db.list<Record<string, unknown>>("community_tvs", {})).filter(
    (r) => typeof r.id === "string" && !!r.id && typeof r.Id === "number" && Number.isInteger(r.Id),
  ) as (TvRow & { Id: number })[];
  const gone = new Set(expiredPendingTvs(rows, d.now?.() ?? new Date()));
  const ids = rows.filter((r) => gone.has(r.id)).map((r) => r.Id);
  if (ids.length) await d.db.removeIds("community_tvs", ids);
  return ids.length;
}
