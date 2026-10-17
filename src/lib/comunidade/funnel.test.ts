import { describe, expect, it, vi } from "vitest";
import { FUNNEL_MAX, TALLY_FLUSH_MS, createAccumulator, parseFunnel, recordFunnelWith, type FunnelDeps, type TallyInput } from "./funnel";
import type { CommunityHead } from "./types";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DEV = U(201);
const NOW = new Date("2026-10-16T23:00:00Z"); // sexta, 20:00 em São Paulo
const DAY = "2026-10-16";

const MESA_7 = U(1); // ABC234, r1, ativa
const MESA_8 = U(2); // OFF234, r1, desativada no painel
const MESA_R2 = U(3); // XYZ234, só existe no r2
const MESA_9 = U(4); // DEF234, r1, ativa

describe("parseFunnel", () => {
  it("aceita o lote do celular", () => {
    expect(parseFunnel({ mesa: "ABC234", device: DEV, e: { qr: 1, open: 2, balloon_seen: 3 } })).toEqual({
      mesa: "ABC234",
      device: DEV,
      e: { qr: 1, open: 2, balloon_seen: 3 },
    });
  });

  it("sem mesa (chegada pelo telão ou pelo story): mesa null", () => {
    expect(parseFunnel({ mesa: null, device: DEV, e: { ref_telao: 1 } })).toEqual({ mesa: null, device: DEV, e: { ref_telao: 1 } });
    expect(parseFunnel({ device: DEV, e: { ref_story: 1 } })).toEqual({ mesa: null, device: DEV, e: { ref_story: 1 } });
  });

  it(`corta cada contador em ${FUNNEL_MAX}`, () => {
    expect(FUNNEL_MAX).toBe(20);
    expect(parseFunnel({ mesa: null, device: DEV, e: { balloon_seen: 25, share: 20, buy_tap: 1_000_000 } })?.e).toEqual({
      balloon_seen: 20,
      share: 20,
      buy_tap: 20,
    });
  });

  it("descarta vote (só o servidor conta) e chaves desconhecidas", () => {
    const e = JSON.parse('{"vote":3,"open":1,"hack":5,"__proto__":{"qr":9},"constructor":2,"toString":1}');
    expect(parseFunnel({ mesa: null, device: DEV, e })?.e).toEqual({ open: 1 });
  });

  it("descarta contador que não é inteiro de 1 a 20 (zero não vira chave)", () => {
    const e = { open: -1, share: "3", buy_tap: Number.NaN, qr: 0, ref_story: 1.5, ref_telao: Number.POSITIVE_INFINITY, balloon_seen: 2 };
    expect(parseFunnel({ mesa: null, device: DEV, e })?.e).toEqual({ balloon_seen: 2 });
  });

  it("recusa device que não é uuid, mesa malformada e lote sem e", () => {
    const ok = { mesa: "ABC234", device: DEV, e: { open: 1 } };
    const bad = [
      null,
      "texto",
      [],
      {},
      { ...ok, device: "nao-e-uuid" },
      { ...ok, device: "ABCDEF00-0000-4000-8000-000000000201" },
      { ...ok, device: undefined },
      { ...ok, mesa: "abc234" },
      { ...ok, mesa: "ABC23" },
      { ...ok, mesa: "ABC2341" },
      { ...ok, mesa: 123456 },
      { ...ok, e: undefined },
      { ...ok, e: null },
      { ...ok, e: [1, 2] },
      { ...ok, e: "open" },
    ];
    for (const b of bad) expect(parseFunnel(b)).toBeNull();
  });
});

