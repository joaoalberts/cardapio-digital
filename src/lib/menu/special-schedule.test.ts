import { describe, expect, it } from "vitest";
import type { MenuCategory, MenuItem, OpeningHours, SpecialInfo } from "./types";
import {
  afterShown,
  ensureFirstEligible,
  injectOffer,
  isSpecialOpen,
  parseClock,
  pickSpecial,
  placeOffer,
  type SpecialClock,
} from "./special-schedule";

const TZ = "America/Sao_Paulo";
const NOW = 1_800_000_000_000;
const info = (over: Partial<SpecialInfo> = {}): SpecialInfo => ({ every_h: 2, show_s: 6, days: [], from: null, to: null, limit: 1, ...over });
const item = (id: string, special: SpecialInfo | null = null): MenuItem => ({
  id, name: id, description: "", price_cents: 12000, promo_price_cents: special ? 6900 : null, media: [], category_id: "c", half_half: false, special,
});
const cat = (id: string, n: number): MenuCategory => ({ id, name: id, items: Array.from({ length: n }, (_, i) => item(`${id}-${i}`)) });
const clock = (over: Partial<SpecialClock> = {}): SpecialClock => ({ v: 1, firstEligibleAt: NOW - 1, nextAt: null, ...over });
const ctx = (over: Partial<{ now: number; storiesSeen: number; timezone: string; busy: boolean; openingHours: OpeningHours | null }> = {}) => ({ now: NOW, storiesSeen: 3, timezone: TZ, busy: false, ...over });

describe("pickSpecial", () => {
  const a = item("a", info()), b = item("b", info());
  it("espera 3 stories vistos", () => {
    expect(pickSpecial([a], clock(), ctx({ storiesSeen: 2 }), () => 0)).toBeNull();
  });
  it("espera o tempo sorteado da primeira visita", () => {
    expect(pickSpecial([a], clock({ firstEligibleAt: NOW + 1 }), ctx(), () => 0)).toBeNull();
  });
  it("espera o intervalo depois da última oferta", () => {
    expect(pickSpecial([a], clock({ nextAt: NOW + 1 }), ctx(), () => 0)).toBeNull();
  });
  it("não começa com folha, carrinho ou meio a meio aberto", () => {
    expect(pickSpecial([a], clock(), ctx({ busy: true }), () => 0)).toBeNull();
  });
  it("ignora especial fora do horário", () => {
    // NOW = 05:00 em São Paulo; a janela 00:00–00:01 está fechada.
    expect(pickSpecial([item("y", info({ from: "00:00", to: "00:01" }))], clock(), ctx(), () => 0)).toBeNull();
  });
  it("restaurante fechado agora: não oferece (o pedido seria recusado)", () => {
    // NOW = sexta 05:00 em São Paulo; aberto só das 18:00 às 23:00.
    const hours = Array.from({ length: 7 }, () => [{ open: "18:00", close: "23:00" }]);
    expect(pickSpecial([a], clock(), ctx({ openingHours: hours }), () => 0)).toBeNull();
    const always = Array.from({ length: 7 }, () => [{ open: "00:00", close: "23:59" }]);
    expect(pickSpecial([a], clock(), ctx({ openingHours: always }), () => 0)?.id).toBe("a");
  });
  it("sorteia entre os abertos", () => {
    expect(pickSpecial([a, b], clock(), ctx(), () => 0.99)?.id).toBe("b");
    expect(pickSpecial([a, b], clock(), ctx(), () => 0)?.id).toBe("a");
  });
});

describe("isSpecialOpen (fuso do restaurante)", () => {
  it("sexta 23:30 em São Paulo ainda é sexta, mesmo já sendo sábado em UTC", () => {
    expect(isSpecialOpen(item("s", info({ days: [5] })), TZ, new Date("2026-10-17T02:30:00Z"))).toBe(true);
  });
  it("depois da meia-noite em São Paulo já é sábado", () => {
    expect(isSpecialOpen(item("s", info({ days: [5] })), TZ, new Date("2026-10-17T03:30:00Z"))).toBe(false);
  });
  it("respeita o horário de/até", () => {
    const s = item("s", info({ from: "19:00", to: "22:00" }));
    expect(isSpecialOpen(s, TZ, new Date("2026-10-16T00:59:00Z"))).toBe(true); // 21:59
    expect(isSpecialOpen(s, TZ, new Date("2026-10-16T01:00:00Z"))).toBe(false); // 22:00
  });
  it("prato sem regras de especial nunca abre", () => {
    expect(isSpecialOpen(item("n"), TZ, new Date(NOW))).toBe(false);
  });
});

