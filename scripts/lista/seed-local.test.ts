import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { COUNTRIES, TAG_IDS } from "../../src/lib/menu/tags";
import { parseDoughs } from "../../src/lib/orders/dough";
import { RESTAURANTS, SLUGS, assertLocalNocodb, buildSeed, photoPath, restaurantUid, run, seedUid } from "./seed-local.mjs";

// O seed da lista só mexe no NocoDB do Docker: qualquer outro endereço é recusado antes de
// qualquer chamada. As linhas têm uids fixos, para rodar de novo atualizar em vez de duplicar.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NOW = new Date("2026-10-20T12:00:00.000Z");
const seed = (o = {}) => buildSeed({ now: NOW, userId: "u-1", ...o });
const rid = (slug: string) => restaurantUid(slug);

describe("recusa NocoDB que não é local", () => {
  it("assertLocalNocodb recusa a nuvem e aceita só http://localhost", () => {
    expect(() => assertLocalNocodb("https://app.nocodb.com")).toThrow(/Recusado/);
    expect(assertLocalNocodb("http://localhost:8080")).toBe("http://localhost:8080");
  });

  it("run com https://app.nocodb.com lança sem nenhuma chamada de rede (rodar e desfazer)", async () => {
    const fetchSpy = vi.fn();
    const env = { NOCODB_URL: "https://app.nocodb.com", NOCODB_API_TOKEN: "x" };
    await expect(run(env, [], fetchSpy, () => {})).rejects.toThrow(/Recusado/);
    await expect(run(env, ["--desfazer"], fetchSpy, () => {})).rejects.toThrow(/Recusado/);
    await expect(run({ NOCODB_API_TOKEN: "x" }, [], fetchSpy, () => {})).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("buildSeed", () => {
  it("cria os três restaurantes com uids fixos e estáveis", () => {
    const a = seed();
    const b = seed();
    expect(a.restaurants.map((r: { slug: string }) => r.slug)).toEqual(SLUGS);
    expect(a).toEqual(b);
    for (const rows of Object.values(a).flat() as { uid?: string }[]) if (rows.uid) expect(rows.uid).toMatch(UUID);
    const uids = [...a.restaurants, ...a.categories, ...a.items, ...a.media, ...a.translations, ...a.tables].map((r: { uid: string }) => r.uid);
    expect(new Set(uids).size).toBe(uids.length);
    expect(seedUid("x")).toBe(seedUid("x"));
  });

  it("Forno Aurora: identidade, pedidos e 6 idiomas", () => {
    const r = seed().restaurants.find((x: { slug: string }) => x.slug === "forno-aurora");
    expect(r).toMatchObject({ name: "Forno Aurora", brand_color: "#E8B04B", font_theme: "moderno", logo_path: "/demo/logo-forno-aurora.png", address: "Rua das Acácias, 214 · Vila Aurora", orders_enabled: true });
    expect(r.languages).toEqual(["pt-BR", "en", "es", "fr", "it", "de"]);
    expect(r.opening_hours).toHaveLength(7);
    expect(r.opening_hours[0]).toEqual([{ open: "00:00", close: "23:00" }]);
    expect(r.cover_image_path).toMatch(/^\/demo\//);
  });

  it("Casa Nonna: cor, fonte, endereço, até 22h30 e Vinhos sem foto de categoria com Tintos e Brancos", () => {
    const s = seed();
    const r = s.restaurants.find((x: { slug: string }) => x.slug === "casa-nonna")!;
    expect(r).toMatchObject({ brand_color: "#9E2A3A", font_theme: "boutique", address: "Rua Itália, 88 · Bixiga" });
    expect(r.opening_hours[3]).toEqual([{ open: "00:00", close: "22:30" }]);
    const vinhos = (s.categories as { uid: string }[]).find((c) => c.uid === seedUid("cat:casa-nonna:vinhos"))!;
    expect(s.media.some((m: { category_id: string | null }) => m.category_id === vinhos.uid)).toBe(false);
    const subs = s.items.filter((i: { category_id: string }) => i.category_id === vinhos.uid).map((i: { subgroup: string }) => i.subgroup);
    expect([...new Set(subs)]).toEqual(["Tintos", "Brancos"]);
    const massas = s.items.filter((i: { category_id: string }) => i.category_id === seedUid("cat:casa-nonna:massas")).map((i: { subgroup: string }) => i.subgroup);
    expect([...new Set(massas)]).toEqual(["Clássicas da Nonna", "Molhos leves"]);
  });

  it("Casa Simples é incompleta de propósito", () => {
    const s = seed();
    const r = s.restaurants.find((x: { slug: string }) => x.slug === "casa-simples");
    expect(r).toMatchObject({ brand_color: null, logo_path: null, cover_image_path: null, cover_video_path: null, address: null, opening_hours: null, show_hours: false });
    expect(s.categories.filter((c: { restaurant_id: string }) => c.restaurant_id === rid("casa-simples"))).toHaveLength(1);
    expect(s.media.filter((m: { restaurant_id: string }) => m.restaurant_id === rid("casa-simples"))).toHaveLength(0);
    const items = s.items.filter((i: { restaurant_id: string }) => i.restaurant_id === rid("casa-simples"));
    expect(items).toHaveLength(3);
    expect(items.filter((i: { hide_price: boolean }) => i.hide_price)).toHaveLength(1);
    expect(items.filter((i: { promo_price_cents: number | null }) => i.promo_price_cents != null)).toHaveLength(1);
  });

  it("Aurora cobre os casos do plano", () => {
    const s = seed();
    const aur = <T extends Record<string, unknown>>(rows: T[]) => rows.filter((r) => r.restaurant_id === rid("forno-aurora"));
    const items = aur(s.items) as { name: string; price_cents: number; hide_price: boolean; promo_price_cents: number | null; price_options: unknown; featured: boolean; active: boolean; category_id: string; special_every_h?: number }[];
    expect(items.some((i) => i.hide_price)).toBe(true);
    expect(items.some((i) => i.promo_price_cents != null)).toBe(true);
    expect(items.some((i) => Array.isArray(i.price_options))).toBe(true);
    expect(items.some((i) => i.featured)).toBe(true);
    const cats = aur(s.categories) as { uid: string; name: string; special: boolean; available_from: string | null; available_to: string | null; half_half: boolean; doughs?: unknown }[];
    const empty = cats.find((c) => !items.some((i) => i.category_id === c.uid && i.active));
    expect(empty?.name).toBe("Bebidas");
    expect(cats.some((c) => c.available_from === "03:00:00" && c.available_to === "03:30:00")).toBe(true);
    const sp = cats.find((c) => c.special)!;
    const spItem = items.find((i) => i.category_id === sp.uid)!;
    expect(spItem.promo_price_cents).toBeLessThan(spItem.price_cents);
    expect(spItem.special_every_h).toBe(2);
    expect(aur(s.tables)).toMatchObject([{ code: "AURORA1", active: true }]);
    const pizzas = cats.find((c) => c.name === "Pizzas")!;
    expect(pizzas.half_half).toBe(true);
    expect(parseDoughs(pizzas.doughs)).toEqual([{ label: "Tradicional", extra_cents: 0 }, { label: "Fina", extra_cents: 500 }]);
    const subs = (items as unknown as { category_id: string; subgroup: string }[]).filter((i) => i.category_id === pizzas.uid).map((i) => i.subgroup);
    expect([...new Set(subs)]).toEqual(["Tradicionais", "Especiais"]);
  });

  it("traduções em inglês para categorias e pratos da Aurora", () => {
    const tr = seed().translations as { restaurant_id: string; category_id: string | null; item_id: string | null; language: string }[];
    expect(tr.every((t) => t.language === "en" && t.restaurant_id === rid("forno-aurora"))).toBe(true);
    expect(tr.filter((t) => t.category_id).length).toBeGreaterThanOrEqual(3);
    expect(tr.filter((t) => t.item_id).length).toBeGreaterThanOrEqual(5);
  });

  it("sem as colunas novas, não grava subgroup nem doughs", () => {
    const s = seed({ columns: { subgroup: false, doughs: false } });
    expect(s.items.some((i: object) => "subgroup" in i)).toBe(false);
    expect(s.categories.some((c: object) => "doughs" in c)).toBe(false);
  });

  it("liga os restaurantes ao usuário de teste, só se ele existir", () => {
    expect(seed().members).toHaveLength(3);
    expect(seed().members[0]).toMatchObject({ user_id: "u-1", role: "owner" });
    expect(seed({ userId: null }).members).toHaveLength(0);
  });

  it("selos, países e fotos existem de verdade", () => {
    const s = seed();
    for (const i of s.items as { tags: string[]; country: string | null }[]) {
      for (const t of i.tags) expect(TAG_IDS).toContain(t);
      if (i.country) expect(Object.keys(COUNTRIES)).toContain(i.country);
    }
    for (const m of s.media as { storage_path: string }[]) {
      expect(existsSync(path.join(__dirname, "../../public", m.storage_path)), m.storage_path).toBe(true);
    }
    for (const def of Object.values(RESTAURANTS) as { logo_path: string | null; cover_image_path: string | null }[]) {
      for (const p of [def.logo_path, def.cover_image_path]) if (p) expect(existsSync(path.join(__dirname, "../../public", p)), p).toBe(true);
    }
    expect(photoPath("pz-queijos")).toBe("/demo/pz-queijos.jpg");
    expect(photoPath("pz-pepperoni")).toBe("/demo/pz-pepperoni-t.jpg");
  });
});