describe("createAccumulator", () => {
  const clock = () => {
    const c = { t: 0 };
    return { c, now: () => c.t };
  };

  it("soma dois lotes no mesmo restaurante e dia", () => {
    const { c, now } = clock();
    const acc = createAccumulator(now);
    acc.add("r1", DAY, { open: 1, share: 2 }, {});
    acc.add("r1", DAY, { open: 3, vote: 1 }, {});
    c.t = TALLY_FLUSH_MS;
    expect(acc.drain()).toEqual([{ restaurant_id: "r1", day: DAY, counts: { open: 4, share: 2, vote: 1 }, tables_qr: [], tables_open: [] }]);
  });

  it("tables_qr e tables_open sem repetição", () => {
    const acc = createAccumulator(() => 0);
    acc.add("r1", DAY, { qr: 1 }, { qr: MESA_7 });
    acc.add("r1", DAY, { qr: 1 }, { qr: MESA_7 });
    acc.add("r1", DAY, { qr: 1, open: 1 }, { qr: MESA_9, open: MESA_7 });
    acc.add("r1", DAY, { open: 1 }, { open: MESA_7 });
    expect(acc.drain(true)).toEqual([
      { restaurant_id: "r1", day: DAY, counts: { qr: 3, open: 2 }, tables_qr: [MESA_7, MESA_9], tables_open: [MESA_7] },
    ]);
  });

  it("drain antes de 30 s devolve []; depois, 1 linha por restaurante e dia, e a seguinte volta vazia", () => {
    expect(TALLY_FLUSH_MS).toBe(30_000);
    const { c, now } = clock();
    const acc = createAccumulator(now);
    acc.add("r1", DAY, { open: 1 }, {});
    acc.add("r1", "2026-10-17", { open: 1 }, {});
    acc.add("r2", DAY, { share: 1 }, {});
    acc.add("r1", DAY, { buy_tap: 1 }, {});
    c.t = TALLY_FLUSH_MS - 1;
    expect(acc.drain()).toEqual([]);
    c.t = TALLY_FLUSH_MS;
    const rows = acc.drain();
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(
      expect.arrayContaining([
        { restaurant_id: "r1", day: DAY, counts: { open: 1, buy_tap: 1 }, tables_qr: [], tables_open: [] },
        { restaurant_id: "r1", day: "2026-10-17", counts: { open: 1 }, tables_qr: [], tables_open: [] },
        { restaurant_id: "r2", day: DAY, counts: { share: 1 }, tables_qr: [], tables_open: [] },
      ]),
    );
    expect(acc.drain()).toEqual([]);

    // O prazo conta a partir da última gravação.
    c.t = TALLY_FLUSH_MS + 1;
    acc.add("r1", DAY, { open: 1 }, {});
    expect(acc.drain()).toEqual([]);
    c.t = 2 * TALLY_FLUSH_MS - 1;
    expect(acc.drain()).toEqual([]);
    c.t = 2 * TALLY_FLUSH_MS;
    expect(acc.drain()).toHaveLength(1);
  });

  it("drain(true) força a gravação antes dos 30 s", () => {
    const acc = createAccumulator(() => 1);
    acc.add("r1", DAY, { share: 1 }, {});
    expect(acc.drain(true)).toEqual([{ restaurant_id: "r1", day: DAY, counts: { share: 1 }, tables_qr: [], tables_open: [] }]);
    expect(acc.drain(true)).toEqual([]);
  });

  it("lote sem contador nem mesa não vira linha, e drain vazio não adia a próxima gravação", () => {
    const { c, now } = clock();
    const acc = createAccumulator(now);
    acc.add("r1", DAY, {}, {});
    acc.add("r1", DAY, { open: 0, share: -2, buy_tap: Number.NaN }, {});
    c.t = TALLY_FLUSH_MS;
    expect(acc.drain()).toEqual([]);
    c.t = TALLY_FLUSH_MS + 1;
    acc.add("r1", DAY, { open: 1 }, {});
    expect(acc.drain()).toHaveLength(1);
  });

  it("mutação: 100 add seguidos em menos de 30 s viram no máximo 1 linha, sem perder contagem", () => {
    const { c, now } = clock();
    const acc = createAccumulator(now);
    const rows: TallyInput[] = [];
    c.t = TALLY_FLUSH_MS;
    for (let i = 0; i < 100; i++) {
      c.t += 200; // 100 toques em 20 s
      acc.add("r1", DAY, { open: 1 }, {});
      rows.push(...acc.drain());
    }
    expect(rows.length).toBeLessThanOrEqual(1);
    rows.push(...acc.drain(true));
    expect(rows.reduce((n, r) => n + (r.counts.open ?? 0), 0)).toBe(100);
  });
});

