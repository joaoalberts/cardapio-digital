import { describe, expect, it } from "vitest";
import { activeIndex, brandTokens, formatFromHash, groupSubgroups, hintSeen, HINT_KEY, listCats, listPrice, normalizeText, parseSubgroup, searchItems } from "./list";
import type { MenuCategory, MenuItem } from "./types";

const item = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, name: id, description: "", price_cents: 1000, media: [], category_id: "c", half_half: false, ...extra }) as unknown as MenuItem;
const cat = (id: string, items: MenuItem[]) => ({ id, name: id, items }) as MenuCategory;
const special = { every_h: 1, show_s: 10, days: [], from: null, to: null, limit: 1 };

describe("listCats", () => {
  it("tira a categoria Destaques e mantém as outras na ordem", () => {
    const cats = [cat("destaques", [item("a")]), cat("massas", [item("b")]), cat("pizzas", [item("c")])];
    expect(listCats(cats).map((c) => c.id)).toEqual(["massas", "pizzas"]);
  });
  it("tira o prato especial e mantém os outros da categoria", () => {
    const cats = [cat("massas", [item("a"), item("oferta", { special }), item("b")])];
    expect(listCats(cats)[0].items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(cats[0].items).toHaveLength(3); // não mexe na lista de entrada
  });
  it("tira a categoria que só tinha especial (e a que já era vazia)", () => {
    const cats = [cat("relampago", [item("oferta", { special })]), cat("vazia", []), cat("massas", [item("a")])];
    expect(listCats(cats).map((c) => c.id)).toEqual(["massas"]);
  });
});

describe("groupSubgroups", () => {
  it("agrupa pelo rótulo na ordem em que ele aparece pela primeira vez, mantendo a ordem do painel", () => {
    const a = item("a");
    const b = item("b", { subgroup: "Tintos" });
    const c = item("c");
    const d = item("d", { subgroup: "Brancos" });
    const e = item("e", { subgroup: "Tintos" });
    expect(groupSubgroups([a, b, c, d, e])).toEqual([
      { label: null, items: [a, c] },
      { label: "Tintos", items: [b, e] },
      { label: "Brancos", items: [d] },
    ]);
  });
  it("sem nenhum rótulo, devolve um bloco só, sem rótulo", () => {
    const a = item("a");
    const b = item("b");
    expect(groupSubgroups([a, b])).toEqual([{ label: null, items: [a, b] }]);
  });
  it("rótulo só com espaços conta como sem rótulo", () => {
    const a = item("a", { subgroup: "  " });
    const b = item("b", { subgroup: null });
    expect(groupSubgroups([a, b])).toEqual([{ label: null, items: [a, b] }]);
  });
  it("lista vazia não tem bloco", () => {
    expect(groupSubgroups([])).toEqual([]);
  });
});

describe("parseSubgroup", () => {
  it("apara e junta os espaços repetidos", () => {
    expect(parseSubgroup("  Vinhos   tintos ")).toBe("Vinhos tintos");
  });
  it("vazio, só espaços e o que não é texto viram null", () => {
    expect(parseSubgroup("")).toBeNull();
    expect(parseSubgroup("   ")).toBeNull();
    expect(parseSubgroup(null)).toBeNull();
    expect(parseSubgroup(undefined)).toBeNull();
    expect(parseSubgroup(42)).toBeNull();
  });
  it("corta em 40 caracteres", () => {
    expect(parseSubgroup("a".repeat(50))).toBe("a".repeat(40));
  });
  it("o corte não deixa espaço sobrando no fim nem parte um emoji ao meio", () => {
    expect(parseSubgroup(`${"a".repeat(39)} bbbb`)).toBe("a".repeat(39));
    expect(parseSubgroup("🍷".repeat(45))).toBe("🍷".repeat(40));
  });
});

describe("normalizeText", () => {
  it("minúsculas e sem acento", () => {
    expect(normalizeText("Pão de Queijo")).toBe("pao de queijo");
    expect(normalizeText("Crème Brûlée à Ação")).toBe("creme brulee a acao");
  });
});

describe("searchItems", () => {
  const massas = cat("massas", [
    item("risoto", { name: "Risoto", description: "Arroz arbóreo com queijo Parmesão e manteiga." }),
    item("pomodoro", { name: "Penne pomodoro", description: "Tomate e manjericão.", tags: ["vegano"] }),
  ]);
  const pizzas = cat("pizzas", [item("marg", { name: "Margherita", description: "Fior di latte.", tags: ["sem_gluten"] })]);
  const cats = [massas, pizzas];

  it("acha pela descrição sem ligar para maiúscula nem acento", () => {
    const r = searchItems(cats, "parmesao", "pt-BR");
    expect(r.map((x) => x.item.id)).toEqual(["risoto"]);
    expect(r[0].cat).toBe(massas);
  });
  it("acha pelo nome", () => {
    expect(searchItems(cats, "MARGHERITA", "pt-BR").map((x) => x.item.id)).toEqual(["marg"]);
  });
  it("acha pelo nome do selo", () => {
    expect(searchItems(cats, "vegano", "pt-BR").map((x) => x.item.id)).toEqual(["pomodoro"]);
  });
  it("o selo é procurado no idioma da tela", () => {
    expect(searchItems(cats, "gluten-free", "en").map((x) => x.item.id)).toEqual(["marg"]);
    expect(searchItems(cats, "gluten-free", "pt-BR")).toEqual([]);
    expect(searchItems(cats, "sem gluten", "pt-BR").map((x) => x.item.id)).toEqual(["marg"]);
  });
  it("devolve na ordem das categorias e dos pratos, com a categoria de cada um", () => {
    const r = searchItems(cats, "o", "pt-BR");
    expect(r.map((x) => [x.cat.id, x.item.id])).toEqual([
      ["massas", "risoto"],
      ["massas", "pomodoro"],
      ["pizzas", "marg"],
    ]);
  });
  it("busca vazia ou só com espaços não devolve nada", () => {
    expect(searchItems(cats, "", "pt-BR")).toEqual([]);
    expect(searchItems(cats, "  ", "pt-BR")).toEqual([]);
  });
  it("espaços repetidos no meio do que foi digitado contam como um só", () => {
    expect(searchItems(cats, "penne   pomodoro", "pt-BR").map((x) => x.item.id)).toEqual(["pomodoro"]);
    expect(searchItems(cats, " sem  gluten ", "pt-BR").map((x) => x.item.id)).toEqual(["marg"]);
  });
  it("sem resultado devolve lista vazia", () => {
    expect(searchItems(cats, "sushi", "pt-BR")).toEqual([]);
  });
});

describe("listPrice", () => {
  // Intl usa espaço inquebrável entre "R$" e o número; o teste compara com espaço comum.
  const lp = (i: MenuItem, lang = "pt-BR") => {
    const p = listPrice(i, lang);
    return p && { from: p.from, old: p.old && p.old.replace(/\s/g, " "), now: p.now.replace(/\s/g, " ") };
  };

  it("valor fechado sai sem ,00", () => {
    expect(lp(item("a", { price_cents: 6900 }))).toEqual({ from: false, old: null, now: "R$ 69" });
  });
  it("valor com centavos mantém as duas casas", () => {
    expect(lp(item("a", { price_cents: 3490 }))?.now).toBe("R$ 34,90");
  });
  it("com tamanhos, mostra o menor com 'a partir de'", () => {
    const sizes = [
      { label: "Para dividir", price_cents: 7900 },
      { label: "Individual", price_cents: 5900 },
    ];
    expect(lp(item("a", { price_cents: 7900, price_options: sizes }))).toEqual({ from: true, old: null, now: "R$ 59" });
  });
  it("com promoção, traz o preço cheio no old e o promocional no now", () => {
    expect(lp(item("a", { price_cents: 8900, promo_price_cents: 6900 }))).toEqual({ from: false, old: "R$ 89", now: "R$ 69" });
  });
  it("preço escondido não mostra nada", () => {
    expect(lp(item("a", { price_cents: 6900, hide_price: true }))).toBeNull();
    expect(lp(item("a", { price_cents: 6900, hide_price: true, promo_price_cents: 5000 }))).toBeNull();
  });
  it("lista vazia de tamanhos cai no preço normal", () => {
    expect(lp(item("a", { price_cents: 6900, price_options: [] }))).toEqual({ from: false, old: null, now: "R$ 69" });
  });
  it("segue o idioma", () => {
    expect(lp(item("a", { price_cents: 3490 }), "en")?.now).toBe("R$34.90");
  });
});

// Contraste (WCAG) calculado aqui de forma independente, para conferir o que brandTokens devolve.
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c: number[]) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const mix = (a: string, b: string, t: number) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
const lum = (h: string) => {
  const [r, g, b] = rgb(h).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
// A folha de vidro onde o texto na cor do restaurante é medido.
const sheetOf = (brand: string) => mix(mix("#17110e", brand, 0.07), "#f7efe6", 0.09);

describe("brandTokens", () => {
  it("cor clara (dourado) já passa: o texto fica na própria cor e o que vai por cima é escuro", () => {
    expect(brandTokens("#E8B04B")).toEqual({ brand: "#e8b04b", brandText: "#e8b04b", onBrand: "#1a1210" });
  });
  it("cor escura (vinho) é clareada até dar contraste no fundo, e o que vai por cima é branco", () => {
    const t = brandTokens("#9E2A3A");
    expect(t.brand).toBe("#9e2a3a");
    expect(t.brandText).not.toBe("#9e2a3a");
    expect(ratio(t.brandText, sheetOf("#9e2a3a"))).toBeGreaterThanOrEqual(4.5);
    expect(t.onBrand).toBe("#ffffff");
  });
  it("cor inválida, vazia ou null usa o dourado padrão", () => {
    const padrao = brandTokens("#e8b04b");
    expect(brandTokens("verde")).toEqual(padrao);
    expect(brandTokens("")).toEqual(padrao);
    expect(brandTokens(null)).toEqual(padrao);
    expect(brandTokens("#e8b04")).toEqual(padrao);
  });
  it("maiúscula e espaços em volta não mudam o resultado", () => {
    expect(brandTokens(" #9E2A3A ")).toEqual(brandTokens("#9e2a3a"));
  });
  it("qualquer cor termina e passa de 4,5:1 sobre a folha (inclusive preto, branco e a cor do texto)", () => {
    const passos = [0, 51, 102, 153, 204, 255];
    for (const r of passos) for (const g of passos) for (const b of passos) {
      const hex = toHex([r, g, b]);
      const t = brandTokens(hex);
      expect(ratio(t.brandText, sheetOf(hex)), hex).toBeGreaterThanOrEqual(4.5);
    }
    expect(brandTokens("#000000").onBrand).toBe("#ffffff");
    expect(brandTokens("#ffffff").onBrand).toBe("#1a1210");
  });
});

describe("activeIndex", () => {
  const tops = [100, 500, 900];
  it("é a última seção cujo topo já passou da linha", () => {
    expect(activeIndex(tops, 120)).toBe(0);
    expect(activeIndex(tops, 600)).toBe(1);
    expect(activeIndex(tops, 5000)).toBe(2);
  });
  it("topo exatamente na linha já conta", () => {
    expect(activeIndex(tops, 100)).toBe(0);
    expect(activeIndex(tops, 500)).toBe(1);
  });
  it("antes da primeira seção ou sem seções, devolve -1", () => {
    expect(activeIndex(tops, 50)).toBe(-1);
    expect(activeIndex([], 50)).toBe(-1);
  });
  it("no fim da página a última seção fica ativa, mesmo sem o topo chegar à linha", () => {
    // A última categoria curta nunca sobe até a barra: sem isso, tocar nela acenderia a anterior.
    expect(activeIndex(tops, 600, true)).toBe(2);
    expect(activeIndex([], 600, true)).toBe(-1);
  });
});

describe("formatFromHash", () => {
  it("só a âncora #lista abre a lista", () => {
    expect(formatFromHash("#lista")).toBe("lista");
  });
  it("qualquer outra âncora (ou nenhuma) abre os stories", () => {
    expect(formatFromHash("#lista?x")).toBe("stories");
    expect(formatFromHash("")).toBe("stories");
    expect(formatFromHash("#outra")).toBe("stories");
  });
});

describe("hintSeen", () => {
  it("só \"1\" conta como vista", () => {
    expect(hintSeen(null)).toBe(false);
    expect(hintSeen("1")).toBe(true);
    expect(hintSeen("0")).toBe(false);
    expect(hintSeen("")).toBe(false);
  });
  it("a chave é a combinada", () => {
    expect(HINT_KEY).toBe("cardapio-dica-lista");
  });
});
