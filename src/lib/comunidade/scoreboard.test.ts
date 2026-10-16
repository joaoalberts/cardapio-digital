import { describe, expect, it } from "vitest";
import type { OrderRow } from "@/lib/orders/service";
import type { PricedLine } from "@/lib/orders/pricing";
import { scoreboard } from "./scoreboard";
import type { TallyRow } from "./types";

// Dia da Comunidade de 16/10 em São Paulo com day_start 05:00: 08:00Z do dia 16 às 08:00Z do 17.
const BOUNDS = { from: new Date("2026-10-16T08:00:00Z"), to: new Date("2026-10-17T08:00:00Z") };
const P = "5eed0000-c0de-4000-8000-000000000001";
const M = "5eed0000-c0de-4000-8000-000000000011";

let n = 0;
const line = (unit: number, qty = 1, origin?: PricedLine["origin"], ref?: string): PricedLine => ({
  item_id: `item-${++n}`,
  name: "Prato",
  half_item_id: null,
  half_name: null,
  option: null,
  qty,
  unit_cents: unit,
  note: "",
  ...(origin ? { origin, origin_ref: ref } : {}),
});
const order = (lines: PricedLine[], over: Partial<OrderRow> = {}): OrderRow => ({
  id: `o-${++n}`,
  restaurant_id: "r1",
  table_id: "t1",
  table_label: "Mesa 1",
  status: "new",
  open: true,
  lines,
  total_cents: (lines ?? []).reduce((s, l) => s + l.unit_cents * l.qty, 0),
  device_id: "d1",
  client_ref: `ref-${n}`,
  created_at: "2026-10-16T23:00:00.000Z",
  status_at: null,
  ...over,
});
const tally = (over: Partial<TallyRow>): TallyRow => ({
  id: `t-${++n}`,
  restaurant_id: "r1",
  day: "2026-10-16",
  counts: {},
  tables_qr: [],
  tables_open: [],
  created_at: "2026-10-16T23:00:00.000Z",
  ...over,
});

// 3 pedidos com uma linha atribuída cada (R$ 30, R$ 20 e 2× R$ 10) e 1 sem origem.
const exact = () => [
  order([line(3000, 1, "comunidade_palco", P), line(5000)]),
  order([line(2000, 1, "comunidade_mural", M)]),
  order([line(1000, 2, "comunidade_palco", P)]),
  order([line(4000)]),
];

describe("scoreboard", () => {
  it("placar exato: conta pedidos, linhas e valor só das linhas da Comunidade", () => {
    const s = scoreboard(exact(), [], BOUNDS);
    expect({ orders: s.orders, lines: s.lines, cents: s.cents }).toEqual({ orders: 3, lines: 3, cents: 7000 });
  });

  it("pedido descartado com linha atribuída não conta", () => {
    const rows = [...exact(), order([line(9900, 1, "comunidade_mural", M)], { discarded: true, open: false, status: "delivered" })];
    const s = scoreboard(rows, [], BOUNDS);
    expect({ orders: s.orders, lines: s.lines, cents: s.cents }).toEqual({ orders: 3, lines: 3, cents: 7000 });
  });

  it("pedido fora do dia não conta (from entra, to não)", () => {
    const rows = [
      order([line(1000, 1, "comunidade_palco", P)], { created_at: "2026-10-16T07:59:59.000Z" }),
      order([line(1000, 1, "comunidade_palco", P)], { created_at: "2026-10-17T08:00:00.000Z" }),
      order([line(500, 1, "comunidade_palco", P)], { created_at: "2026-10-16T08:00:00.000Z" }),
    ];
    const s = scoreboard(rows, [], BOUNDS);
    expect({ orders: s.orders, lines: s.lines, cents: s.cents }).toEqual({ orders: 1, lines: 1, cents: 500 });
  });

  it("lê a data no formato do NocoDB e ignora data ilegível", () => {
    const rows = [
      order([line(1500, 1, "comunidade_mural", M)], { created_at: "2026-10-16 23:10:00+00:00" }),
      order([line(1500, 1, "comunidade_mural", M)], { created_at: "ontem" }),
    ];
    expect(scoreboard(rows, [], BOUNDS).cents).toBe(1500);
  });

  it("origem desconhecida, linhas ausentes e quantidade inválida não somam", () => {
    const odd = { ...line(1000, 1), origin: "outra" } as unknown as PricedLine;
    const rows = [
      order([odd]),
      order(null as unknown as PricedLine[]),
      order([{ ...line(1000, 1, "comunidade_palco", P), qty: Number.NaN }]),
    ];
    const s = scoreboard(rows, [], BOUNDS);
    expect({ orders: s.orders, lines: s.lines, cents: s.cents }).toEqual({ orders: 0, lines: 0, cents: 0 });
  });

  it("mesas: união das listas do dia, sem repetir", () => {
    const tallies = [
      tally({ tables_qr: ["t1", "t2"], tables_open: ["t1"] }),
      tally({ tables_qr: ["t2", "t3"], tables_open: ["t3"] }),
      tally({ tables_qr: ["t4"], tables_open: [] }),
    ];
    expect(scoreboard([], tallies, BOUNDS).tables).toEqual({ qr: 4, open: 2, pct: 50 });
  });

  it("mesas: sem QR lido dá 0% e nunca passa de 100%", () => {
    expect(scoreboard([], [], BOUNDS).tables).toEqual({ qr: 0, open: 0, pct: 0 });
    const t = scoreboard([], [tally({ tables_qr: ["t1"], tables_open: ["t1", "t2"] })], BOUNDS).tables;
    expect(t).toEqual({ qr: 1, open: 2, pct: 100 });
  });

  it("funil: soma cada contador das linhas do tally, com todas as chaves", () => {
    const tallies = [
      tally({ counts: { balloon_seen: 30, open: 9, vote: 7, buy_tap: 3, share: 1, ref_story: 2, ref_telao: 5, qr: 12 } }),
      tally({ counts: { balloon_seen: 10, open: 1, vote: 2 } }),
      tally({ counts: { buy_tap: 4, estranho: 99, share: "x" } as unknown as TallyRow["counts"] }),
      tally({ counts: null as unknown as TallyRow["counts"] }),
    ];
    expect(scoreboard([], tallies, BOUNDS).funnel).toEqual({
      qr: 12,
      balloon_seen: 40,
      open: 10,
      vote: 9,
      buy_tap: 7,
      share: 1,
      ref_story: 2,
      ref_telao: 5,
    });
  });
});
