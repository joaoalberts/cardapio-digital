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
    has_votes: true,
    winner: "a",
  };
}

function render(poll: PublicPoll) {
  h.order = {
    lang: "pt-BR", menu, enabled: true, pick: null,
    itemById: (id: string) => (id === dish.id ? dish : undefined),
    inCart: () => 0, add: () => {}, openItem: () => {},
  };
  h.comunidade = {
    state: { now: NOW, poll, next: null, mural: [], has_tv: false },
    open: true, tab: "palco", skew: 0, offline: false, canVote: true,
    myVote: () => null, track: () => {}, setOpen: () => {}, setTab: () => {}, vote: async () => ({ ok: true }),
  };
  return renderToStaticMarkup(createElement(Stage));
}

// Os botões "Pedir também" do Palco (classe cmu-also), com o texto e se estão desligados.
function buyButtons(html: string) {
  return [...html.matchAll(/<button class="cmu-also[^"]*"([^>]*)>.*?<span class="cmu-t">([^<]*)<\/span><\/button>/g)].map((m) => ({
    disabled: /\sdisabled=""/.test(m[1]),
    text: m[2],
  }));
}

describe("Palco · vencedora da enquete encerrada e o \"Pedir também\"", () => {
  it("vencedora sem prato ligado (só o texto da casa): sem botão", () => {
    const html = render(closedPoll(null));
    expect(html).toContain("Rock clássico");
    expect(html).toContain("Deu na enquete");
    expect(buyButtons(html)).toEqual([]);
  });

  it("vencedora ligada a um prato do cardápio: \"Pedir também\" ligado", () => {
    const html = render(closedPoll(dish.id));
    expect(html).toContain("Prato burger");
    expect(buyButtons(html)).toEqual([{ disabled: false, text: "Pedir também" }]);
  });

  it("vencedora ligada a um prato que saiu do cardápio: \"indisponível\" desligado", () => {
    const html = render(closedPoll("sumiu"));
    expect(html).toContain("Rock clássico");
    expect(buyButtons(html)).toEqual([{ disabled: true, text: "indisponível" }]);
  });
});
