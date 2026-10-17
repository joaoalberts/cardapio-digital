import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PublicPoll } from "@/lib/comunidade/types";
import type { MenuItem, PublicMenu } from "@/lib/menu/types";

// Palco com a enquete encerrada: só a vencedora ligada a um prato ganha "Pedir também"
// (spec). Opção só com o texto da casa (modelo Música, por exemplo) fica sem botão; o
// "indisponível" desligado é só para o prato ligado que saiu do cardápio (ficha).

const h = vi.hoisted(() => ({
  order: {} as Record<string, unknown>,
  comunidade: {} as Record<string, unknown>,
}));

vi.mock("../order/order-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../order/order-context")>()),
  useOrder: () => h.order,
}));
vi.mock("./provider", () => ({ useComunidade: () => h.comunidade }));

const { Stage } = await import("./stage");

const NOW = "2026-10-16T23:00:00Z"; // 20h em São Paulo

function item(id: string, over: Partial<MenuItem> = {}): MenuItem {
  return {
    id,
    name: `Prato ${id}`,
    description: "",
    price_cents: 1000,
    media: [{ id: `m-${id}`, kind: "photo", storage_path: `/fotos/${id}.webp`, mux_playback_id: null, poster_path: null }],
    category_id: "c1",
    half_half: false,
    ...over,
  };
}

// Cardápio sem destaque (★) nem foto: o Palco não tem destaque da casa para mostrar, e o
// único "Pedir também" possível é o da vencedora.
const dish = item("burger", { media: [] });
const menu: PublicMenu = {
  restaurant: {
    id: "r1", name: "Depot", slug: "depot", logo_path: null, brand_color: null, languages: ["pt-BR"], menu_version: 1,
    cover_video_path: null, cover_image_path: null, font_theme: "fell", timezone: "America/Sao_Paulo", opening_hours: null,
    language: "pt-BR", orders_enabled: true,
  },
  categories: [{ id: "c1", name: "Lanches", items: [dish] }],
};

function closedPoll(winnerItem: string | null): PublicPoll {
  return {
    id: "p1",
    template: "custom",
    question: "Qual sai primeiro?",
    options: [
      { id: "a", label: "Rock clássico", item_id: winnerItem, pct: 43 },
      { id: "b", label: "Samba", item_id: null, pct: 29 },
      { id: "c", label: "Jazz", item_id: null, pct: 28 },
    ],
    starts_at: "2026-10-16T22:00:00Z",
    ends_at: "2026-10-16T22:30:00Z",
    closed: true,
    closed_at: null,
    has_votes: true,
    winner: "a",
  };
}

type Opts = { mine?: "a" | "b" | "c" | null; canVote?: boolean; offline?: boolean; items?: MenuItem[]; inCart?: number };
function render(poll: PublicPoll, o: Opts = {}) {
  const items = o.items ?? [dish];
  const m: PublicMenu = { ...menu, categories: [{ id: "c1", name: "Lanches", items }] };
  h.order = {
    lang: "pt-BR", menu: m, enabled: true, pick: null,
    itemById: (id: string) => items.find((x) => x.id === id),
    inCart: () => o.inCart ?? 0, add: () => {}, openItem: () => {},
  };
  h.comunidade = {
    state: { enabled: true, now: NOW, poll, next: null, mural: [], has_tv: false },
    open: true, tab: "palco", skew: 0, minute: 0, offline: !!o.offline, canVote: o.canVote ?? true,
    myVote: () => o.mine ?? null, track: () => {}, setOpen: () => {}, setTab: () => {}, vote: async () => ({ ok: true }),
  };
  return renderToStaticMarkup(createElement(Stage, { onShare: () => {} }));
}

// Os botões "Pedir também" do Palco (classe cmu-buy): o texto, o preço e se estão desligados.
function buyButtons(html: string) {
  return [...html.matchAll(/<button class="cmu-buy[^"]*"([^>]*)>(.*?)<\/button>/g)].map((m) => ({
    disabled: /\sdisabled=""/.test(m[1]),
    text: /<span class="cmu-t">([^<]*)<\/span>/.exec(m[2])?.[1] ?? "",
    price: /<span class="cmu-pr">([^<]*)<\/span>/.exec(m[2])?.[1]?.replace(/\u00a0/g, " ") ?? null,
  }));
}
const txt = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;|\u00a0/g, " ").replace(/\s+/g, " ");

