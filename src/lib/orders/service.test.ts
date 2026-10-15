import { describe, expect, it } from "vitest";
import type { MenuCategory, MenuItem, PublicMenu } from "@/lib/menu/types";
import { createOrder, listDeviceOrders, listOpenOrders, setOrderStatus, type OrdersDb } from "./service";

const NOON = new Date("2026-10-15T15:00:00Z"); // quarta, 12:00 em São Paulo
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ITEM = U(101), ITEM2 = U(102), DEV = U(201), DEV2 = U(202), REF = U(301), REF2 = U(302);

function makeMenu(over: Partial<PublicMenu["restaurant"]> = {}, price = 3490): PublicMenu {
  const it = (id: string, name: string, cents: number): MenuItem => ({
    id, name, description: "", price_cents: cents, promo_price_cents: null, hide_price: false, featured: false,
    serves: null, country: null, price_options: null, tags: [], media: [], category_id: "c1", half_half: false,
  });
  const cat: MenuCategory = { id: "c1", name: "Burgers", items: [it(ITEM, "Smash", price), it(ITEM2, "Clássico", 3200)] };
  return {
    restaurant: { id: "r1", slug: "forno", timezone: "America/Sao_Paulo", orders_enabled: true, opening_hours: null, ...over } as PublicMenu["restaurant"],
    categories: [cat],
  };
}

function fakeDb() {
  const tables: Record<string, Record<string, unknown>[]> = {
    orders: [],
    dining_tables: [
      { uid: U(1), id: U(1), restaurant_id: "r1", label: "Mesa 7", code: "ABC234", active: true },
      { uid: U(2), id: U(2), restaurant_id: "r1", label: "Mesa 8", code: "OFF234", active: false },
    ],
  };
  let n = 500;
  const match = (r: Record<string, unknown>, w: Record<string, unknown>) => Object.entries(w).every(([k, v]) => (r[k] ?? null) === v);
  const db: OrdersDb = {
    async list(t, w, o) {
      let rows = tables[t].filter((r) => match(r, w));
      if (o?.sort === "-Id") rows = [...rows].reverse();
      return (o?.limit ? rows.slice(0, o.limit) : rows) as never;
    },
    async first(t, w) {
      return (tables[t].find((r) => match(r, w)) ?? null) as never;
    },
    async insertOne(t, row) {
      const uid = U(++n);
      const full = { uid, id: uid, created_at: NOON.toISOString(), ...row };
      tables[t].push(full);
      return full as never;
    },
    async update(t, w, patch) {
      const rows = tables[t].filter((r) => match(r, w));
      rows.forEach((r) => Object.assign(r, patch));
      return rows.length;
    },
  };
  return { db, tables };
}

const body = (over: Record<string, unknown> = {}) => ({
  mesa: "ABC234", device: DEV, ref: REF, lines: [{ item: ITEM, qty: 2, note: "sem picles" }], ...over,
});

function setup(menu = makeMenu()) {
  const f = fakeDb();
  let current = menu;
  const deps = { db: f.db, getMenu: async (s: string) => (s === "forno" ? current : null), now: () => NOON };
  return { ...f, deps, swapMenu: (m: PublicMenu) => (current = m) };
}

describe("createOrder", () => {
  it("grava o pedido com o preço do servidor e a mesa do QR", async () => {
    const s = setup();
    const r = await createOrder(s.deps, "forno", body({ lines: [{ item: ITEM, qty: 2, note: "sem picles", price: 1 }] }));
    expect(r.ok).toBe(true);
    expect(s.tables.orders).toHaveLength(1);
    expect(s.tables.orders[0]).toMatchObject({
      restaurant_id: "r1", table_id: U(1), table_label: "Mesa 7", status: "new", open: true, total_cents: 6980, device_id: DEV, client_ref: REF,
    });
  });
  it("mesmo ref não duplica (toque duplo ou nova tentativa)", async () => {
    const s = setup();
    const a = await createOrder(s.deps, "forno", body());
    const b = await createOrder(s.deps, "forno", body());
    expect(s.tables.orders).toHaveLength(1);
    expect(a.ok && b.ok && a.order.id === b.order.id).toBe(true);
  });
  it("recusa corpo malformado, restaurante desconhecido e mesa inativa ou inexistente", async () => {
    const s = setup();
    expect((await createOrder(s.deps, "forno", { ...body(), device: "x" })).ok).toBe(false);
    expect(await createOrder(s.deps, "outro", body())).toEqual({ ok: false, code: "not_found" });
    expect(await createOrder(s.deps, "forno", body({ mesa: "OFF234" }))).toEqual({ ok: false, code: "table" });
    expect(await createOrder(s.deps, "forno", body({ mesa: "ZZZ234" }))).toEqual({ ok: false, code: "table" });
    expect(s.tables.orders).toHaveLength(0);
  });
  it("recusa quando o restaurante não recebe pedidos", async () => {
    const s = setup(makeMenu({ orders_enabled: false }));
    expect(await createOrder(s.deps, "forno", body())).toEqual({ ok: false, code: "disabled" });
  });
  it("recusa fora do horário e diz quando abre", async () => {
    const hours = Array.from({ length: 7 }, () => [{ open: "18:00", close: "23:00" }]);
    const s = setup(makeMenu({ opening_hours: hours }));
    expect(await createOrder(s.deps, "forno", body())).toEqual({ ok: false, code: "closed", opensAt: "18:00" });
  });
  it("usa o preço atual do cardápio e recusa prato que saiu", async () => {
    const s = setup();
    s.swapMenu(makeMenu({}, 3990));
    const r = await createOrder(s.deps, "forno", body());
    expect(r.ok && r.order.total_cents).toBe(7980);
    const gone = makeMenu();
    gone.categories[0].items = gone.categories[0].items.filter((i) => i.id !== ITEM);
    s.swapMenu(gone);
    expect(await createOrder(s.deps, "forno", body({ ref: REF2 }))).toEqual({
      ok: false, code: "lines", errors: [{ index: 0, item: ITEM, reason: "unavailable" }],
    });
  });
});

