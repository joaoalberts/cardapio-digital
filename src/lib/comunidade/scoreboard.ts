// Placar do dia da Comunidade no painel: "pedidos que saíram da Comunidade" e o funil.
// Puro: quem chama lê os pedidos e as linhas do tally do dia e passa os limites do dia
// (dayBounds). Conta só as linhas com origem da Comunidade, e nunca um pedido descartado
// (envio repetido ou oferta perdida). O texto da tela diz "saíram", nunca "gerou".
import type { OrderRow } from "@/lib/orders/service";
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