function openPoll(): PublicPoll {
  return {
    ...closedPoll(dish.id),
    options: [
      { id: "a", label: "", item_id: dish.id, pct: 44 },
      { id: "b", label: "Samba", item_id: null, pct: 37 },
      { id: "c", label: "Jazz", item_id: null, pct: 19 },
    ],
    ends_at: "2026-10-16T23:41:00Z",
    closed: false,
  };
}

describe("Palco · vencedora da enquete encerrada e o \"Pedir também\"", () => {
  it("vencedora sem prato ligado (só o texto da casa): sem botão, \"Deu Rock clássico\"", () => {
    const html = render(closedPoll(null));
    expect(txt(html)).toContain("Deu Rock clássico");
    expect(buyButtons(html)).toEqual([]);
  });

  it("vencedora sem prato e com destaque da casa: \"Pra acompanhar\" com o destaque", () => {
    const star = item("star", { featured: true, price_cents: 4200 });
    const html = render(closedPoll(null), { items: [dish, star] });
    expect(txt(html)).toContain("Pra acompanhar");
    expect(txt(html)).toContain("Prato star");
    expect(buyButtons(html)).toEqual([{ disabled: false, text: "Pedir também", price: "R$ 42" }]);
  });

  it("vencedora ligada a um prato do cardápio: \"Deu\" com o prato e \"Pedir também\" com o preço", () => {
    const html = render(closedPoll(dish.id));
    expect(txt(html)).toContain("Deu Prato burger");
    expect(txt(html)).toContain("Enquete da casa, encerrada");
    expect(buyButtons(html)).toEqual([{ disabled: false, text: "Pedir também", price: "R$ 10" }]);
  });

  it("vencedora ligada a um prato que saiu do cardápio: \"indisponível\" desligado", () => {
    const html = render(closedPoll("sumiu"));
    expect(txt(html)).toContain("Deu Rock clássico");
    expect(buyButtons(html)).toEqual([{ disabled: true, text: "indisponível", price: null }]);
  });

  it("empate: \"Empate!\", um \"Pedir também\" para cada prato e a de fora no rodapé", () => {
    const b = item("pizza", { price_cents: 5400 });
    const p: PublicPoll = {
      ...closedPoll(dish.id),
      options: [
        { id: "a", label: "", item_id: dish.id, pct: 43 },
        { id: "b", label: "", item_id: b.id, pct: 43 },
        { id: "c", label: "Jazz", item_id: null, pct: 14 },
      ],
    };
    const html = render(p, { items: [dish, b] });
    expect(txt(html)).toContain("Empate!");
    expect(txt(html)).toContain("Jazz ficou com 14%");
    expect(buyButtons(html).map((x) => x.text)).toEqual(["Pedir também", "Pedir também"]);
  });

  it("já no pedido: \"No pedido\", sem preço", () => {
    const html = render(closedPoll(dish.id), { inCart: 1 });
    expect(buyButtons(html)).toEqual([{ disabled: false, text: "No pedido", price: null }]);
  });
});

describe("Palco · enquete aberta", () => {
  it("antes do voto: \"Toque no prato para votar\", opções com o preço, sem \"Pedir também\"", () => {
    const html = render(openPoll());
    expect(txt(html)).toContain("Toque no prato para votar");
    expect(txt(html)).toContain("R$ 10");
    expect(buyButtons(html)).toEqual([]);
  });

  it("logo depois do voto: cartão \"Seu voto\" com o preço e \"Pedir também\"", () => {
    const html = render(openPoll(), { mine: "a" });
    expect(txt(html)).toContain("Voto registrado");
    expect(txt(html)).toContain("Seu voto");
    expect(txt(html)).toContain("peça já e ele sai primeiro da cozinha");
    expect(buyButtons(html)).toEqual([{ disabled: false, text: "Pedir também", price: "R$ 10" }]);
  });

  it("votou numa opção sem prato: cartão sem \"Pedir também\"", () => {
    const html = render(openPoll(), { mine: "b" });
    expect(txt(html)).toContain("Seu voto");
    expect(buyButtons(html)).toEqual([]);
  });

  it("sem mesa: vê o resultado, \"Para votar, leia o QR da sua mesa\", sem cartão de voto", () => {
    const html = render(openPoll(), { canVote: false });
    expect(txt(html)).toContain("Para votar, leia o QR da sua mesa");
    expect(txt(html)).toContain("44");
    expect(txt(html)).not.toContain("Seu voto");
  });

  it("sem conexão: voto guardado e o \"Pedir também\" some", () => {
    const html = render(openPoll(), { mine: "a", offline: true });
    expect(txt(html)).toContain("Seu voto está guardado");
    expect(buyButtons(html)).toEqual([]);
  });
});