describe("reenvio e corrida", () => {
  it("dois envios simultâneos com o mesmo ref ficam em um pedido só", async () => {
    const s = setup();
    const [a, b] = await Promise.all([createOrder(s.deps, "forno", body()), createOrder(s.deps, "forno", body())]);
    expect(a.ok && b.ok && a.order.id === b.order.id).toBe(true);
    expect(await listOpenOrders({ db: s.db }, "r1")).toHaveLength(1);
  });
  it("reenvio de pedido já gravado volta o pedido mesmo com pedidos desligados", async () => {
    const s = setup();
    const a = await createOrder(s.deps, "forno", body());
    s.swapMenu(makeMenu({ orders_enabled: false }));
    const b = await createOrder(s.deps, "forno", body());
    expect(a.ok && b.ok && a.order.id === b.order.id).toBe(true);
  });
});

describe("pedidos do aparelho e da cozinha", () => {
  it("cada celular vê só os próprios pedidos", async () => {
    const s = setup();
    await createOrder(s.deps, "forno", body());
    await createOrder(s.deps, "forno", body({ device: DEV2, ref: REF2 }));
    const mine = await listDeviceOrders(s.deps, "forno", DEV);
    expect(mine).toHaveLength(1);
    expect(Object.keys(mine[0]).sort()).toEqual(["created_at", "id", "lines", "status", "table_label", "total_cents"]);
    expect(await listDeviceOrders(s.deps, "forno", "nao-e-uuid")).toEqual([]);
  });
  it("Meus pedidos mostra só as últimas 6 h; created_at ilegível aparece", async () => {
    const s = setup();
    const at = (min: number) => new Date(NOON.getTime() - min * 60_000).toISOString();
    const mk = (id: string, created_at: string) =>
      s.tables.orders.push({ uid: id, id, restaurant_id: "r1", device_id: DEV, status: "new", total_cents: 1, lines: [], table_label: "Mesa 7", created_at });
    mk("a", at(359));
    mk("b", at(361));
    mk("c", "lixo");
    const ids = (await listDeviceOrders(s.deps, "forno", DEV)).map((o) => o.id).sort();
    expect(ids).toEqual(["a", "c"]);
  });
  it("a cozinha vê os abertos; o status só anda um passo e para em entregue", async () => {
    const s = setup();
    const r = await createOrder(s.deps, "forno", body());
    if (!r.ok) throw new Error("pedido não criado");
    const deps = { db: s.db, now: () => NOON, isMember: async (rid: string) => rid === "r1" };
    expect(await setOrderStatus(deps, "r1", r.order.id, "ready")).toEqual({ error: "Esse pedido já mudou. Atualize a tela." });
    expect(await setOrderStatus(deps, "r1", r.order.id, "preparing")).toEqual({});
    expect(await setOrderStatus(deps, "r1", r.order.id, "preparing")).toEqual({}); // clique repetido
    expect(await setOrderStatus(deps, "r1", r.order.id, "ready")).toEqual({});
    expect(await setOrderStatus(deps, "r1", r.order.id, "delivered")).toEqual({});
    expect(await listOpenOrders({ db: s.db }, "r1")).toEqual([]);
    expect(await setOrderStatus(deps, "r1", r.order.id, "new")).toEqual({ error: "Esse pedido já mudou. Atualize a tela." });
  });
  it("quem não é membro não muda status", async () => {
    const s = setup();
    const r = await createOrder(s.deps, "forno", body());
    if (!r.ok) throw new Error("pedido não criado");
    const deps = { db: s.db, now: () => NOON, isMember: async () => false };
    expect(await setOrderStatus(deps, "r1", r.order.id, "preparing")).toEqual({ error: "Entre de novo no painel." });
    expect(s.tables.orders[0].status).toBe("new");
  });
});
