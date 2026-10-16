import { describe, expect, it } from "vitest";
import type { MenuCategory, MenuItem, PublicMenu, SpecialInfo } from "@/lib/menu/types";
import { claimSpecial, type ClaimsDb } from "./specials";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ESP = U(101), PRATO = U(102), DEV = U(201), DEV2 = U(202), DEV3 = U(203), DEV4 = U(204);
// Sexta, 20:00 em São Paulo.
const FRI_20 = new Date("2026-10-16T23:00:00Z");
const HOUR = 3_600_000;

const info = (over: Partial<SpecialInfo> = {}): SpecialInfo => ({ every_h: 2, show_s: 6, days: [], from: null, to: null, limit: 1, ...over });
const it_ = (id: string, special: SpecialInfo | null, cat: string): MenuItem => ({
  id, name: special ? "Pizza da Rainha" : "Smash", description: "", price_cents: 12000, promo_price_cents: special ? 6900 : null,
  media: [], category_id: cat, half_half: false, special,
});

function makeMenu(over: Partial<PublicMenu["restaurant"]> = {}, special: SpecialInfo | null = info()): PublicMenu {
  const burgers: MenuCategory = { id: "c1", name: "Burgers", items: [it_(PRATO, null, "c1")] };
  return {
    restaurant: { id: "r1", slug: "forno", timezone: "America/Sao_Paulo", orders_enabled: true, opening_hours: null, ...over } as PublicMenu["restaurant"],
    categories: [burgers],
    specials: { id: "c-esp", name: "Produtos especiais", items: special ? [it_(ESP, special, "c-esp")] : [] },
  };
}

function fakeDb() {
  const tables: Record<string, Record<string, unknown>[]> = {
    special_claims: [],
    dining_tables: [
      { uid: U(1), id: U(1), restaurant_id: "r1", label: "Mesa 7", code: "ABC234", active: true },
      { uid: U(2), id: U(2), restaurant_id: "r1", label: "Mesa 8", code: "OFF234", active: false },
    ],
  };
  let n = 500;
  let clock = FRI_20;
  const match = (r: Record<string, unknown>, w: Record<string, unknown>) => Object.entries(w).every(([k, v]) => (r[k] ?? null) === v);
  const db: ClaimsDb = {
    async list(t, w) {
      return tables[t].filter((r) => match(r, w)) as never;
    },
    async first(t, w) {
      return (tables[t].find((r) => match(r, w)) ?? null) as never;
    },
    async insertOne(t, row) {
      const uid = U(++n);
      const full = { uid, id: uid, created_at: clock.toISOString(), ...row };
      tables[t].push(full);
      return full as never;
    },
  };
  return { db, tables, setNow: (d: Date) => (clock = d) };
}

const body = (over: Record<string, unknown> = {}) => ({ mesa: "ABC234", device: DEV, item: ESP, ...over });

function setup(menu = makeMenu(), now = FRI_20) {
  const f = fakeDb();
  f.setNow(now);
  let current = now;
  const deps = { db: f.db, getMenu: async () => menu, now: () => current };
  return { ...f, deps, at: (d: Date) => { current = d; f.setNow(d); } };
}

