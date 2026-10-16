import { describe, expect, it } from "vitest";
import type { MenuCategory, MenuItem, PublicMenu } from "@/lib/menu/types";
import {
  BALLOON_MIN_BAND, balloonMode, balloonNeed, buyState, clockSkew, clockText, houseHighlight, leaderOf, localTime,
  muralColumns, pollDelay, pollTiming, questionText, refFrom, relativeTime, shownPcts,
  backoff, pollChime, TV_POLL_MS, TV_RELOAD_MS, tvMode, tvReloadDue,
} from "./client-logic";
import type { PublicOption, PublicPoll, PublicState } from "./types";

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

describe("balloonMode", () => {
  it("96 px livres ou mais: balão completo; menos: pílula compacta", () => {
    expect(BALLOON_MIN_BAND).toBe(96);
    expect(balloonMode(95)).toBe("compact");
    expect(balloonMode(96)).toBe("full");
  });
  it("com a altura do balão da ficha: precisa caber o balão + 8 px em cima e embaixo", () => {
    expect(balloonNeed("poll")).toBe(134);
    expect(balloonNeed("mural")).toBe(138);
    expect(balloonMode(147, balloonNeed("poll"))).toBe("full"); // 390×844
    expect(balloonMode(82, balloonNeed("poll"))).toBe("compact"); // iPhone SE
    expect(balloonMode(133, balloonNeed("poll"))).toBe("compact");
    expect(balloonMode(134, balloonNeed("poll"))).toBe("full");
    expect(balloonMode(137, balloonNeed("mural"))).toBe("compact");
  });
  it("nunca abaixo do mínimo de 96 px, nem com medida estranha", () => {
    expect(balloonMode(100, 40)).toBe("full");
    expect(balloonMode(90, 40)).toBe("compact");
    expect(balloonMode(Number.NaN)).toBe("compact");
  });
});

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

describe("buyState (Foco 3: prato removido não quebra)", () => {
  const on = { linked: true, enabled: true, pick: false, inCart: 0 };
  it("prato que não está mais no cardápio → indisponível", () => {
    expect(buyState(undefined, on)).toBe("unavailable");
  });
  it("sem prato ligado (opção da enquete só com o texto da casa) → some, não vira indisponível", () => {
    expect(buyState(undefined, { ...on, linked: false })).toBe("hidden");
  });
  it("preço escondido, pedido desligado ou meio a meio em curso → some", () => {
    expect(buyState(item("a", { hide_price: true }), on)).toBe("hidden");
    expect(buyState(item("a"), { ...on, enabled: false })).toBe("hidden");
    expect(buyState(item("a"), { ...on, pick: true })).toBe("hidden");
    expect(buyState(undefined, { ...on, enabled: false })).toBe("hidden");
  });
  it("já no carrinho → in_cart; senão → buy", () => {
    expect(buyState(item("a"), { ...on, inCart: 2 })).toBe("in_cart");
    expect(buyState(item("a"), on)).toBe("buy");
  });
});

describe("pollDelay", () => {
  it("12 s com a camada aberta, 60 s só com o balão, parado com a aba escondida", () => {
    expect(pollDelay(true, true)).toBe(12000);
    expect(pollDelay(false, true)).toBe(60000);
    expect(pollDelay(true, false)).toBeNull();
    expect(pollDelay(false, false)).toBeNull();
  });
});

describe("relativeTime", () => {
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
  it("pt-BR: agora, há 5 min, há 2 h, há 3 d", () => {
    expect(relativeTime(ago(20_000), NOW, "pt-BR")).toBe("agora");
    expect(relativeTime(ago(5 * 60_000), NOW, "pt-BR")).toBe("há 5 min");
    expect(relativeTime(ago(2 * 3_600_000 + 10 * 60_000), NOW, "pt-BR")).toBe("há 2 h");
    expect(relativeTime(ago(3 * 86_400_000), NOW, "pt-BR")).toBe("há 3 d");
  });
  it("outra língua e relógio do celular um pouco adiantado", () => {
    expect(relativeTime(ago(5 * 60_000), NOW, "en")).toBe("5 min ago");
    expect(relativeTime(new Date(NOW.getTime() + 30_000).toISOString(), NOW, "pt-BR")).toBe("agora");
    expect(relativeTime("lixo", NOW, "pt-BR")).toBe("");
  });
});

