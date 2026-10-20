import { describe, expect, it } from "vitest";
import type { MenuCategory, MenuItem, PublicMenu } from "@/lib/menu/types";
import { cleanNote, halfPrice, itemPrice, priceCart, NOTE_MAX } from "./pricing";

// 12:00 em São Paulo.
const NOON = new Date("2026-10-15T15:00:00Z");

function item(id: string, category_id: string, half_half: boolean, extra: Partial<MenuItem> = {}): MenuItem {
  return {
    id, name: id[0].toUpperCase() + id.slice(1), description: "", price_cents: 0, promo_price_cents: null,
    hide_price: false, featured: false, serves: null, country: null, price_options: null, tags: [], media: [],
    category_id, half_half, ...extra,
  };
}
const sizes = (m: number, g: number) => [{ label: "Média", price_cents: m }, { label: "Grande", price_cents: g }];

function menu(over: { pizzasFrom?: string; pizzasTo?: string } = {}): PublicMenu {
  const pizzas: MenuCategory = {
    id: "c-pz", name: "Pizzas", available_from: over.pizzasFrom ?? null, available_to: over.pizzasTo ?? null, items: [
      item("margherita", "c-pz", true, { price_options: sizes(4800, 5550) }),
      item("calabresa", "c-pz", true, { price_options: sizes(4600, 5799) }),
      item("doce", "c-pz", true, { price_options: [{ label: "Broto", price_cents: 3000 }] }),
    ],
  };
  const burgers: MenuCategory = {
    id: "c-bg", name: "Burgers", items: [
      item("smash", "c-bg", false, { price_cents: 3490 }),
      item("bacon", "c-bg", false, { price_cents: 3990, promo_price_cents: 3590 }),
      item("segredo", "c-bg", false, { price_cents: 5000, hide_price: true }),
    ],
  };
  // Outra categoria com o mesmo tamanho "Grande": só a regra de categoria impede o meio a meio.
  const massas: MenuCategory = {
    id: "c-ms", name: "Massas", items: [item("lasanha", "c-ms", true, { price_options: sizes(3000, 5550) })],
  };
  return {
    restaurant: { id: "r1", timezone: "America/Sao_Paulo", orders_enabled: true } as PublicMenu["restaurant"],
    categories: [pizzas, burgers, massas],
  };
}

describe("itemPrice", () => {
  it("usa a promoção em prato sem tamanhos", () => {
    expect(itemPrice(menu().categories[1].items[1])).toBe(3590);
  });
  it("exige um tamanho existente quando há tamanhos", () => {
    const m = menu().categories[0].items[0];
    expect(itemPrice(m)).toBeNull();
    expect(itemPrice(m, "Família")).toBeNull();
    expect(itemPrice(m, "Grande")).toBe(5550);
  });
  it("não aceita tamanho em prato sem tamanhos", () => {
    expect(itemPrice(menu().categories[1].items[0], "Grande")).toBeNull();
  });
  it("prato com preço escondido não tem preço", () => {
    expect(itemPrice(menu().categories[1].items[2])).toBeNull();
  });
});

describe("halfPrice", () => {
  it("é a média arredondada para cima no centavo", () => {
    expect(halfPrice(5550, 5799)).toBe(5675); // 5674,5 -> 5675
    expect(halfPrice(4800, 4600)).toBe(4700);
    expect(halfPrice(1, 2)).toBe(2);
  });
});

describe("cleanNote", () => {
  it("apara, junta espaços e troca quebras de linha", () => {
    expect(cleanNote("  sem\ncebola \t por favor ")).toBe("sem cebola por favor");
  });
  it("aceita 140 e recusa 141 caracteres", () => {
    expect(cleanNote("a".repeat(NOTE_MAX))).toBe("a".repeat(NOTE_MAX));
    expect(cleanNote("a".repeat(NOTE_MAX + 1))).toBeNull();
  });
  it("vazio vira texto vazio; tipo errado é recusado", () => {
    expect(cleanNote(undefined)).toBe("");
    expect(cleanNote(null)).toBe("");
    expect(cleanNote(42)).toBeNull();
  });
});