describe("recordFunnelWith", () => {
  const head = (over: Partial<CommunityHead> = {}): CommunityHead => ({
    id: "r1",
    slug: "forno",
    name: "Forno",
    enabled: true,
    day_start: "05:00",
    timezone: "America/Sao_Paulo",
    opening_hours: null,
    instagram: "@forno",
    logo_path: null,
    brand_color: null,
    tv_simple: false,
    ...over,
  });
  const TABLES: Record<string, { id: string; code: string; active: boolean }[]> = {
    r1: [
      { id: MESA_7, code: "ABC234", active: true },
      { id: MESA_8, code: "OFF234", active: false },
      { id: MESA_9, code: "DEF234", active: true },
    ],
    r2: [{ id: MESA_R2, code: "XYZ234", active: true }],
  };

  function setup(o: { off?: boolean; now?: Date } = {}) {
    const c = { t: 0 };
    const heads: Record<string, CommunityHead> = {
      forno: head(),
      outro: head({ id: "r2", slug: "outro" }),
      desligado: head({ id: "r3", slug: "desligado", enabled: false }),
    };
    const getHead = vi.fn(async (s: string) => heads[s] ?? null);
    const getTables = vi.fn(async (rid: string) => TABLES[rid] ?? []);
    const insert = vi.fn(async (rows: TallyInput[]) => rows);
    const acc = createAccumulator(() => c.t);
    const deps: FunnelDeps = { getHead, getTables, insert, acc, now: () => o.now ?? NOW, off: () => o.off ?? false };
    return { c, deps, acc, getHead, getTables, insert };
  }

  it("qr e open com mesa ativa deste restaurante registram a mesa nas listas", async () => {
    const s = setup();
    await recordFunnelWith(s.deps, "forno", { counts: { qr: 1, open: 1, balloon_seen: 2 }, mesa: "ABC234" });
    await recordFunnelWith(s.deps, "forno", { counts: { qr: 1 }, mesa: "DEF234" });
    expect(s.insert).not.toHaveBeenCalled();
    expect(s.acc.drain(true)).toEqual([
      { restaurant_id: "r1", day: DAY, counts: { qr: 2, open: 1, balloon_seen: 2 }, tables_qr: [MESA_7, MESA_9], tables_open: [MESA_7] },
    ]);
  });

  it("mutação: mesa de outro restaurante ou desativada não entra nas listas, e o qr dela não conta", async () => {
    const s = setup();
    await recordFunnelWith(s.deps, "forno", { counts: { qr: 1, open: 1 }, mesa: "XYZ234" });
    await recordFunnelWith(s.deps, "forno", { counts: { qr: 1, open: 1 }, mesa: "OFF234" });
    await recordFunnelWith(s.deps, "forno", { counts: { qr: 1, open: 1 }, mesa: "NAO234" });
    expect(s.acc.drain(true)).toEqual([{ restaurant_id: "r1", day: DAY, counts: { open: 3 }, tables_qr: [], tables_open: [] }]);
  });

  it("sem mesa e no voto, conta sem consultar as mesas", async () => {
    const s = setup();
    await recordFunnelWith(s.deps, "forno", { counts: { ref_telao: 1, open: 1 }, mesa: null });
    await recordFunnelWith(s.deps, "forno", { counts: { vote: 1 }, mesa: "ABC234" });
    expect(s.getTables).not.toHaveBeenCalled();
    expect(s.acc.drain(true)).toEqual([
      { restaurant_id: "r1", day: DAY, counts: { ref_telao: 1, open: 1, vote: 1 }, tables_qr: [], tables_open: [] },
    ]);
  });

  it("Comunidade desligada no restaurante, pela chave geral ou slug inexistente: ignora", async () => {
    const s = setup();
    await recordFunnelWith(s.deps, "desligado", { counts: { qr: 1, open: 1 }, mesa: "ABC234" });
    await recordFunnelWith(s.deps, "nada", { counts: { open: 1 }, mesa: null });
    const off = setup({ off: true });
    await recordFunnelWith(off.deps, "forno", { counts: { open: 1 }, mesa: null });
    expect(off.getHead).not.toHaveBeenCalled();
    for (const x of [s, off]) {
      expect(x.acc.drain(true)).toEqual([]);
      expect(x.getTables).not.toHaveBeenCalled();
      expect(x.insert).not.toHaveBeenCalled();
    }
  });

  it("grava em lote, de uma vez, quando passaram 30 s da última gravação", async () => {
    const s = setup();
    await recordFunnelWith(s.deps, "forno", { counts: { open: 1 }, mesa: null });
    await recordFunnelWith(s.deps, "outro", { counts: { share: 1 }, mesa: null });
    expect(s.insert).not.toHaveBeenCalled();
    s.c.t = TALLY_FLUSH_MS;
    await recordFunnelWith(s.deps, "forno", { counts: { open: 1, buy_tap: 1 }, mesa: null });
    expect(s.insert).toHaveBeenCalledTimes(1);
    expect(s.insert.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        { restaurant_id: "r1", day: DAY, counts: { open: 2, buy_tap: 1 }, tables_qr: [], tables_open: [] },
        { restaurant_id: "r2", day: DAY, counts: { share: 1 }, tables_qr: [], tables_open: [] },
      ]),
    );
    expect(s.insert.mock.calls[0][0]).toHaveLength(2);
    s.c.t = TALLY_FLUSH_MS + 1;
    await recordFunnelWith(s.deps, "forno", { counts: { open: 1 }, mesa: null });
    expect(s.insert).toHaveBeenCalledTimes(1);
  });

  it("o dia é o da Comunidade, no fuso do restaurante (01h00 ainda é a noite anterior)", async () => {
    const s = setup({ now: new Date("2026-10-17T04:00:00Z") });
    await recordFunnelWith(s.deps, "forno", { counts: { open: 1 }, mesa: null });
    expect(s.acc.drain(true)).toEqual([{ restaurant_id: "r1", day: DAY, counts: { open: 1 }, tables_qr: [], tables_open: [] }]);
  });
});