describe("relógio da enquete", () => {
  it("clockText em m:ss, sem negativo", () => {
    expect(clockText(102_000)).toBe("1:42");
    expect(clockText(102_900)).toBe("1:43");
    expect(clockText(0)).toBe("0:00");
    expect(clockText(-5_000)).toBe("0:00");
    expect(clockText(30 * 60_000)).toBe("30:00");
  });
  it("clockText com 1 h ou mais cabe no anel: 3h47", () => {
    expect(clockText(59 * 60_000 + 59_000)).toBe("59:59");
    expect(clockText(60 * 60_000)).toBe("1h00");
    expect(clockText(227 * 60_000 + 16_000)).toBe("3h47");
  });
  it("pollTiming: o que falta, o total e o ângulo do anel", () => {
    const p = { starts_at: "2026-10-16T23:00:00Z", ends_at: "2026-10-16T23:03:00Z" };
    expect(pollTiming(p, Date.parse("2026-10-16T23:01:18Z"))).toEqual({ left: 102_000, total: 180_000, angle: 204 });
    expect(pollTiming(p, Date.parse("2026-10-16T23:05:00Z"))).toEqual({ left: 0, total: 180_000, angle: 0 });
    expect(pollTiming(p, Date.parse("2026-10-16T22:59:00Z")).angle).toBe(360);
  });
  it("clockSkew: só corrige celular com relógio muito errado", () => {
    const server = "2026-10-16T23:00:00Z";
    expect(clockSkew(server, Date.parse(server) + 60_000)).toBe(0);
    expect(clockSkew(server, Date.parse(server) - 119_000)).toBe(0);
    expect(clockSkew(server, Date.parse(server) - 10 * 60_000)).toBe(10 * 60_000);
    expect(clockSkew("lixo", Date.parse(server))).toBe(0);
  });
});

describe("muralColumns", () => {
  it("2 colunas desencontradas: esquerda 4:5, 1:1…; direita 1:1, 4:5…", () => {
    const { left, right } = muralColumns(["p0", "p1", "p2", "p3", "p4"]);
    expect(left).toEqual([{ post: "p0", ar: "4 / 5", i: 0 }, { post: "p2", ar: "1 / 1", i: 2 }, { post: "p4", ar: "4 / 5", i: 4 }]);
    expect(right).toEqual([{ post: "p1", ar: "1 / 1", i: 1 }, { post: "p3", ar: "4 / 5", i: 3 }]);
  });
});

describe("porcentagens na tela", () => {
  const opts = (pcts: number[]): PublicOption[] => pcts.map((pct, k) => ({ id: (["a", "b", "c"] as const)[k], label: "", item_id: null, pct }));
  it("com votos no servidor, mostra o servidor", () => {
    expect(shownPcts({ has_votes: true, options: opts([46, 34, 20]) }, "b")).toEqual({ a: 46, b: 34, c: 20 });
  });
  it("primeiro voto ainda fora do placar: 100% no meu, sem inventar contagem", () => {
    expect(shownPcts({ has_votes: false, options: opts([0, 0, 0]) }, "c")).toEqual({ a: 0, b: 0, c: 100 });
    expect(shownPcts({ has_votes: false, options: opts([0, 0]) }, null)).toEqual({ a: 0, b: 0 });
  });
  it("leaderOf: a maior; no empate, a primeira; tudo zero, nenhuma", () => {
    expect(leaderOf({ a: 20, b: 46, c: 34 })).toBe("b");
    expect(leaderOf({ a: 50, b: 50 })).toBe("a");
    expect(leaderOf({ a: 0, b: 0 })).toBeNull();
  });
});

describe("textos que dependem do lugar", () => {
  it("refFrom: só telao e story", () => {
    expect(refFrom("?ref=telao")).toBe("telao");
    expect(refFrom("?mesa=E74B9X&ref=story")).toBe("story");
    expect(refFrom("?ref=instagram")).toBeNull();
    expect(refFrom("")).toBeNull();
  });
  it("localTime: hora no fuso do restaurante, no jeito da língua", () => {
    expect(localTime("2026-10-17T00:00:00Z", "America/Sao_Paulo", "pt-BR")).toBe("21h");
    expect(localTime("2026-10-17T00:30:00Z", "America/Sao_Paulo", "pt-BR")).toBe("21h30");
    expect(localTime("lixo", "America/Sao_Paulo", "pt-BR")).toBe("");
  });
  it("questionText: modelo traduzido; personalizada, o texto da casa", () => {
    expect(questionText({ template: "dessert", question: "Qual doce?" }, "pt-BR")).toBe("Qual sobremesa sai hoje?");
    expect(questionText({ template: "music", question: "x" }, "en")).toBe("What should play next?");
    expect(questionText({ template: "custom", question: "Qual sai primeiro?" }, "en")).toBe("Qual sai primeiro?");
  });
});