describe("priceCart", () => {
  it("soma linhas simples e devolve os nomes do cardápio", () => {
    const r = priceCart(menu(), [{ item: "smash", qty: 2, note: "sem picles" }, { item: "bacon", qty: 1 }], NOON);
    expect(r).toEqual({
      ok: true,
      total_cents: 3490 * 2 + 3590,
      lines: [
        { item_id: "smash", name: "Smash", half_item_id: null, half_name: null, option: null, dough: null, qty: 2, unit_cents: 3490, note: "sem picles" },
        { item_id: "bacon", name: "Bacon", half_item_id: null, half_name: null, option: null, dough: null, qty: 1, unit_cents: 3590, note: "" },
      ],
    });
  });
  it("cobra a média no meio a meio, com o mesmo tamanho", () => {
    const r = priceCart(menu(), [{ item: "margherita", option: "Grande", half: "calabresa", qty: 1 }], NOON);
    expect(r.ok && r.lines[0]).toMatchObject({ unit_cents: 5675, half_item_id: "calabresa", half_name: "Calabresa", option: "Grande" });
  });
  it("recusa meio a meio em categoria que não aceita", () => {
    expect(priceCart(menu(), [{ item: "smash", half: "bacon", qty: 1 }], NOON)).toEqual({ ok: false, errors: [{ index: 0, item: "smash", reason: "half" }] });
  });
  it("recusa sabor de outra categoria, o mesmo sabor e sabor sem o tamanho", () => {
    const bad = [
      { item: "margherita", option: "Grande", half: "smash", qty: 1 },
      { item: "margherita", option: "Grande", half: "lasanha", qty: 1 },
      { item: "margherita", option: "Grande", half: "margherita", qty: 1 },
      { item: "margherita", option: "Grande", half: "doce", qty: 1 },
    ];
    const r = priceCart(menu(), bad, NOON);
    expect(r.ok ? [] : r.errors.map((e) => e.reason)).toEqual(["half", "half", "half", "half"]);
  });
  it("recusa tamanho faltando, preço escondido e prato inexistente", () => {
    const r = priceCart(menu(), [{ item: "margherita", qty: 1 }, { item: "segredo", qty: 1 }, { item: "sumiu", qty: 1 }], NOON);
    expect(r.ok ? [] : r.errors.map((e) => e.reason)).toEqual(["option", "no_price", "unavailable"]);
  });
  it("recusa categoria fora do horário", () => {
    const r = priceCart(menu({ pizzasFrom: "18:00:00", pizzasTo: "23:00:00" }), [{ item: "margherita", option: "Média", qty: 1 }], NOON);
    expect(r).toEqual({ ok: false, errors: [{ index: 0, item: "margherita", reason: "closed_category" }] });
  });
  it("recusa quantidades fora de 1..20 e observação longa", () => {
    const r = priceCart(menu(), [
      { item: "smash", qty: 0 }, { item: "smash", qty: 21 }, { item: "smash", qty: 1.5 },
      { item: "smash", qty: 1, note: "x".repeat(141) },
    ], NOON);
    expect(r.ok ? [] : r.errors.map((e) => e.reason)).toEqual(["qty", "qty", "qty", "note"]);
  });
  it("recusa pedido vazio ou com mais de 30 linhas", () => {
    expect(priceCart(menu(), [], NOON).ok).toBe(false);
    expect(priceCart(menu(), Array.from({ length: 31 }, () => ({ item: "smash", qty: 1 })), NOON).ok).toBe(false);
    expect(priceCart(menu(), Array.from({ length: 30 }, () => ({ item: "smash", qty: 1 })), NOON).ok).toBe(true);
  });
});

describe("oferta relâmpago (preço do registro)", () => {
  const ESP = "rainha";
  const C1 = "claim-1";
  const withSpecial = (on = true): PublicMenu => ({
    ...menu(),
    specials: { id: "c-esp", name: "Produtos especiais", items: on ? [item(ESP, "c-esp", false, { price_cents: 12000, promo_price_cents: 6900 })] : [] },
  });
  const claims = new Map([[C1, { item_id: ESP, item_name: "Pizza da Rainha", unit_cents: 6900, qty_max: 1 }]]);

  it("linha com registro usa o preço e o nome do registro", () => {
    const r = priceCart(withSpecial(), [{ item: ESP, claim: C1, qty: 1 }], NOON, claims);
    expect(r).toEqual({ ok: true, total_cents: 6900, lines: [expect.objectContaining({ item_id: ESP, name: "Pizza da Rainha", unit_cents: 6900, special: true, qty: 1 })] });
  });

  it("vale mesmo com o especial desligado depois do toque", () => {
    const r = priceCart(withSpecial(false), [{ item: ESP, claim: C1, qty: 1 }], NOON, claims);
    expect(r.ok).toBe(true);
  });

  it("acima do limite do registro é recusado", () => {
    expect(priceCart(withSpecial(), [{ item: ESP, claim: C1, qty: 2 }], NOON, claims)).toEqual({ ok: false, errors: [{ index: 0, item: ESP, reason: "special" }] });
  });

  it("registro que não existe ou de outro produto é recusado", () => {
    expect(priceCart(withSpecial(), [{ item: ESP, claim: "nada", qty: 1 }], NOON, claims).ok).toBe(false);
    const other = new Map([[C1, { item_id: "smash", item_name: "Smash", unit_cents: 100, qty_max: 1 }]]);
    const r = priceCart(withSpecial(), [{ item: ESP, claim: C1, qty: 1 }], NOON, other);
    expect(r).toEqual({ ok: false, errors: [{ index: 0, item: ESP, reason: "special" }] });
  });

  it("produto especial sem registro é recusado (não sai pelo preço de oferta)", () => {
    expect(priceCart(withSpecial(), [{ item: ESP, qty: 1 }], NOON, claims)).toEqual({ ok: false, errors: [{ index: 0, item: ESP, reason: "special" }] });
  });

  it("prato comum continua igual com o mapa de registros", () => {
    const r = priceCart(withSpecial(), [{ item: "smash", qty: 1 }], NOON, claims);
    expect(r.ok && r.lines[0]).toEqual(expect.objectContaining({ unit_cents: 3490 }));
    expect(r.ok && r.lines[0].special).toBeFalsy();
  });
});