describe("pegar a oferta relâmpago", () => {
  it("grava o registro com o preço de oferta, o limite e o prazo de 6 h", async () => {
    const { deps, tables } = setup(makeMenu({}, info({ limit: 2 })));
    const r = await claimSpecial(deps, "forno", body());
    expect(r).toEqual({ ok: true, claim: expect.any(String), unit_cents: 6900, qty_max: 2, expires_at: new Date(FRI_20.getTime() + 6 * HOUR).toISOString(), name: "Pizza da Rainha" });
    expect(tables.special_claims).toHaveLength(1);
    expect(tables.special_claims[0]).toEqual(expect.objectContaining({ restaurant_id: "r1", table_id: U(1), device_id: DEV, item_id: ESP, item_name: "Pizza da Rainha", unit_cents: 6900, qty_max: 2, order_id: null }));
  });

  it("fora do dia ou do horário (no fuso do restaurante) não vale", async () => {
    expect(await claimSpecial(setup(makeMenu({}, info({ days: [1] }))).deps, "forno", body())).toEqual({ ok: false, code: "unavailable" });
    expect(await claimSpecial(setup(makeMenu({}, info({ from: "11:00", to: "15:00" }))).deps, "forno", body())).toEqual({ ok: false, code: "unavailable" });
  });

  it("prato comum ou especial desligado não vale", async () => {
    expect(await claimSpecial(setup().deps, "forno", body({ item: PRATO }))).toEqual({ ok: false, code: "unavailable" });
    expect(await claimSpecial(setup(makeMenu({}, null)).deps, "forno", body())).toEqual({ ok: false, code: "unavailable" });
  });

  it("mesa inativa, pedidos desligados e restaurante fechado", async () => {
    expect(await claimSpecial(setup().deps, "forno", body({ mesa: "OFF234" }))).toEqual({ ok: false, code: "table" });
    expect(await claimSpecial(setup(makeMenu({ orders_enabled: false })).deps, "forno", body())).toEqual({ ok: false, code: "disabled" });
    const closed = makeMenu({ opening_hours: Array.from({ length: 7 }, () => [{ open: "11:00", close: "15:00" }]) });
    expect(await claimSpecial(setup(closed).deps, "forno", body())).toEqual({ ok: false, code: "closed" });
  });

  it("o mesmo celular só pega de novo depois do intervalo", async () => {
    const s = setup();
    expect((await claimSpecial(s.deps, "forno", body())).ok).toBe(true);
    s.at(new Date(FRI_20.getTime() + HOUR));
    expect(await claimSpecial(s.deps, "forno", body())).toEqual({ ok: false, code: "too_soon" });
    s.at(new Date(FRI_20.getTime() + 2 * HOUR + 1000));
    expect((await claimSpecial(s.deps, "forno", body())).ok).toBe(true);
  });

  it("a mesma mesa pega no máximo 3 vezes por intervalo", async () => {
    const s = setup();
    for (const d of [DEV, DEV2, DEV3]) expect((await claimSpecial(s.deps, "forno", body({ device: d }))).ok).toBe(true);
    expect(await claimSpecial(s.deps, "forno", body({ device: DEV4 }))).toEqual({ ok: false, code: "too_soon" });
  });

  it("corpo malformado e restaurante que não existe", async () => {
    expect(await claimSpecial(setup().deps, "forno", { mesa: "x", device: DEV, item: ESP })).toEqual({ ok: false, code: "invalid" });
    expect(await claimSpecial(setup().deps, "forno", null)).toEqual({ ok: false, code: "invalid" });
    const s = setup();
    expect(await claimSpecial({ ...s.deps, getMenu: async () => null }, "forno", body())).toEqual({ ok: false, code: "not_found" });
  });

  it("horário marcado: pega só na hora (1 minuto de folga) e de novo no horário seguinte", async () => {
    const s = setup(makeMenu({}, info({ times: ["20:00", "21:00"] })));
    expect((await claimSpecial(s.deps, "forno", body())).ok).toBe(true); // 20:00
    const t = setup(makeMenu({}, info({ times: ["20:00"] })), new Date(FRI_20.getTime() + 90_000));
    expect((await claimSpecial(t.deps, "forno", body())).ok).toBe(true); // 20:01:30: a oferta começou na folga e o toque veio depois da contagem
    s.at(new Date(FRI_20.getTime() + 2 * 60_000 + 30_000));
    expect(await claimSpecial(s.deps, "forno", body())).toEqual({ ok: false, code: "unavailable" }); // 20:02:30
    s.at(new Date(FRI_20.getTime() + HOUR + 20_000));
    expect((await claimSpecial(s.deps, "forno", body())).ok).toBe(true); // 21:00:20
  });

  it("horário marcado: o mesmo celular não pega duas vezes no mesmo horário (janela de 2 minutos)", async () => {
    const s = setup(makeMenu({}, info({ times: ["20:00"] })), new Date(FRI_20.getTime() + 5_000));
    expect((await claimSpecial(s.deps, "forno", body())).ok).toBe(true); // 20:00:05
    s.at(new Date(FRI_20.getTime() + 70_000));
    expect(await claimSpecial(s.deps, "forno", body())).toEqual({ ok: false, code: "too_soon" }); // 20:01:10
  });
});