// ---------- Telão ----------

function tvState(over: Partial<PublicState> = {}): PublicState {
  return { v: "x", enabled: true, open: true, now: NOW.toISOString(), poll: null, next: null, mural: [], has_tv: true, instagram: null, ...over };
}
function tvPoll(over: Partial<PublicPoll> = {}): PublicPoll {
  return {
    id: "p1", template: "dessert", question: "", starts_at: "2026-10-16T22:50:00Z", ends_at: "2026-10-16T23:10:00Z",
    closed: false, has_votes: true, winner: null,
    options: [{ id: "a", label: "A", item_id: null, pct: 60 }, { id: "b", label: "B", item_id: null, pct: 40 }],
    ...over,
  };
}

describe("backoff do telão", () => {
  it("4, 8, 16 e 30 s no máximo", () => {
    expect(backoff(0)).toBe(4000);
    expect(backoff(1)).toBe(8000);
    expect(backoff(2)).toBe(16000);
    expect(backoff(3)).toBe(30000);
    expect(backoff(9)).toBe(30000);
  });
  it("valor estranho volta ao começo; a consulta normal é de 4 s", () => {
    expect(backoff(-1)).toBe(4000);
    expect(backoff(Number.NaN)).toBe(4000);
    expect(backoff(Number.POSITIVE_INFINITY)).toBe(30000);
    expect(TV_POLL_MS).toBe(4000);
  });
});

describe("tvMode", () => {
  it("desligada, ou sem estado: nada da Comunidade na tela", () => {
    expect(tvMode(null)).toBe("off");
    expect(tvMode(tvState({ enabled: false }))).toBe("off");
  });
  it("enquete aberta: barras; encerrada com votos: barras com a vencedora", () => {
    expect(tvMode(tvState({ poll: tvPoll() }))).toBe("poll");
    expect(tvMode(tvState({ poll: tvPoll({ has_votes: false }) }))).toBe("poll");
    expect(tvMode(tvState({ poll: tvPoll({ closed: true, winner: "a" }) }))).toBe("poll");
  });
  it("encerrada sem votos, sem enquete ou fora do horário: fotos e destaque", () => {
    expect(tvMode(tvState({ poll: tvPoll({ closed: true, has_votes: false }) }))).toBe("idle");
    expect(tvMode(tvState())).toBe("idle");
    expect(tvMode(tvState({ open: false }))).toBe("idle");
  });
});

describe("tvReloadDue", () => {
  const t0 = Date.parse("2026-10-16T20:00:00Z");
  it("recarrega depois de 3 h, só sem enquete aberta", () => {
    expect(TV_RELOAD_MS).toBe(3 * 60 * 60_000);
    expect(tvReloadDue(t0, t0 + TV_RELOAD_MS - 1, false)).toBe(false);
    expect(tvReloadDue(t0, t0 + TV_RELOAD_MS, false)).toBe(true);
    expect(tvReloadDue(t0, t0 + 5 * TV_RELOAD_MS, true)).toBe(false);
  });
});

describe("pollChime", () => {
  it("toca só quando abre uma enquete nova depois da primeira leitura", () => {
    expect(pollChime(undefined, tvState({ poll: tvPoll() }))).toEqual({ open: "p1", chime: false });
    expect(pollChime(null, tvState({ poll: tvPoll() }))).toEqual({ open: "p1", chime: true });
    expect(pollChime("p1", tvState({ poll: tvPoll() }))).toEqual({ open: "p1", chime: false });
    expect(pollChime("p0", tvState({ poll: tvPoll() }))).toEqual({ open: "p1", chime: true });
  });
  it("enquete encerrada ou sem enquete: não toca e esquece a aberta", () => {
    expect(pollChime("p1", tvState({ poll: tvPoll({ closed: true }) }))).toEqual({ open: null, chime: false });
    expect(pollChime("p1", tvState())).toEqual({ open: null, chime: false });
    expect(pollChime("p1", null)).toEqual({ open: null, chime: false });
  });
});
