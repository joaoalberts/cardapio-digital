// Contador de chamadas ao NocoDB, só para medir o orçamento de pedidos em teste local.
// Liga com NOCODB_COUNT=1; sem a variável, não conta e não
// cria nada no globalThis. A conta fica no globalThis porque o Next carrega nocodb.ts em
// mais de um pacote do servidor (rotas, páginas, "use cache"), todos no mesmo processo.
// A leitura sai só em GET /api/arquivos-locais/_calls, que só existe com STORAGE_DRIVER=local.

export const COUNTER_KEY = "__nocodbCalls";

export type CallCounts = { total: number; byKey: Record<string, number>; since: string };

type WithCounter = typeof globalThis & { [COUNTER_KEY]?: CallCounts };

const on = () => process.env.NOCODB_COUNT === "1";

/** Soma 1 pedido HTTP ao NocoDB, por método + tabela ("GET items"). */
export function countCall(method: string, table: string) {
  if (!on()) return;
  const g = globalThis as WithCounter;
  const c = (g[COUNTER_KEY] ??= { total: 0, byKey: {}, since: new Date().toISOString() });
  const key = `${method} ${table}`;
  c.total += 1;
  c.byKey[key] = (c.byKey[key] ?? 0) + 1;
}

/** Cópia da conta (zero se nada foi contado); null sem NOCODB_COUNT=1. */
export function readCalls(): CallCounts | null {
  if (!on()) return null;
  const c = (globalThis as WithCounter)[COUNTER_KEY];
  return c ? { total: c.total, byKey: { ...c.byKey }, since: c.since } : { total: 0, byKey: {}, since: new Date().toISOString() };
}