describe("relógio", () => {
  it("primeira visita: 20 a 90 s sorteados", () => {
    expect(ensureFirstEligible(clock({ firstEligibleAt: null }), NOW, () => 0).firstEligibleAt).toBe(NOW + 20_000);
    expect(ensureFirstEligible(clock({ firstEligibleAt: null }), NOW, () => 1).firstEligibleAt).toBe(NOW + 90_000);
  });
  it("não muda a primeira visita já marcada", () => {
    expect(ensureFirstEligible(clock({ firstEligibleAt: 5 }), NOW, () => 1).firstEligibleAt).toBe(5);
  });
  it("depois de aparecer, espera o intervalo do produto", () => {
    expect(afterShown(clock(), item("a", info({ every_h: 2 })), NOW).nextAt).toBe(NOW + 7_200_000);
  });
  it("relógio estragado volta vazio", () => {
    expect(parseClock("lixo")).toEqual({ v: 1, firstEligibleAt: null, nextAt: null });
    expect(parseClock(null)).toEqual({ v: 1, firstEligibleAt: null, nextAt: null });
    expect(parseClock(JSON.stringify({ v: 1, firstEligibleAt: 7, nextAt: 9 }))).toEqual({ v: 1, firstEligibleAt: 7, nextAt: 9 });
  });
});

describe("placeOffer", () => {
  const cats = [cat("destaques", 3), cat("pizzas", 5), cat("burgers", 4), cat("sobremesa", 1)];
  it("1 ou 2 stories à frente na categoria atual", () => {
    expect(placeOffer(cats, 1, 1, "s", () => 0)).toEqual({ itemId: "s", catId: "pizzas", at: 2 });
    expect(placeOffer(cats, 1, 1, "s", () => 0.99)).toEqual({ itemId: "s", catId: "pizzas", at: 3 });
  });
  it("no último prato vai para a próxima categoria", () => {
    expect(placeOffer(cats, 1, 4, "s", () => 0)).toEqual({ itemId: "s", catId: "burgers", at: 0 });
  });
  it("nunca entra em Destaques", () => {
    expect(placeOffer(cats, 0, 0, "s", () => 0)).toEqual({ itemId: "s", catId: "pizzas", at: 0 });
  });
  it("pula categoria de um prato só", () => {
    const c2 = [cat("burgers", 4), cat("sobremesa", 1), cat("drinks", 3)];
    expect(placeOffer(c2, 0, 3, "s", () => 0)).toEqual({ itemId: "s", catId: "drinks", at: 0 });
  });
  it("sem lugar algum, não programa", () => {
    expect(placeOffer([cat("sobremesa", 1)], 0, 0, "s", () => 0)).toBeNull();
  });
});

describe("injectOffer", () => {
  const cats = [cat("pizzas", 3), cat("burgers", 2)];
  const s = item("s", info());
  it("insere o especial na posição sem mexer no resto", () => {
    const out = injectOffer(cats, { itemId: "s", catId: "pizzas", at: 1 }, s);
    expect(out[0].items.map((i) => i.id)).toEqual(["pizzas-0", "s", "pizzas-1", "pizzas-2"]);
    expect(out[1]).toBe(cats[1]);
    expect(cats[0].items).toHaveLength(3);
  });
  it("categoria que sumiu (idioma, horário) não quebra nada", () => {
    expect(injectOffer(cats, { itemId: "s", catId: "x", at: 0 }, s)).toBe(cats);
  });
  it("sem especial ou sem lugar, devolve igual", () => {
    expect(injectOffer(cats, { itemId: "s", catId: "pizzas", at: 0 }, null)).toBe(cats);
    expect(injectOffer(cats, null, s)).toBe(cats);
  });
  it("nunca insere duas vezes", () => {
    const once = injectOffer(cats, { itemId: "s", catId: "pizzas", at: 1 }, s);
    const twice = injectOffer(once, { itemId: "s", catId: "pizzas", at: 1 }, s);
    expect(twice[0].items.filter((i) => i.id === "s")).toHaveLength(1);
  });
});

describe("placeOffer só olha para frente", () => {
  it("na última categoria, sem story à frente, não volta para uma categoria anterior", () => {
    const cats = [cat("pizzas", 4), cat("burgers", 3)];
    expect(placeOffer(cats, 1, 2, "s", () => 0)).toBeNull();
  });
});