describe("oferta relâmpago: um registro, várias linhas", () => {
  it("o mesmo registro em duas linhas do pedido soma contra o limite", () => {
    const m: PublicMenu = { ...menu(), specials: { id: "c-esp", name: "E", items: [item("rainha", "c-esp", false, { price_cents: 12000, promo_price_cents: 6900 })] } };
    const claims = new Map([["c1", { item_id: "rainha", item_name: "Pizza da Rainha", unit_cents: 6900, qty_max: 1 }]]);
    const r = priceCart(m, [{ item: "rainha", claim: "c1", qty: 1 }, { item: "rainha", claim: "c1", qty: 1, note: "outra" }], NOON, claims);
    expect(r).toEqual({ ok: false, errors: [{ index: 1, item: "rainha", reason: "special" }] });
  });
});

describe("priceCart: massa", () => {
  const doughs = [{ label: "Tradicional", extra_cents: 0 }, { label: "Fina", extra_cents: 500 }];
  const dmenu = (): PublicMenu => ({
    restaurant: { id: "r1", timezone: "America/Sao_Paulo", orders_enabled: true } as PublicMenu["restaurant"],
    categories: [
      { id: "c-pz", name: "Pizzas", items: [
        item("mussarela", "c-pz", true, { price_cents: 6900, doughs }),
        item("portuguesa", "c-pz", true, { price_cents: 7900, doughs }),
      ] },
      { id: "c-bg", name: "Burgers", items: [item("smash", "c-bg", false, { price_cents: 3490 })] },
    ],
  });
  it("a massa soma o extra ao preço e vai na linha", () => {
    const r = priceCart(dmenu(), [{ item: "mussarela", dough: "Fina", qty: 1 }], NOON);
    expect(r.ok && r.lines[0]).toMatchObject({ unit_cents: 7400, dough: "Fina" });
  });
  it("sem massa vale a primeira (Tradicional, 6900)", () => {
    const r = priceCart(dmenu(), [{ item: "mussarela", qty: 1 }], NOON);
    expect(r.ok && r.lines[0]).toMatchObject({ unit_cents: 6900, dough: "Tradicional" });
  });
  it("meio a meio: o extra entra uma vez, sobre a média", () => {
    const r = priceCart(dmenu(), [{ item: "mussarela", half: "portuguesa", dough: "Fina", qty: 1 }], NOON);
    expect(r.ok && r.lines[0].unit_cents).toBe(7400 + 500); // média 7400 + 500
  });
  it("massa que não existe recusa com dough", () => {
    expect(priceCart(dmenu(), [{ item: "mussarela", dough: "Grossa", qty: 1 }], NOON)).toEqual({ ok: false, errors: [{ index: 0, item: "mussarela", reason: "dough" }] });
  });
  it("prato sem massas com dough recusa com dough; sem dough segue com dough null", () => {
    expect(priceCart(dmenu(), [{ item: "smash", dough: "Fina", qty: 1 }], NOON)).toEqual({ ok: false, errors: [{ index: 0, item: "smash", reason: "dough" }] });
    const r = priceCart(dmenu(), [{ item: "smash", qty: 1 }], NOON);
    expect(r.ok && r.lines[0].dough).toBeNull();
  });
  it("o total soma o extra vezes a quantidade", () => {
    const r = priceCart(dmenu(), [{ item: "mussarela", dough: "Fina", qty: 3 }, { item: "smash", qty: 1 }], NOON);
    expect(r.ok && r.total_cents).toBe(7400 * 3 + 3490);
  });
  it("oferta relâmpago com massa é recusada como special", () => {
    const claims = new Map([["cl", { item_id: "smash", item_name: "Smash", unit_cents: 1000, qty_max: 2 }]]);
    expect(priceCart(dmenu(), [{ item: "smash", claim: "cl", dough: "Fina", qty: 1 }], NOON, claims)).toEqual({ ok: false, errors: [{ index: 0, item: "smash", reason: "special" }] });
  });
});
