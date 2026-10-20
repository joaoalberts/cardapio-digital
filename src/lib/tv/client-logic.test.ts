import { describe, expect, it } from "vitest";
import type { MenuCategory, MenuItem, PublicMenu } from "@/lib/menu/types";
import {
  houseHighlight, pairCodeDue, pairCodeRecord, priceInfo, savedPairCode, TV_RELOAD_MS, tvAccent, tvBgSize, tvReloadDue, tvSlow,
} from "./client-logic";

const NOW = new Date("2026-10-16T23:00:00Z"); // 20h em São Paulo

function item(id: string, over: Partial<MenuItem> = {}): MenuItem {
  return {
    id,
    name: id,
    description: "",
    price_cents: 1000,
    media: [{ id: `m-${id}`, kind: "photo", storage_path: `/fotos/${id}.webp`, mux_playback_id: null, poster_path: null }],
    category_id: "c1",
    half_half: false,
    ...over,
  };
}
function cat(id: string, items: MenuItem[], over: Partial<MenuCategory> = {}): MenuCategory {
  return { id, name: id, items, ...over };
}
function menu(categories: MenuCategory[]): PublicMenu {
  return {
    restaurant: {
      id: "r1", name: "Depot", slug: "depot", logo_path: null, brand_color: null, languages: ["pt-BR"], menu_version: 1,
      cover_video_path: null, cover_image_path: null, font_theme: "fell", timezone: "America/Sao_Paulo", opening_hours: null,
      language: "pt-BR", orders_enabled: true,
    },
    categories,
  };
}

describe("houseHighlight", () => {
  it("o primeiro destaque com preço e sem preço escondido", () => {
    const m = menu([
      cat("c1", [item("a"), item("b", { featured: true, hide_price: true }), item("c", { featured: true, price_cents: 0 })]),
      cat("c2", [item("d", { featured: true }), item("e", { featured: true })]),
    ]);
    expect(houseHighlight(m, NOW)?.id).toBe("d");
  });
  it("destaque com tamanhos conta como tendo preço", () => {
    const m = menu([cat("c1", [item("a", { featured: true, price_cents: 0, price_options: [{ label: "G", price_cents: 5000 }] })])]);
    expect(houseHighlight(m, NOW)?.id).toBe("a");
  });
  it("pula a categoria fora do horário agora (almoço às 20h)", () => {
    const m = menu([
      cat("almoco", [item("x", { featured: true })], { available_from: "11:00:00", available_to: "15:00:00" }),
      cat("noite", [item("y", { featured: true })]),
    ]);
    expect(houseHighlight(m, NOW)?.id).toBe("y");
  });
  it("sem destaque: o primeiro prato com foto", () => {
    const m = menu([cat("c1", [item("semfoto", { media: [] }), item("comfoto")])]);
    expect(houseHighlight(m, NOW)?.id).toBe("comfoto");
  });
  it("cardápio vazio (ou sem foto nenhuma) → null", () => {
    expect(houseHighlight(menu([]), NOW)).toBeNull();
    expect(houseHighlight(menu([cat("c1", [item("a", { media: [] })])]), NOW)).toBeNull();
  });
});

describe("código do telão guardado na TV (tl-code:<slug>)", () => {
  const HASH = "a".repeat(64);
  const T = 1_000_000_000;
  const rec = (exp: number, over: Record<string, unknown> = {}) => JSON.stringify({ code: "K7M3QX", exp, hash: HASH, ...over });
  it("reaproveita na recarga enquanto vale, só para o mesmo segredo", () => {
    expect(savedPairCode(rec(T + 5 * 60_000), HASH, T)).toEqual({ code: "K7M3QX", exp: T + 5 * 60_000 });
    expect(savedPairCode(rec(T + 5 * 60_000), "b".repeat(64), T)).toBeNull();
    expect(pairCodeRecord({ code: "K7M3QX", exp: T + 60_000 }, HASH)).toBe(rec(T + 60_000));
  });
  it("renova só depois de vencer: exp + 1 s", () => {
    expect(pairCodeDue({ code: "K7M3QX", exp: T }, T + 999)).toBe(false);
    expect(pairCodeDue({ code: "K7M3QX", exp: T }, T + 1_000)).toBe(true);
    expect(pairCodeDue(null, T)).toBe(true);
    expect(savedPairCode(rec(T), HASH, T + 999)).not.toBeNull();
    expect(savedPairCode(rec(T), HASH, T + 1_000)).toBeNull();
  });
  it("lixo, código fora do formato ou prazo absurdo (relógio mexido): ignora", () => {
    expect(savedPairCode(null, HASH, T)).toBeNull();
    expect(savedPairCode("{", HASH, T)).toBeNull();
    expect(savedPairCode("null", HASH, T)).toBeNull();
    expect(savedPairCode(rec(T + 60_000, { code: "k7m3qx" }), HASH, T)).toBeNull();
    expect(savedPairCode(rec(T + 60_000, { code: "K7M3Q0" }), HASH, T)).toBeNull();
    expect(savedPairCode(rec(Number.NaN), HASH, T)).toBeNull();
    expect(savedPairCode(rec(T + 12 * 60_000), HASH, T)).toBeNull();
  });
});

