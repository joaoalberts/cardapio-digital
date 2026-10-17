// Placar do dia da Comunidade no painel: "pedidos que saíram da Comunidade" e o funil.
// Puro: quem chama lê os pedidos e as linhas do tally do dia e passa os limites do dia
// (dayBounds). Conta só as linhas com origem da Comunidade, e nunca um pedido descartado
// (envio repetido ou oferta perdida). O texto da tela diz "saíram", nunca "gerou".
import type { OrderRow } from "@/lib/orders/service";
import { addDays, dayBounds } from "./clock";
import type { FunnelKey, TallyRow } from "./types";

export const FUNNEL_KEYS: readonly FunnelKey[] = ["qr", "balloon_seen", "open", "vote", "buy_tap", "share", "ref_story", "ref_telao"];
const ORIGINS = new Set(["comunidade_palco", "comunidade_mural"]);

export type Scoreboard = {
  orders: number; // pedidos com pelo menos uma linha da Comunidade
  lines: number; // linhas da Comunidade (cada linha conta 1, qualquer quantidade)
  cents: number; // valor só dessas linhas (preço unitário × quantidade)
  funnel: Record<FunnelKey, number>;
  tables: { qr: number; open: number; pct: number }; // mesas distintas que leram o QR e que abriram
};

// O NocoDB devolve "AAAA-MM-DD HH:MM:SS+00:00"; o T no lugar do espaço vale em qualquer motor.
const ms = (v: unknown) => (typeof v === "string" && v.trim() ? Date.parse(v.trim().replace(" ", "T")) : NaN);
const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : []);

export function scoreboard(orders: OrderRow[], tallies: TallyRow[], bounds: { from: Date; to: Date }): Scoreboard {
  const from = bounds.from.getTime();
  const to = bounds.to.getTime();
  let nOrders = 0;
  let nLines = 0;
  let cents = 0;
  for (const o of orders) {
    if (o.discarded === true) continue;
    const t = ms(o.created_at);
    if (!(t >= from && t < to)) continue;
    let mine = 0;
    for (const l of Array.isArray(o.lines) ? o.lines : []) {
      if (!l || !ORIGINS.has(l.origin as string)) continue;
      const qty = count(l.qty);
      const unit = count(l.unit_cents);
      if (qty === null || unit === null) continue;
      mine++;
      cents += unit * qty;
    }
    if (mine) {
      nOrders++;
      nLines += mine;
    }
  }

  const funnel = Object.fromEntries(FUNNEL_KEYS.map((k) => [k, 0])) as Record<FunnelKey, number>;
  const qr = new Set<string>();
  const open = new Set<string>();
  for (const row of tallies) {
    const c = row.counts && typeof row.counts === "object" ? row.counts : {};
    for (const k of FUNNEL_KEYS) funnel[k] += count(c[k]) ?? 0;
    for (const id of ids(row.tables_qr)) qr.add(id);
    for (const id of ids(row.tables_open)) open.add(id);
  }
  // Uma mesa lembrada no celular pode abrir sem ter lido o QR naquele dia: nunca passa de 100%.
  const pct = qr.size ? Math.min(100, Math.round((open.size * 100) / qr.size)) : 0;

  return { orders: nOrders, lines: nLines, cents, funnel, tables: { qr: qr.size, open: open.size, pct } };
}

// ---------- Metas: vender mais e mais interação (Decisão do João, 16/10) ----------
// Por noite e no acumulado de 4 semanas:
// (a) % das linhas pedidas pelo QR que saíram da Comunidade (meta 5%);
// (b) ticket por mesa = valor dos pedidos não descartados ÷ mesas distintas que pediram,
//     contra a média do mesmo dia da semana nas 4 semanas anteriores (meta +5%). No
//     acumulado, contra as 4 semanas de antes (que têm os mesmos dias da semana);
// (c) interações por mesa = (vote + buy_tap + share) ÷ mesas que leram o QR (meta 1,5).
// Somando noites, as mesas contam por noite (mesa-noite): a mesma mesa em duas noites são
// dois grupos de clientes. A base do ticket é a média ponderada pelas mesas.

export const GOALS = { share: 5, ticket: 5, interactions: 1.5 } as const;

export type NightBounds = { day: string; from: Date; to: Date };
export type NightTotals = { lines: number; communityLines: number; cents: number; tables: number; interactions: number; tablesQr: number };
export type Goals = {
  share: { pct: number | null; goal: number; hit: boolean | null };
  ticket: { cents: number | null; baseline: number | null; delta: number | null; goal: number; hit: boolean | null };
  interactions: { perTable: number | null; goal: number; hit: boolean | null };
};

// As noites que as metas usam, a partir do dia da Comunidade de hoje. since = início da
// noite mais antiga (o que o painel precisa ler de pedidos).
export function goalNights(today: string, timezone: string, dayStart: string) {
  const b = (day: string): NightBounds => ({ day, ...dayBounds(day, timezone, dayStart) });
  const range = (start: number, n: number) => Array.from({ length: n }, (_, k) => b(addDays(today, -(start + k))));
  const prevMonth = range(28, 28);
  return {
    tonight: b(today),
    sameWeekday: [7, 14, 21, 28].map((k) => b(addDays(today, -k))),
    month: range(0, 28),
    prevMonth,
    since: prevMonth[27].from,
  };
}

