import { describe, expect, it } from "vitest";
import type { OrderRow } from "@/lib/orders/service";
import type { PricedLine } from "@/lib/orders/pricing";
import { GOALS, goalNights, goalsCut, goalsFor, nightTotals, salesGoals, scoreboard } from "./scoreboard";
import type { TallyRow } from "./types";

// Dia da Comunidade de 16/10 em São Paulo com day_start 05:00: 08:00Z do dia 16 às 08:00Z do 17.
const BOUNDS = { from: new Date("2026-10-16T08:00:00Z"), to: new Date("2026-10-17T08:00:00Z") };
const P = "5eed0000-c0de-4000-8000-000000000001";
const M = "5eed0000-c0de-4000-8000-000000000011";

let n = 0;
const line = (unit: number, qty = 1, origin?: PricedLine["origin"], ref?: string): PricedLine => ({
  item_id: `item-${++n}`,
  name: "Prato",
  dough: null,
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

// ---------- Metas de venda e interação (Decisão do João, 16/10) ----------

const TZ = "America/Sao_Paulo";
const night = (day: string) => {
  // dia D em São Paulo com virada às 05:00 = 08:00Z de D a 08:00Z de D+1
  const from = new Date(`${day}T08:00:00Z`);
  return { day, from, to: new Date(from.getTime() + 24 * 3600_000) };
};
const at = (day: string, hhmmZ = "23:00") => `${day}T${hhmmZ}:00.000Z`;

describe("goalNights", () => {
  it("hoje, os 4 mesmos dias da semana anteriores, as 4 semanas até hoje e as 4 de antes", () => {
    const g = goalNights("2026-10-16", TZ, "05:00");
    expect(g.tonight).toEqual(night("2026-10-16"));
    expect(g.sameWeekday.map((b) => b.day)).toEqual(["2026-10-09", "2026-10-02", "2026-09-25", "2026-09-18"]);
    expect(g.month).toHaveLength(28);
    expect(g.month[0].day).toBe("2026-10-16");
    expect(g.month[27].day).toBe("2026-09-19");
    expect(g.prevMonth).toHaveLength(28);
    expect(g.prevMonth[0].day).toBe("2026-09-18");
    expect(g.prevMonth[27].day).toBe("2026-08-22");
    expect(g.since).toEqual(g.prevMonth[27].from);
  });
});

describe("nightTotals", () => {
  it("linhas, linhas da Comunidade, valor dos pedidos não descartados e mesas distintas da noite", () => {
    const orders = [
      order([line(3000, 1, "comunidade_palco", P), line(5000)], { table_id: "t1", created_at: at("2026-10-16") }),
      order([line(2000, 3)], { table_id: "t1", created_at: at("2026-10-16") }),
      order([line(4000)], { table_id: "t2", created_at: "2026-10-17T07:59:59.000Z" }),
      order([line(9000)], { table_id: "t3", created_at: at("2026-10-16"), discarded: true }), // fora
      order([line(9000)], { table_id: "t4", created_at: "2026-10-17T08:00:00.000Z" }), // já é amanhã
      order([line(9000)], { table_id: "t5", created_at: "2026-10-16T07:59:59.000Z" }), // ainda é ontem
    ];
    const tallies = [
      tally({ day: "2026-10-16", counts: { vote: 5, buy_tap: 3, share: 1, open: 40 }, tables_qr: ["q1", "q2"] }),
      tally({ day: "2026-10-16", counts: { vote: 1 }, tables_qr: ["q2", "q3"] }),
      tally({ day: "2026-10-15", counts: { vote: 50 }, tables_qr: ["q9"] }),
    ];
    expect(nightTotals(orders, tallies, night("2026-10-16"))).toEqual({
      lines: 4,
      communityLines: 1,
      cents: 3000 + 5000 + 6000 + 4000,
      tables: 2,
      interactions: 10,
      tablesQr: 3,
    });
  });
});

describe("goalsFor", () => {
  const n = (o: Partial<ReturnType<typeof nightTotals>>) => ({ lines: 0, communityLines: 0, cents: 0, tables: 0, interactions: 0, tablesQr: 0, ...o });

  it("as metas são 5% das linhas, +5% de ticket por mesa e 1,5 interação por mesa", () => {
    expect(GOALS).toEqual({ share: 5, ticket: 5, interactions: 1.5 });
  });

  it("valores exatos e o atingiu/não atingiu na beira de cada meta", () => {
    // 1 de 20 linhas = 5% (atingiu); ticket 10.500 contra 10.000 = +5% (atingiu); 3 ÷ 2 = 1,5 (atingiu).
    const hit = goalsFor([n({ lines: 20, communityLines: 1, cents: 21_000, tables: 2, interactions: 3, tablesQr: 2 })], [n({ cents: 40_000, tables: 4 })]);
    expect(hit).toEqual({
      share: { pct: 5, goal: 5, hit: true },
      ticket: { cents: 10_500, baseline: 10_000, delta: 5, goal: 5, hit: true },
      interactions: { perTable: 1.5, goal: 1.5, hit: true },
    });
    // Logo abaixo: 1 de 21 linhas, ticket 10.400, 2 ÷ 2 = 1.
    const miss = goalsFor([n({ lines: 21, communityLines: 1, cents: 20_800, tables: 2, interactions: 2, tablesQr: 2 })], [n({ cents: 40_000, tables: 4 })]);
    expect(miss.share.hit).toBe(false);
    expect(miss.share.pct).toBeCloseTo(4.7619, 3);
    expect(miss.ticket).toEqual({ cents: 10_400, baseline: 10_000, delta: 4, goal: 5, hit: false });
    expect(miss.interactions).toEqual({ perTable: 1, goal: 1.5, hit: false });
  });

  it("soma as noites: ticket = valor ÷ mesas-noite; a base é a média ponderada das noites de comparação", () => {
    const g = goalsFor(
      [n({ lines: 10, communityLines: 2, cents: 30_000, tables: 3, interactions: 4, tablesQr: 2 }), n({ lines: 10, cents: 10_000, tables: 1, tablesQr: 2 })],
      [n({ cents: 20_000, tables: 2 }), n({ cents: 0, tables: 0 }), n({ cents: 30_000, tables: 3 })],
    );
    expect(g.share.pct).toBe(10);
    expect(g.ticket).toEqual({ cents: 10_000, baseline: 10_000, delta: 0, goal: 5, hit: false });
    expect(g.interactions.perTable).toBe(1);
  });

  it("sem dado não há meta: nada pedido, nenhuma base ou nenhuma mesa leu o QR", () => {
    const g = goalsFor([n({})], []);
    expect(g).toEqual({
      share: { pct: null, goal: 5, hit: null },
      ticket: { cents: null, baseline: null, delta: null, goal: 5, hit: null },
      interactions: { perTable: null, goal: 1.5, hit: null },
    });
    const noBase = goalsFor([n({ lines: 1, cents: 5000, tables: 1 })], [n({})]);
    expect(noBase.ticket).toEqual({ cents: 5000, baseline: null, delta: null, goal: 5, hit: null });
  });
});

describe("salesGoals (por noite e acumulado de 4 semanas)", () => {
  it("noite contra os 4 mesmos dias da semana; 4 semanas contra as 4 de antes", () => {
    const orders = [
      // hoje (16/10): R$ 110 em 1 mesa, 1 de 2 linhas da Comunidade
      order([line(10_000), line(1000, 1, "comunidade_mural", M)], { table_id: "t1", created_at: at("2026-10-16") }),
      // 09/10 (mesmo dia da semana): R$ 100 em 1 mesa
      order([line(10_000)], { table_id: "t1", created_at: at("2026-10-09") }),
      // 18/09 (4ª semana antes, e também das 4 semanas de antes do acumulado): R$ 100 em 1 mesa
      order([line(10_000)], { table_id: "t1", created_at: at("2026-09-18") }),
      // 22/08: ainda nas 4 semanas de antes (R$ 40 em 2 mesas)
      order([line(2000)], { table_id: "t1", created_at: at("2026-08-22") }),
      order([line(2000)], { table_id: "t2", created_at: at("2026-08-22") }),
      // 21/08: fora de tudo
      order([line(99_000)], { table_id: "t1", created_at: at("2026-08-21") }),
    ];
    const tallies = [
      tally({ day: "2026-10-16", counts: { vote: 2, share: 1 }, tables_qr: ["q1", "q2"] }),
      tally({ day: "2026-10-10", counts: { buy_tap: 1 }, tables_qr: ["q1"] }),
      tally({ day: "2026-09-18", counts: { vote: 9 }, tables_qr: ["q1"] }), // fora das 4 semanas
    ];
    const g = salesGoals(orders, tallies, goalNights("2026-10-16", TZ, "05:00"));
    expect(g.night).toEqual({
      share: { pct: 50, goal: 5, hit: true },
      ticket: { cents: 11_000, baseline: 10_000, delta: 10, goal: 5, hit: true },
      interactions: { perTable: 1.5, goal: 1.5, hit: true },
    });
    // 4 semanas: 3 linhas (1 da Comunidade), R$ 210 em 2 mesas-noite; antes: R$ 140 em 3 mesas-noite.
    expect(g.month.share.pct).toBeCloseTo(33.333, 2);
    expect(g.month.ticket.cents).toBe(10_500);
    expect(g.month.ticket.baseline).toBeCloseTo(14_000 / 3, 6);
    expect(g.month.ticket.hit).toBe(true);
    expect(g.month.interactions).toEqual({ perTable: 4 / 3, goal: 1.5, hit: false });
  });

  it("ticket por mesa: dois pedidos da mesma mesa contam uma mesa (não uma por pedido)", () => {
    const orders = [
      // hoje: mesa t1 pede 2× (R$ 60 + R$ 60) e t2 1× (R$ 60) = R$ 180 em 2 mesas = R$ 90
      order([line(6000)], { table_id: "t1", created_at: at("2026-10-16", "22:00") }),
      order([line(6000)], { table_id: "t1", created_at: at("2026-10-16", "23:30") }),
      order([line(6000)], { table_id: "t2", created_at: at("2026-10-16") }),
      // 09/10: mesa t1 pede 2× R$ 50 = R$ 100 em 1 mesa
      order([line(5000)], { table_id: "t1", created_at: at("2026-10-09", "22:00") }),
      order([line(5000)], { table_id: "t1", created_at: at("2026-10-09", "23:30") }),
    ];
    const g = salesGoals(orders, [], goalNights("2026-10-16", TZ, "05:00"));
    // Por mesa: R$ 90 contra R$ 100 = -10%, abaixo da meta. Contando por pedido daria
    // R$ 60 contra R$ 50 = +20% e "meta batida".
    expect(g.night.ticket).toEqual({ cents: 9000, baseline: 10_000, delta: -10, goal: 5, hit: false });
  });
});

describe("goalsCut: o painel avisa quando o teto de leitura cortou o período", () => {
  const g = goalNights("2026-10-16", TZ, "05:00"); // de 22/08 a 16/10
  const orders = (oldest: string, k: number) =>
    Array.from({ length: k }, (_, i) => order([line(1000)], { created_at: i === k - 1 ? oldest : "2026-10-16T23:00:00.000Z" }));
  const tallies = (oldestDay: string, k: number) => Array.from({ length: k }, (_, i) => tally({ day: i === k - 1 ? oldestDay : "2026-10-16" }));
  it("abaixo do teto, nada foi cortado", () => {
    expect(goalsCut({ orders: orders("2026-10-01T23:00:00.000Z", 3), ordersCap: 5, tallies: tallies("2026-10-01", 3), tallyCap: 5 }, g)).toBeNull();
  });
  it("no teto, mas a leitura já passou do começo do período: nada cortado", () => {
    expect(goalsCut({ orders: orders("2026-08-20T23:00:00.000Z", 5), ordersCap: 5, tallies: tallies("2026-08-21", 5), tallyCap: 5 }, g)).toBeNull();
  });
  it("pedidos no teto dentro do período: conta completa a partir da noite seguinte à mais velha lida", () => {
    // 01/10 às 20h em São Paulo cai na noite de 01/10; a primeira inteira é a de 02/10
    expect(goalsCut({ orders: orders("2026-10-01T23:00:00.000Z", 5), ordersCap: 5, tallies: [], tallyCap: 5 }, g)).toBe("2026-10-02");
  });
  it("funil no teto dentro do período: a partir do dia seguinte ao mais velho lido; vale o corte mais recente", () => {
    expect(goalsCut({ orders: [], ordersCap: 5, tallies: tallies("2026-09-30", 5), tallyCap: 5 }, g)).toBe("2026-10-01");
    expect(goalsCut({ orders: orders("2026-10-01T23:00:00.000Z", 5), ordersCap: 5, tallies: tallies("2026-10-05", 5), tallyCap: 5 }, g)).toBe("2026-10-06");
  });
});
