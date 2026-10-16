// Funil da Comunidade, em lote. O celular manda contadores (sendBeacon) quando a aba esconde
// e a cada 60 s com a camada aberta; o voto conta "vote" do lado do servidor. Tudo é somado
// num acumulador na memória da instância, por restaurante e dia da Comunidade, e vira uma
// linha em community_tally a cada ≥ 30 s com movimento: nunca 1 insert por toque. Se a
// instância cair, perde-se no máximo 30 s de funil. Evento nunca invalida cache.
import { communityDay } from "./clock";
import type { CommunityHead, FunnelKey, TallyRow } from "./types";
import { communityOff } from "./off";

// Intervalo mínimo entre duas gravações da mesma instância.
export const TALLY_FLUSH_MS = 30_000;
// Teto de cada contador por lote do celular.
export const FUNNEL_MAX = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MESA = /^[A-Z2-9]{6}$/;

type ClientKey = Exclude<FunnelKey, "vote">;
// O que o celular pode contar. "vote" fica de fora: só o servidor o conta, ao gravar um voto novo.
const CLIENT_KEYS: readonly ClientKey[] = ["qr", "balloon_seen", "open", "buy_tap", "share", "ref_story", "ref_telao"];
const ALL_KEYS: readonly FunnelKey[] = [...CLIENT_KEYS, "vote"];

const positiveInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

export type FunnelBatch = { mesa: string | null; device: string; e: Partial<Record<ClientKey, number>> };

// Lote do celular: { mesa, device, e }. Device uuid; mesa no formato do QR ou ausente (quem
// chega pelo telão ou pelo story). Cada contador é um inteiro de 1 a 20 (o que passa vira 20);
// "vote", chaves desconhecidas e valores que não são inteiros positivos são descartados.
export function parseFunnel(body: unknown): FunnelBatch | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.device !== "string" || !UUID.test(b.device)) return null;
  const mesa = b.mesa ?? null;
  if (mesa !== null && (typeof mesa !== "string" || !MESA.test(mesa))) return null;
  if (!b.e || typeof b.e !== "object" || Array.isArray(b.e)) return null;
  const raw = b.e as Record<string, unknown>;
  const e: FunnelBatch["e"] = {};
  for (const k of CLIENT_KEYS) {
    const v = raw[k];
    if (positiveInt(v)) e[k] = Math.min(v, FUNNEL_MAX);
  }
  return { mesa, device: b.device, e };
}

export type TallyInput = Omit<TallyRow, "id" | "created_at">;
export type Accumulator = {
  add(rid: string, day: string, counts: TallyInput["counts"], tables: { qr?: string; open?: string }): void;
  drain(force?: boolean): TallyInput[]; // vazio se < TALLY_FLUSH_MS desde a última gravação e !force
};

// Soma por restaurante e dia. As listas de mesas não repetem. O prazo de 30 s conta da última
// gravação (ou da criação): um drain sem nada pendente não adia a próxima.
export function createAccumulator(now: () => number): Accumulator {
  type Entry = { restaurant_id: string; day: string; counts: TallyInput["counts"]; qr: Set<string>; open: Set<string> };
  const pending = new Map<string, Entry>();
  let last = now();
  return {
    add(rid, day, counts, tables) {
      const adds = ALL_KEYS.flatMap((k) => (positiveInt(counts[k]) ? [[k, counts[k]] as const] : []));
      if (!adds.length && !tables.qr && !tables.open) return;
      const key = JSON.stringify([rid, day]);
      let e = pending.get(key);
      if (!e) {
        e = { restaurant_id: rid, day, counts: {}, qr: new Set(), open: new Set() };
        pending.set(key, e);
      }
      for (const [k, v] of adds) e.counts[k] = (e.counts[k] ?? 0) + v;
      if (tables.qr) e.qr.add(tables.qr);
      if (tables.open) e.open.add(tables.open);
    },
    drain(force = false) {
      const t = now();
      if (!pending.size || (!force && t - last < TALLY_FLUSH_MS)) return [];
      const rows = [...pending.values()].map((e) => ({
        restaurant_id: e.restaurant_id,
        day: e.day,
        counts: e.counts,
        tables_qr: [...e.qr],
        tables_open: [...e.open],
      }));
      pending.clear();
      last = t;
      return rows;
    },
  };
}

export type FunnelTable = { id: string; code: string; active: boolean };
export type FunnelDeps = {
  getHead: (slug: string) => Promise<CommunityHead | null>;
  getTables: (rid: string) => Promise<FunnelTable[]>; // mesas do restaurante (em cache)
  insert: (rows: TallyInput[]) => Promise<unknown>;
  acc: Accumulator;
  now?: () => Date;
  off?: () => boolean;
};

// Resolve o restaurante pelo slug e a mesa pela lista dele, soma no acumulador e grava o que
// ele soltar. Desligada (no restaurante ou pela chave geral) ou slug inexistente: ignora.
// "qr" e "open" põem a mesa nas listas só se ela for deste restaurante e estiver ativa; sem
// isso, o "qr" não conta, porque ele é por definição a leitura do QR de uma mesa válida.
export async function recordFunnelWith(
  deps: FunnelDeps,
  slug: string,
  batch: { counts: TallyInput["counts"]; mesa: string | null },
): Promise<void> {
  if ((deps.off ?? communityOff)()) return;
  const head = await deps.getHead(slug);
  if (!head?.enabled) return;

  const counts = { ...batch.counts };
  let table: string | null = null;
  if ((counts.qr || counts.open) && batch.mesa && MESA.test(batch.mesa)) {
    const tables = await deps.getTables(head.id);
    table = tables.find((t) => t.active && t.code === batch.mesa)?.id ?? null;
  }
  if (!table) delete counts.qr;

  const day = communityDay(deps.now?.() ?? new Date(), head.timezone, head.day_start);
  deps.acc.add(head.id, day, counts, {
    qr: table && counts.qr ? table : undefined,
    open: table && counts.open ? table : undefined,
  });
  const rows = deps.acc.drain();
  if (rows.length) await deps.insert(rows);
}

// Um acumulador por processo, guardado no globalThis: se as rotas de voto e de eventos
// carregarem cópias diferentes deste módulo, continuam somando no mesmo lugar.
const SHARED: unique symbol = Symbol.for("cardapio-digital.comunidade.funil");
function sharedAccumulator(): Accumulator {
  const g = globalThis as typeof globalThis & { [SHARED]?: Accumulator };
  return (g[SHARED] ??= createAccumulator(Date.now));
}

// Chamado pelas rotas dentro de after(). O banco e as leituras em cache são importados aqui
// dentro porque são server-only: assim este arquivo continua testável sem o Next. Uma falha
// só perde este lote (no máximo 30 s de funil) e nunca chega ao celular.
export async function recordFunnel(slug: string, batch: { counts: TallyInput["counts"]; mesa: string | null }): Promise<void> {
  try {
    const [server, db] = await Promise.all([import("./server"), import("@/lib/db/nocodb")]);
    await recordFunnelWith(
      {
        getHead: server.getCommunityHead,
        getTables: server.getCommunityTables,
        insert: (rows) => db.insert("community_tally", rows),
        acc: sharedAccumulator(),
      },
      slug,
      batch,
    );
  } catch (e) {
    console.error("comunidade funil", String(e).slice(0, 300));
  }
}