// Totais de uma noite. Linhas contam 1 cada (qualquer quantidade), como no placar; o valor é
// o total do pedido (sem total, a soma das linhas).
export function nightTotals(orders: OrderRow[], tallies: TallyRow[], night: NightBounds): NightTotals {
  const from = night.from.getTime();
  const to = night.to.getTime();
  let lines = 0;
  let communityLines = 0;
  let cents = 0;
  const tables = new Set<string>();
  for (const o of orders) {
    if (o.discarded === true) continue;
    const t = ms(o.created_at);
    if (!(t >= from && t < to)) continue;
    const ls = Array.isArray(o.lines) ? o.lines.filter(Boolean) : [];
    lines += ls.length;
    communityLines += ls.filter((l) => ORIGINS.has(l.origin as string)).length;
    const total = count(o.total_cents);
    cents += total ?? ls.reduce((sum, l) => sum + (count(l.unit_cents) ?? 0) * (count(l.qty) ?? 0), 0);
    if (typeof o.table_id === "string" && o.table_id) tables.add(o.table_id);
  }
  let interactions = 0;
  const qr = new Set<string>();
  for (const row of tallies) {
    if (row.day !== night.day) continue;
    const c = row.counts && typeof row.counts === "object" ? row.counts : {};
    interactions += (count(c.vote) ?? 0) + (count(c.buy_tap) ?? 0) + (count(c.share) ?? 0);
    for (const id of ids(row.tables_qr)) qr.add(id);
  }
  return { lines, communityLines, cents, tables: tables.size, interactions, tablesQr: qr.size };
}

const sum = (ns: NightTotals[], k: keyof NightTotals) => ns.reduce((a, n) => a + n[k], 0);

export function goalsFor(current: NightTotals[], baseline: NightTotals[]): Goals {
  const lines = sum(current, "lines");
  const pct = lines ? (sum(current, "communityLines") * 100) / lines : null;
  const tables = sum(current, "tables");
  const cents = tables ? sum(current, "cents") / tables : null;
  const baseTables = sum(baseline, "tables");
  const base = baseTables ? sum(baseline, "cents") / baseTables : null;
  const delta = cents !== null && base ? ((sum(current, "cents") * baseTables - sum(baseline, "cents") * tables) * 100) / (sum(baseline, "cents") * tables) : null;
  const qr = sum(current, "tablesQr");
  const perTable = qr ? sum(current, "interactions") / qr : null;
  return {
    share: { pct, goal: GOALS.share, hit: pct === null ? null : pct >= GOALS.share },
    ticket: { cents, baseline: base, delta, goal: GOALS.ticket, hit: delta === null ? null : delta >= GOALS.ticket },
    interactions: { perTable, goal: GOALS.interactions, hit: perTable === null ? null : perTable >= GOALS.interactions },
  };
}

export function salesGoals(orders: OrderRow[], tallies: TallyRow[], n: ReturnType<typeof goalNights>): { night: Goals; month: Goals } {
  const totals = (bs: NightBounds[]) => bs.map((b) => nightTotals(orders, tallies, b));
  return {
    night: goalsFor(totals([n.tonight]), totals(n.sameWeekday)),
    month: goalsFor(totals(n.month), totals(n.prevMonth)),
  };
}

// O painel lê os pedidos e o funil uma vez só, dos mais novos aos mais velhos, com teto
// (uma consulta por dia das 56 noites custaria 56 chamadas ao NocoDB ou mais; Decisão da
// revisão dos achados baixos, 16/10). Quando o teto corta o período das metas, devolve a
// primeira noite contada inteira ("AAAA-MM-DD"), para o painel avisar; senão, null.
export function goalsCut(
  read: { orders: OrderRow[]; ordersCap: number; tallies: TallyRow[]; tallyCap: number },
  n: ReturnType<typeof goalNights>,
): string | null {
  const nights = [...n.prevMonth, ...n.month].sort((a, b) => a.from.getTime() - b.from.getTime());
  const first = nights[0];
  let cut: string | null = null;
  const later = (day: string | undefined) => {
    if (day && (!cut || day > cut)) cut = day;
  };
  if (read.orders.length >= read.ordersCap) {
    const oldest = Math.min(...read.orders.map((o) => ms(o.created_at)).filter(Number.isFinite));
    // A noite da linha mais velha pode ter ficado pela metade: conta inteira a partir da seguinte.
    if (Number.isFinite(oldest) && oldest > first.from.getTime()) later(nights.find((b) => b.from.getTime() > oldest)?.day ?? addDays(n.tonight.day, 1));
  }
  if (read.tallies.length >= read.tallyCap) {
    const days = read.tallies.map((t) => t.day).filter((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    if (days.length && days[0] >= first.day) later(addDays(days[0], 1));
  }
  return cut;
}
