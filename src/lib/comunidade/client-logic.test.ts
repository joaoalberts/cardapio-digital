import { describe, expect, it } from "vitest";
import type { MenuCategory, MenuItem, PublicMenu } from "@/lib/menu/types";
import {
  BALLOON_MIN_BAND, balloonMode, balloonNeed, buyState, clockSkew, clockText, houseHighlight, leaderOf, localTime,
  minuteClock, muralLayout, orderableNow, pairCodeDue, pairCodeRecord, pollDelay, pollTiming, questionText, refFrom,
  relativeTime, savedPairCode, shownPcts, POLL_OFF_MS,
  balloonPath, buyFlow, cmuReturnDue, halfPartners, lowerFirst, pollOutcome, priceInfo, ringText, sizeChoices, soleLeader, stageCover,
  backoff, pollChime, TV_POLL_MS, TV_RELOAD_MS, tvReloadDue, storyChoices,
  TV_WIN_MS, tvAccent, tvClosedAt, tvFeatSlides, tvLongQuestion, tvOrder, tvScreen, tvSlow,
} from "./client-logic";
import type { PublicOption, PublicPoll, PublicPost, PublicState } from "./types";

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
  it("com a altura do balão da ficha v2 (119 e 123 com a ponta): precisa caber o balão + 16 px", () => {
    expect(balloonNeed("poll")).toBe(135);
    expect(balloonNeed("mural")).toBe(139);
    expect(balloonMode(148, balloonNeed("poll"))).toBe("full"); // 390×844: faixa de 148
    expect(balloonMode(148, balloonNeed("mural"))).toBe("full");
    expect(balloonMode(83, balloonNeed("poll"))).toBe("compact"); // iPhone SE: faixa de 83
    expect(balloonMode(134, balloonNeed("poll"))).toBe("compact");
    expect(balloonMode(135, balloonNeed("poll"))).toBe("full");
    expect(balloonMode(138, balloonNeed("mural"))).toBe("compact");
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
  const m = menu([cat("c1", [item("a")])]);
  const on = { linked: true, enabled: true, pick: false, inCart: 0, menu: m, now: NOW };
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

describe("buyState: mesma regra do carrinho (horário da categoria e produto especial)", () => {
  const almoco = item("x");
  const noite = item("y");
  const flash = item("z", { special: { every_h: 4, show_s: 10, days: [], from: null, to: null, limit: 1 } });
  const m: PublicMenu = {
    ...menu([cat("almoco", [almoco], { available_from: "11:00:00", available_to: "15:00:00" }), cat("noite", [noite])]),
    specials: cat("especiais", [flash]),
  };
  const on = { linked: true, enabled: true, pick: false, inCart: 0, menu: m, now: NOW };
  it("prato de categoria fora do horário → indisponível (20h, almoço das 11h às 15h)", () => {
    expect(buyState(almoco, on)).toBe("unavailable");
    expect(buyState(almoco, { ...on, inCart: 1 })).toBe("unavailable");
  });
  it("no horário da categoria → buy", () => {
    expect(buyState(almoco, { ...on, now: new Date("2026-10-16T15:00:00Z") })).toBe("buy"); // 12h
    expect(buyState(noite, on)).toBe("buy");
  });
  it("produto especial (oferta relâmpago) → indisponível", () => {
    expect(buyState(flash, on)).toBe("unavailable");
  });
  it("sem cardápio carregado → indisponível", () => {
    expect(buyState(noite, { ...on, menu: null })).toBe("unavailable");
  });
  it("orderableNow responde igual ao carrinho", () => {
    expect(orderableNow(m, "x", NOW)).toBe(false);
    expect(orderableNow(m, "y", NOW)).toBe(true);
    expect(orderableNow(m, "z", NOW)).toBe(false);
    expect(orderableNow(m, "sumiu", NOW)).toBe(false);
    // Tamanhos sem escolha ainda são pedíveis (a folha do prato escolhe o tamanho).
    const sizes = menu([cat("c1", [item("t", { price_options: [{ label: "G", price_cents: 5000 }] })])]);
    expect(orderableNow(sizes, "t", NOW)).toBe(true);
  });
});

describe("minuteClock (relógio do provider, que anda a cada minuto)", () => {
  it("minuto cheio e quanto falta para o próximo", () => {
    const t = Date.parse("2026-10-16T23:00:42.500Z");
    expect(minuteClock(t)).toEqual({ minute: Date.parse("2026-10-16T23:00:00Z"), next: 17_500 });
    expect(minuteClock(Date.parse("2026-10-16T23:01:00Z"))).toEqual({ minute: Date.parse("2026-10-16T23:01:00Z"), next: 60_000 });
  });
  it("o almoço volta a ser pedível quando o relógio passa das 11h, sem nova leitura", () => {
    const m = menu([cat("almoco", [item("x")], { available_from: "11:00:00", available_to: "15:00:00" })]);
    const on = { linked: true, enabled: true, pick: false, inCart: 0, menu: m };
    const before = minuteClock(Date.parse("2026-10-16T13:59:30Z")); // 10h59 em São Paulo
    expect(buyState(item("x"), { ...on, now: new Date(before.minute) })).toBe("unavailable");
    const after = minuteClock(Date.parse("2026-10-16T13:59:30Z") + before.next);
    expect(buyState(item("x"), { ...on, now: new Date(after.minute) })).toBe("buy");
  });
});

describe("pollDelay({ open, visible, enabled })", () => {
  it("12 s com a camada aberta, 60 s só com o balão, parado com a aba escondida", () => {
    expect(pollDelay({ open: true, visible: true, enabled: true })).toBe(12000);
    expect(pollDelay({ open: false, visible: true, enabled: true })).toBe(60000);
    expect(pollDelay({ open: true, visible: false, enabled: true })).toBeNull();
    expect(pollDelay({ open: false, visible: false, enabled: true })).toBeNull();
  });
  it("Comunidade desligada (enabled:false): a cada 10 min; escondida, parada", () => {
    expect(POLL_OFF_MS).toBe(10 * 60_000);
    expect(pollDelay({ open: false, visible: true, enabled: false })).toBe(600_000);
    expect(pollDelay({ open: true, visible: true, enabled: false })).toBe(600_000);
    expect(pollDelay({ open: false, visible: false, enabled: false })).toBeNull();
  });
  it("antes da primeira resposta (enabled null): ritmo normal; voltou a ligar, ritmo normal", () => {
    expect(pollDelay({ open: false, visible: true, enabled: null })).toBe(60000);
    expect(pollDelay({ open: false, visible: true, enabled: true })).toBe(60000);
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

describe("muralLayout (página de revista)", () => {
  it("a 1ª foto grande; depois duas quadradas e uma larga, repetindo", () => {
    expect(muralLayout(["p0", "p1", "p2", "p3", "p4", "p5", "p6"])).toEqual([
      { kind: "big", posts: ["p0"], i: 0 },
      { kind: "pair", posts: ["p1", "p2"], i: 1 },
      { kind: "wide", posts: ["p3"], i: 3 },
      { kind: "pair", posts: ["p4", "p5"], i: 4 },
      { kind: "wide", posts: ["p6"], i: 6 },
    ]);
  });
  it("quadrada sozinha no fim vira larga; vazio, nada", () => {
    expect(muralLayout(["p0", "p1"])).toEqual([
      { kind: "big", posts: ["p0"], i: 0 },
      { kind: "wide", posts: ["p1"], i: 1 },
    ]);
    expect(muralLayout(["p0", "p1", "p2", "p3", "p4"]).map((b) => b.kind)).toEqual(["big", "pair", "wide", "wide"]);
    expect(muralLayout([])).toEqual([]);
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

describe("tvScreen: o que o telão mostra", () => {
  const now = NOW.getTime(); // 23:00Z; a enquete de tvPoll termina às 23:10Z
  const closedWin = tvPoll({ closed: true, winner: "a", ends_at: "2026-10-16T22:59:30Z" }); // fechou há 30 s
  it("desligada, ou sem estado: nada da Comunidade na tela", () => {
    expect(tvScreen(null, null, now)).toBe("off");
    expect(tvScreen(tvState({ enabled: false, poll: tvPoll() }), null, now)).toBe("off");
  });
  it("enquete aberta: barras, com ou sem votos", () => {
    expect(tvScreen(tvState({ poll: tvPoll() }), null, now)).toBe("poll");
    expect(tvScreen(tvState({ poll: tvPoll({ has_votes: false }) }), null, now)).toBe("poll");
  });
  it("encerrada com vencedora: \"Deu\" por 45 s contados do fim", () => {
    expect(TV_WIN_MS).toBe(45_000);
    expect(tvScreen(tvState({ poll: closedWin }), null, now)).toBe("win");
    expect(tvScreen(tvState({ poll: closedWin }), null, Date.parse("2026-10-16T22:59:30Z") + TV_WIN_MS - 1)).toBe("win");
    expect(tvScreen(tvState({ poll: closedWin }), null, Date.parse("2026-10-16T22:59:30Z") + TV_WIN_MS)).toBe("feat");
  });
  it("fechada antes da hora pelo painel: conta de quando a TV viu fechada", () => {
    const early = tvPoll({ closed: true, winner: "a" }); // ends_at 23:10Z ainda no futuro
    expect(tvScreen(tvState({ poll: early }), now - 10_000, now)).toBe("win");
    expect(tvScreen(tvState({ poll: early }), now - TV_WIN_MS, now)).toBe("feat");
    // sem a hora em que viu: não inventa 45 s
    expect(tvScreen(tvState({ poll: early }), null, now)).toBe("feat");
  });
  it("empate, sem votos, sem enquete ou fora do horário: destaque da casa", () => {
    const tie = tvPoll({ closed: true, winner: "a", ends_at: "2026-10-16T22:59:50Z", options: [
      { id: "a", label: "A", item_id: null, pct: 50 }, { id: "b", label: "B", item_id: null, pct: 50 }] });
    expect(tvScreen(tvState({ poll: tie }), null, now)).toBe("feat");
    expect(tvScreen(tvState({ poll: tvPoll({ closed: true, has_votes: false, ends_at: "2026-10-16T22:59:50Z" }) }), null, now)).toBe("feat");
    expect(tvScreen(tvState(), null, now)).toBe("feat");
    expect(tvScreen(tvState({ open: false }), null, now)).toBe("feat");
  });
  it("tvClosedAt: o fim marcado ou a hora em que a TV viu fechada, o que vier antes", () => {
    const p = tvPoll({ closed: true });
    expect(tvClosedAt(p, null)).toBe(Date.parse("2026-10-16T23:10:00Z"));
    expect(tvClosedAt(p, now)).toBe(now);
    expect(tvClosedAt(tvPoll({ closed: true, ends_at: "2026-10-16T22:00:00Z" }), now)).toBe(Date.parse("2026-10-16T22:00:00Z"));
    expect(Number.isNaN(tvClosedAt(tvPoll({ ends_at: "lixo" }), null))).toBe(true);
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

describe("tvOrder: a líder sempre em primeiro", () => {
  const o = (id: "a" | "b" | "c", pct: number): PublicOption => ({ id, label: id, item_id: null, pct });
  it("da maior para a menor porcentagem", () => {
    expect(tvOrder([o("a", 19), o("b", 43), o("c", 38)])).toEqual(["b", "c", "a"]);
  });
  it("empate e tudo zero: mantém a ordem da casa", () => {
    expect(tvOrder([o("a", 40), o("b", 40), o("c", 20)])).toEqual(["a", "b", "c"]);
    expect(tvOrder([o("a", 0), o("b", 0)])).toEqual(["a", "b"]);
  });
});

describe("tvLongQuestion e tvSlow", () => {
  it("pergunta longa (mais de 44 letras) desce um tamanho", () => {
    expect(tvLongQuestion("Qual prato sai primeiro hoje?")).toBe(false);
    expect(tvLongQuestion("x".repeat(44))).toBe(false);
    expect(tvLongQuestion("x".repeat(45))).toBe(true);
    expect(tvLongQuestion("  " + "x".repeat(44) + "  ")).toBe(false);
  });
  it("TV fraca: média acima de 24 ms por quadro nos primeiros 2 s", () => {
    expect(tvSlow(120, 2000)).toBe(false); // 16,7 ms
    expect(tvSlow(84, 2000)).toBe(false); // 23,8 ms
    expect(tvSlow(80, 2000)).toBe(true); // 25 ms
    expect(tvSlow(0, 2000)).toBe(true); // nenhum quadro: travada
    expect(tvSlow(10, 0)).toBe(false); // sem medida
  });
});

describe("tvFeatSlides: o que roda no telão sem enquete", () => {
  const post = (id: string, item_id: string, on_tv = true): PublicPost => ({
    id, item_id, thumb: `/t/${id}`, photo: `/f/${id}`, on_tv, created_at: "2026-10-16T22:00:00Z",
  });
  const known = new Set(["burger", "pizza"]);
  it("destaque da casa primeiro, depois as fotos da casa marcadas para o telão", () => {
    expect(tvFeatSlides([post("p1", "pizza"), post("p2", "burger", false), post("p3", "sumiu")], known, "burger")).toEqual([
      { kind: "highlight", item_id: "burger" },
      { kind: "post", item_id: "pizza", post: post("p1", "pizza") },
    ]);
  });
  it("no máximo 8; sem destaque, só as fotos; sem nada, vazio", () => {
    const many = Array.from({ length: 12 }, (_, k) => post(`p${k}`, "pizza"));
    expect(tvFeatSlides(many, known, "burger")).toHaveLength(8);
    expect(tvFeatSlides([post("p1", "pizza")], known, null)).toEqual([{ kind: "post", item_id: "pizza", post: post("p1", "pizza") }]);
    expect(tvFeatSlides([], known, null)).toEqual([]);
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

describe("storyChoices (o que a folha do story oferece)", () => {
  const post = (id: string, item_id: string): PublicPost => ({
    id, item_id, thumb: `/t/${id}`, photo: `/f/${id}`, on_tv: false, created_at: "2026-10-16T22:00:00Z",
  });
  const has = (id: string) => id !== "sumiu";
  const base = { mine: null, canVote: true, highlightId: null, hasItem: has };

  it("enquete com votos: só depois de votar, sem mesa (vê o resultado) ou encerrada", () => {
    const open = tvState({ poll: tvPoll() });
    expect(storyChoices(open, base).poll).toBeNull(); // ainda não votou: a arte mostraria o resultado antes
    expect(storyChoices(open, { ...base, mine: "a" }).poll).toBe("p1");
    expect(storyChoices(open, { ...base, canVote: false }).poll).toBe("p1");
    expect(storyChoices(tvState({ poll: tvPoll({ closed: true, winner: "a" }) }), base).poll).toBe("p1");
  });

  it("enquete sem votos não vira arte (encerrada sem votos mostra o destaque, sem compartilhar)", () => {
    expect(storyChoices(tvState({ poll: tvPoll({ has_votes: false }) }), { ...base, mine: "a" }).poll).toBeNull();
    expect(storyChoices(tvState({ poll: tvPoll({ closed: true, has_votes: false }) }), base).poll).toBeNull();
    expect(storyChoices(tvState(), base).poll).toBeNull();
  });

  it("foto da casa: a pedida; senão a do destaque; senão a mais nova; sempre de prato no cardápio", () => {
    const s = tvState({ mural: [post("x1", "sumiu"), post("x2", "i2"), post("x3", "i3")] });
    expect(storyChoices(s, base).post).toBe("x2");
    expect(storyChoices(s, { ...base, highlightId: "i3" }).post).toBe("x3");
    expect(storyChoices(s, { ...base, post: "x3" }).post).toBe("x3");
    expect(storyChoices(s, { ...base, post: "x1" }).post).toBe("x2"); // a pedida saiu do cardápio
    expect(storyChoices(tvState({ mural: [post("x1", "sumiu")] }), base).post).toBeNull();
  });

  it("desligada ou sem estado: nada", () => {
    expect(storyChoices(null, base)).toEqual({ poll: null, post: null });
    expect(storyChoices(tvState({ enabled: false, poll: tvPoll({ closed: true }), mural: [post("x2", "i2")] }), base)).toEqual({
      poll: null,
      post: null,
    });
  });
});

// ---------- Comunidade v2 (telas do celular) ----------

describe("ringText: o anel do tempo em minutos", () => {
  it("minutos arredondados para cima, com 'min'", () => {
    expect(ringText(41 * 60_000)).toEqual({ n: "41", unit: "min" });
    expect(ringText(40 * 60_000 + 1)).toEqual({ n: "41", unit: "min" });
    expect(ringText(60_000)).toEqual({ n: "1", unit: "min" });
  });
  it("último minuto em segundos; acabou, 0 s", () => {
    expect(ringText(59_999)).toEqual({ n: "1", unit: "min" });
    expect(ringText(59_000)).toEqual({ n: "59", unit: "s" });
    expect(ringText(42_000)).toEqual({ n: "42", unit: "s" });
    expect(ringText(0)).toEqual({ n: "0", unit: "s" });
    expect(ringText(-3_000)).toEqual({ n: "0", unit: "s" });
  });
  it("1 h ou mais: 3h47, sem unidade", () => {
    expect(ringText(60 * 60_000)).toEqual({ n: "1h00", unit: "" });
    expect(ringText(227 * 60_000 + 16_000)).toEqual({ n: "3h47", unit: "" });
    expect(ringText(59 * 60_000 + 30_000)).toEqual({ n: "60", unit: "min" });
  });
});

describe("pollOutcome: deu, empate ou sem votos", () => {
  const opts = (pcts: number[]): PublicOption[] => pcts.map((pct, k) => ({ id: (["a", "b", "c"] as const)[k], label: "", item_id: null, pct }));
  it("venceu com 1 ponto ou mais de diferença; as outras pela %", () => {
    expect(pollOutcome({ has_votes: true, options: opts([31, 52, 17]) })).toEqual({ kind: "win", id: "b", rest: ["a", "c"] });
    expect(pollOutcome({ has_votes: true, options: opts([50, 49, 1]) })).toEqual({ kind: "win", id: "a", rest: ["b", "c"] });
  });
  it("empate nas duas de cima: as duas, e a de fora", () => {
    expect(pollOutcome({ has_votes: true, options: opts([43, 43, 14]) })).toEqual({ kind: "tie", ids: ["a", "b"], rest: ["c"] });
    expect(pollOutcome({ has_votes: true, options: opts([14, 43, 43]) })).toEqual({ kind: "tie", ids: ["b", "c"], rest: ["a"] });
    expect(pollOutcome({ has_votes: true, options: opts([33, 33, 33]) })).toEqual({ kind: "tie", ids: ["a", "b", "c"], rest: [] });
  });
  it("sem votos: nada", () => {
    expect(pollOutcome({ has_votes: false, options: opts([0, 0, 0]) })).toEqual({ kind: "none" });
    expect(pollOutcome({ has_votes: true, options: [] })).toEqual({ kind: "none" });
  });
});

describe("soleLeader: barra acesa só sem empate", () => {
  it("a maior sozinha; empate em cima ou tudo zero, nenhuma", () => {
    expect(soleLeader({ a: 44, b: 37, c: 19 })).toBe("a");
    expect(soleLeader({ a: 43, b: 43, c: 14 })).toBeNull();
    expect(soleLeader({ a: 0, b: 0 })).toBeNull();
    expect(soleLeader({ c: 100 })).toBe("c");
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

describe("Pedir também: direto ou pela folha de tamanhos", () => {
  const sizes = [{ label: "Broto", price_cents: 3800 }, { label: "Grande", price_cents: 5400 }];
  const pizzaA = item("a", { category_id: "pz", half_half: true, price_options: sizes });
  const pizzaB = item("b", { category_id: "pz", half_half: true, price_options: [{ label: "Grande", price_cents: 6000 }] });
  const solo = item("s", { category_id: "pz2", half_half: true, price_cents: 3000 });
  const m = menu([cat("pz", [pizzaA, pizzaB]), cat("pz2", [solo]), cat("c1", [item("burger")])]);
  it("prato simples entra direto; tamanho único também, já com o tamanho", () => {
    expect(buyFlow(item("burger"), m)).toEqual({ kind: "add", option: null });
    expect(buyFlow(item("u", { price_options: [{ label: "Única", price_cents: 1000 }] }), m)).toEqual({ kind: "add", option: "Única" });
    // meio a meio sem outro sabor na categoria: só a inteira
    expect(buyFlow(solo, m)).toEqual({ kind: "add", option: null });
  });
  it("com tamanhos ou meio a meio possível: a folha", () => {
    expect(buyFlow(item("t", { price_options: sizes }), m)).toEqual({ kind: "sheet" });
    expect(buyFlow(item("h", { category_id: "pz", half_half: true, price_cents: 5000 }), menu([cat("pz", [item("h", { category_id: "pz", half_half: true, price_cents: 5000 }), item("i", { category_id: "pz", price_cents: 4000 })])]))).toEqual({ kind: "sheet" });
  });
  it("sizeChoices: os tamanhos com preço; sem tamanhos, a inteira", () => {
    expect(sizeChoices(pizzaA)).toEqual([{ label: "Broto", cents: 3800 }, { label: "Grande", cents: 5400 }]);
    expect(sizeChoices(item("x", { price_cents: 4200 }))).toEqual([{ label: null, cents: 4200 }]);
    expect(sizeChoices(item("x", { hide_price: true }))).toEqual([]);
  });
  it("halfPartners: outros sabores da categoria com o mesmo tamanho", () => {
    expect(halfPartners(m, pizzaA, "Grande").map((x) => x.id)).toEqual(["b"]);
    expect(halfPartners(m, pizzaA, "Broto")).toEqual([]);
    expect(halfPartners(m, item("burger"), null)).toEqual([]); // não aceita meio a meio
    expect(halfPartners(null, pizzaA, "Grande")).toEqual([]);
  });
  it("cmuReturnDue: a Comunidade volta quando o meio a meio termina (sem escolha e sem folha)", () => {
    expect(cmuReturnDue({ waiting: true, pick: false, sheet: false })).toBe(true);
    expect(cmuReturnDue({ waiting: true, pick: true, sheet: false })).toBe(false);
    expect(cmuReturnDue({ waiting: true, pick: false, sheet: true })).toBe(false);
    expect(cmuReturnDue({ waiting: false, pick: false, sheet: false })).toBe(false);
  });
});

describe("capa do Palco e textos curtos", () => {
  it("stageCover: tríptico só com foto em todas as opções; senão a capa da casa", () => {
    expect(stageCover(["a.webp", "b.webp", "c.webp"])).toEqual(["a.webp", "b.webp", "c.webp"]);
    expect(stageCover(["a.webp", null])).toBeNull();
    expect(stageCover(["a.webp"])).toBeNull();
    expect(stageCover([])).toBeNull();
  });
  it("lowerFirst: 'Vote: qual prato…'; em alemão fica como está", () => {
    expect(lowerFirst("Qual prato sai primeiro hoje?", "pt-BR")).toBe("qual prato sai primeiro hoje?");
    expect(lowerFirst("¿Qué postre sale hoy?", "es")).toBe("¿qué postre sale hoy?");
    expect(lowerFirst("Welches Dessert gewinnt heute?", "de")).toBe("Welches Dessert gewinnt heute?");
    expect(lowerFirst("", "pt-BR")).toBe("");
  });
  it("balloonPath: corpo com cantos e a ponta no meio, embaixo", () => {
    const d = balloonPath(262, 107, 24, 28, 12);
    expect(d.startsWith("M24 0H238")).toBe(true);
    expect(d).toContain("Q131 119"); // ponta em x = 131, y = 107 + 12
    expect(d.endsWith("Z")).toBe(true);
  });
});
