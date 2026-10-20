import { describe, expect, it } from "vitest";
import type { MenuCategory, MenuItem, PublicMenu } from "@/lib/menu/types";
import { createOrder, listDeviceOrders, listOpenOrders, parseCreateInput, setOrderStatus, type OrdersDb } from "./service";

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
    special_claims: [],
    community_polls: [],
    community_posts: [],
    dining_tables: [
      { uid: U(1), id: U(1), restaurant_id: "r1", label: "Mesa 7", code: "ABC234", active: true },
      { uid: U(2), id: U(2), restaurant_id: "r1", label: "Mesa 8", code: "OFF234", active: false },
    ],
  };
  let n = 500;
  const firsts: string[] = [];
  const match = (r: Record<string, unknown>, w: Record<string, unknown>) => Object.entries(w).every(([k, v]) => (r[k] ?? null) === v);
  const db: OrdersDb = {
    async list(t, w, o) {
      let rows = tables[t].filter((r) => match(r, w));
      if (o?.sort === "-Id") rows = [...rows].reverse();
      return (o?.limit ? rows.slice(0, o.limit) : rows) as never;
    },
    async first(t, w) {
      firsts.push(t);
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
  return { db, tables, firsts };
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
    // O pedido fechado no descarte fica marcado e não entra no placar da Comunidade.
    expect(s.tables.orders.map((o) => [o.open, o.discarded ?? false])).toEqual([[true, false], [false, true]]);
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
  it("Meus pedidos não mostra o pedido descartado (envio repetido ou oferta perdida)", async () => {
    const s = setup();
    // Dois envios simultâneos do mesmo pedido: um fica, o outro é fechado como descartado.
    await Promise.all([createOrder(s.deps, "forno", body()), createOrder(s.deps, "forno", body())]);
    expect(s.tables.orders.filter((o) => o.discarded)).toHaveLength(1);
    const mine = await listDeviceOrders(s.deps, "forno", DEV);
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe(s.tables.orders.find((o) => !o.discarded)?.id);
    // Linha antiga sem a coluna (undefined) ou com false aparece.
    const t = new Date(NOON.getTime() - 60_000).toISOString();
    s.tables.orders.push({ uid: "x", id: "x", restaurant_id: "r1", device_id: DEV, status: "new", total_cents: 1, lines: [], table_label: "Mesa 7", created_at: t, discarded: false });
    expect((await listDeviceOrders(s.deps, "forno", DEV)).map((o) => o.id)).toContain("x");
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


describe("oferta relâmpago no pedido", () => {
  const ESP = U(111), CLAIM = U(401), CLAIM2 = U(402);
  const LATER = new Date(NOON.getTime() + 60_000);
  const withSpecial = (on = true): PublicMenu => ({
    ...makeMenu(),
    specials: {
      id: "c-esp", name: "Produtos especiais",
      items: on ? [{ id: ESP, name: "Pizza da Rainha", description: "", price_cents: 12000, promo_price_cents: 6900, media: [], category_id: "c-esp", half_half: false }] : [],
    },
  });
  const claimRow = (over: Record<string, unknown> = {}) => ({
    uid: CLAIM, id: CLAIM, restaurant_id: "r1", table_id: U(1), device_id: DEV, item_id: ESP, item_name: "Pizza da Rainha",
    unit_cents: 6900, qty_max: 1, expires_at: new Date(NOON.getTime() + 3_600_000).toISOString(), order_id: null, created_at: NOON.toISOString(), ...over,
  });
  const espBody = (over: Record<string, unknown> = {}) => body({ lines: [{ item: ESP, qty: 1, note: "", claim: CLAIM }], ...over });

  it("aceita com registro válido, cobra o preço do registro e marca o registro como usado", async () => {
    const s = setup(withSpecial());
    s.tables.special_claims.push(claimRow());
    const r = await createOrder(s.deps, "forno", espBody());
    expect(r.ok).toBe(true);
    expect(s.tables.orders[0]).toMatchObject({ total_cents: 6900 });
    expect((s.tables.orders[0].lines as Record<string, unknown>[])[0]).toMatchObject({ unit_cents: 6900, special: true, name: "Pizza da Rainha" });
    expect(s.tables.special_claims[0].order_id).toBe(s.tables.orders[0].uid);
  });

  it("o mesmo registro em outro pedido é recusado", async () => {
    const s = setup(withSpecial());
    s.tables.special_claims.push(claimRow());
    expect((await createOrder(s.deps, "forno", espBody())).ok).toBe(true);
    const again = await createOrder(s.deps, "forno", espBody({ ref: REF2 }));
    expect(again).toEqual({ ok: false, code: "lines", errors: [{ index: 0, item: ESP, reason: "special" }] });
  });

  it("registro vencido, de outro celular ou de outra mesa é recusado", async () => {
    for (const over of [{ expires_at: new Date(NOON.getTime() - 1).toISOString() }, { device_id: DEV2 }, { table_id: U(2) }]) {
      const s = setup(withSpecial());
      s.tables.special_claims.push(claimRow(over));
      expect(await createOrder(s.deps, "forno", espBody())).toEqual({ ok: false, code: "lines", errors: [{ index: 0, item: ESP, reason: "special" }] });
    }
  });

  it("o dono desligou o especial depois do toque: vale o preço do registro", async () => {
    const s = setup(withSpecial(false));
    s.tables.special_claims.push(claimRow());
    const r = await createOrder(s.deps, "forno", espBody());
    expect(r.ok && r.order.total_cents).toBe(6900);
  });

  it("reenvio com o mesmo ref devolve o mesmo pedido, sem recusar o registro já usado por ele", async () => {
    const s = setup(withSpecial());
    s.tables.special_claims.push(claimRow());
    const a = await createOrder(s.deps, "forno", espBody());
    const b = await createOrder({ ...s.deps, now: () => LATER }, "forno", espBody());
    expect(b).toEqual(a);
    expect(s.tables.orders).toHaveLength(1);
  });

  it("dois pedidos ao mesmo tempo com o mesmo registro: só o primeiro leva", async () => {
    const s = setup(withSpecial());
    s.tables.special_claims.push(claimRow());
    const [a, b] = await Promise.all([createOrder(s.deps, "forno", espBody()), createOrder(s.deps, "forno", espBody({ ref: REF2 }))]);
    const oks = [a, b].filter((r) => r.ok);
    expect(oks).toHaveLength(1);
    expect([a, b].find((r) => !r.ok)).toEqual({ ok: false, code: "lines", errors: [{ index: 0, item: ESP, reason: "special" }] });
    expect(s.tables.orders.filter((o) => o.open)).toHaveLength(1);
    // O pedido que perdeu a oferta fica marcado como descartado; o que levou, não.
    expect(s.tables.orders.filter((o) => !o.open).map((o) => o.discarded)).toEqual([true]);
    expect(s.tables.orders.filter((o) => o.open).map((o) => o.discarded ?? false)).toEqual([false]);
  });

  it("registro de outro restaurante não existe para este", async () => {
    const s = setup(withSpecial());
    s.tables.special_claims.push(claimRow({ uid: CLAIM2, id: CLAIM2, restaurant_id: "r2" }));
    expect((await createOrder(s.deps, "forno", espBody({ lines: [{ item: ESP, qty: 1, note: "", claim: CLAIM2 }] }))).ok).toBe(false);
  });
});

describe("origem da Comunidade no pedido", () => {
  const POLL = U(601), POLL_B = U(602), POST = U(611);
  const HOUR = 3_600_000;
  const at = (ms: number) => NOON.getTime() + ms;
  const palco = (over: Record<string, unknown> = {}) => ({ item: ITEM, qty: 1, note: "", origin: "comunidade_palco", origin_ref: POLL, origin_at: at(-HOUR), ...over });
  const seeded = () => {
    const s = setup();
    s.tables.community_polls.push({ uid: POLL, id: POLL, restaurant_id: "r1" }, { uid: POLL_B, id: POLL_B, restaurant_id: "r2" });
    s.tables.community_posts.push({ uid: POST, id: POST, restaurant_id: "r1", status: "approved" });
    return s;
  };
  const saved = (s: ReturnType<typeof seeded>) => (s.tables.orders[0].lines as Record<string, unknown>[]);

  describe("parseCreateInput", () => {
    it("aceita a origem válida", () => {
      const r = parseCreateInput(body({ lines: [palco()] }));
      expect(r?.lines[0]).toEqual({ item: ITEM, option: null, half: null, qty: 1, note: "", origin: "comunidade_palco", origin_ref: POLL, origin_at: at(-HOUR) });
    });
    it("descarta a origem (e mantém a linha) com enum desconhecido, origin_ref não uuid ou origin_at inválido", () => {
      for (const over of [
        { origin: "comunidade_vip" },
        { origin: "Comunidade_Palco" },
        { origin_ref: "abc" },
        { origin_ref: "00000000-0000-4000-8000-00000000060" },
        { origin_ref: null },
        { origin_at: "123" },
        { origin_at: Number.NaN },
        { origin_at: null },
      ]) {
        const r = parseCreateInput(body({ lines: [palco(over)] }));
        expect(r?.lines).toEqual([{ item: ITEM, option: null, half: null, qty: 1, note: "" }]);
      }
    });
  });

  describe("parseCreateInput: massa", () => {
    const line = (dough: unknown) => parseCreateInput(body({ lines: [{ item: ITEM, qty: 1, dough }] }));
    it("aceita texto de até 20 caracteres", () => {
      expect(line("Fina")?.lines[0].dough).toBe("Fina");
      expect(line("a".repeat(20))).not.toBeNull();
    });
    it("recusa número, objeto ou texto maior", () => {
      expect(line(3)).toBeNull();
      expect(line({})).toBeNull();
      expect(line("a".repeat(21))).toBeNull();
    });
    it("sem massa a linha segue sem o campo", () => {
      expect(parseCreateInput(body({ lines: [{ item: ITEM, qty: 1 }] }))?.lines[0]).not.toHaveProperty("dough");
    });
  });

  it("mantém a origem com origin_at = agora − 1 h e enquete do restaurante", async () => {
    const s = seeded();
    expect((await createOrder(s.deps, "forno", body({ lines: [palco(), { item: ITEM2, qty: 1 }] }))).ok).toBe(true);
    expect(saved(s)[0]).toMatchObject({ item_id: ITEM, origin: "comunidade_palco", origin_ref: POLL });
    expect("origin_at" in saved(s)[0]).toBe(false);
    expect("origin" in saved(s)[1]).toBe(false); // linha que não nasceu na Comunidade não conta como dela
  });

  it("descarta com origin_at = agora − 2 h − 1 s e mantém em agora − 2 h", async () => {
    const s = seeded();
    await createOrder(s.deps, "forno", body({ lines: [palco({ origin_at: at(-2 * HOUR - 1000) }), { ...palco({ origin_at: at(-2 * HOUR) }), item: ITEM2 }] }));
    expect("origin" in saved(s)[0]).toBe(false);
    expect("origin_ref" in saved(s)[0]).toBe(false);
    expect(saved(s)[1]).toMatchObject({ item_id: ITEM2, origin: "comunidade_palco", origin_ref: POLL });
  });

  it("descarta com origin_at no futuro (> agora + 1 min); relógio do celular 30 s adiantado passa", async () => {
    const s = seeded();
    await createOrder(s.deps, "forno", body({ lines: [palco({ origin_at: at(61_000) }), { ...palco({ origin_at: at(30_000) }), item: ITEM2 }] }));
    expect("origin" in saved(s)[0]).toBe(false);
    expect(saved(s)[1]).toMatchObject({ origin: "comunidade_palco" });
  });

  it("descarta com origin_ref de enquete de outro restaurante, ou que não existe", async () => {
    const s = seeded();
    const r = await createOrder(s.deps, "forno", body({ lines: [palco({ origin_ref: POLL_B }), { ...palco({ origin_ref: U(699) }), item: ITEM2 }] }));
    expect(r.ok).toBe(true); // a origem cai em silêncio; o pedido segue
    expect(saved(s).map((l) => "origin" in l || "origin_ref" in l)).toEqual([false, false]);
  });

  it("comunidade_mural confere em community_posts e comunidade_palco em community_polls", async () => {
    const s = seeded();
    await createOrder(s.deps, "forno", body({
      lines: [
        palco({ origin: "comunidade_mural", origin_ref: POST }),
        { ...palco({ origin: "comunidade_mural", origin_ref: POLL }), item: ITEM2 }, // id de enquete passado como post
        { ...palco({ origin: "comunidade_palco", origin_ref: POST }), note: "x" }, // id de post passado como enquete
      ],
    }));
    expect(saved(s).map((l) => l.origin ?? null)).toEqual(["comunidade_mural", null, null]);
  });

  it("confere cada origin_ref uma vez só", async () => {
    const s = seeded();
    await createOrder(s.deps, "forno", body({ lines: [palco(), { ...palco(), item: ITEM2 }, { ...palco(), note: "x" }] }));
    expect(s.firsts.filter((t) => t === "community_polls")).toHaveLength(1);
    expect(saved(s).every((l) => l.origin === "comunidade_palco")).toBe(true);
  });

  it("sem nenhuma origem, não consulta as tabelas da Comunidade", async () => {
    const s = seeded();
    await createOrder(s.deps, "forno", body());
    expect(s.firsts.some((t) => t.startsWith("community_"))).toBe(false);
  });
});