describe("tvAccent: a cor da casa e os tons claros, prontos para o CSS", () => {
  it("hexadecimal vira os 5 tons; #abc é aceito", () => {
    expect(tvAccent("#B8862F")).toEqual({
      "--accent": "#b8862f",
      "--accent-9": "rgba(184, 134, 47, 0.09)",
      "--accent-16": "rgba(184, 134, 47, 0.16)",
      "--accent-56": "rgba(184, 134, 47, 0.56)",
      "--accent-70": "rgba(184, 134, 47, 0.7)",
    });
    expect(tvAccent("#abc")["--accent"]).toBe("#aabbcc");
  });
  it("qualquer outra coisa (vazio, nome, injeção) cai no dourado do cardápio", () => {
    for (const c of [null, undefined, "", "red", "#12345", "red; background:url(x)"]) expect(tvAccent(c)["--accent"]).toBe("#e8b04b");
  });
});

describe("priceInfo: o preço que aparece junto do nome", () => {
  it("prato simples: promoção, senão o preço", () => {
    expect(priceInfo(item("x", { price_cents: 4200 }))).toEqual({ cents: 4200, from: false });
    expect(priceInfo(item("x", { price_cents: 4200, promo_price_cents: 3900 }))).toEqual({ cents: 3900, from: false });
  });
  it("com tamanhos: o menor, 'a partir de' só quando os preços variam", () => {
    const sizes = [{ label: "Broto", price_cents: 3800 }, { label: "Grande", price_cents: 5400 }];
    expect(priceInfo(item("x", { price_options: sizes }))).toEqual({ cents: 3800, from: true });
    expect(priceInfo(item("x", { price_options: [{ label: "Única", price_cents: 5400 }] }))).toEqual({ cents: 5400, from: false });
  });
  it("preço escondido ou zero: nada", () => {
    expect(priceInfo(item("x", { hide_price: true }))).toBeNull();
    expect(priceInfo(item("x", { price_cents: 0 }))).toBeNull();
    expect(priceInfo(item("x", { price_options: [{ label: "G", price_cents: 0 }] }))).toBeNull();
    expect(priceInfo(undefined)).toBeNull();
  });
});

describe("tvBgSize: o canvas do fundo no formato da tela", () => {
  it("deitada 16:9: 64×36; em pé 9:16: 36×64 (sem esticar a foto)", () => {
    expect(tvBgSize(1920, 1080)).toEqual({ w: 64, h: 36 });
    expect(tvBgSize(1080, 1920)).toEqual({ w: 36, h: 64 });
  });
  it("outros formatos guardam a proporção com 64 no lado maior; tela sem medida volta ao 64×36", () => {
    expect(tvBgSize(1000, 1000)).toEqual({ w: 64, h: 64 });
    expect(tvBgSize(768, 1024)).toEqual({ w: 48, h: 64 });
    expect(tvBgSize(0, 0)).toEqual({ w: 64, h: 36 });
    expect(tvBgSize(Number.NaN, 500)).toEqual({ w: 64, h: 36 });
    expect(tvBgSize(5000, 10)).toEqual({ w: 64, h: 1 });
  });
});

describe("tvSlow", () => {
  it("TV fraca: média acima de 24 ms por quadro nos primeiros 2 s", () => {
    expect(tvSlow(120, 2000)).toBe(false); // 16,7 ms
    expect(tvSlow(84, 2000)).toBe(false); // 23,8 ms
    expect(tvSlow(80, 2000)).toBe(true); // 25 ms
    expect(tvSlow(0, 2000)).toBe(true); // nenhum quadro: travada
    expect(tvSlow(10, 0)).toBe(false); // sem medida
  });
});

describe("tvReloadDue", () => {
  const t0 = Date.parse("2026-10-16T20:00:00Z");
  it("recarrega depois de 3 h", () => {
    expect(TV_RELOAD_MS).toBe(3 * 60 * 60_000);
    expect(tvReloadDue(t0, t0 + TV_RELOAD_MS - 1)).toBe(false);
    expect(tvReloadDue(t0, t0 + TV_RELOAD_MS)).toBe(true);
  });
});
