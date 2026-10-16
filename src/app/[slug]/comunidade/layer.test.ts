import { createElement, Fragment, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// O carrinho que fica com o islandRef é o alvo do "voo" da foto ao pedir (`add` em
// order-context). Só um carrinho pode ficar com ele: com o story aberto, o do story (.vcart);
// com o story fechado, o da capa. A camada da Comunidade fica sempre montada (escondida
// quando fechada) e vem depois do story na árvore: se o carrinho dela também recebesse o
// ref, ficaria com ele, e a foto do "Pedir agora" do story voaria para o lugar escondido.

const h = vi.hoisted(() => ({
  island: { current: null as unknown },
  order: {} as Record<string, unknown>,
  comunidade: {} as Record<string, unknown>,
  seen: [] as ReactElement[],
}));

vi.mock("../order/order-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../order/order-context")>()),
  useOrder: () => h.order,
}));
vi.mock("./provider", () => ({ useComunidade: () => h.comunidade }));
vi.mock("./stage", () => ({ Stage: () => null }));
vi.mock("./mural", () => ({ Mural: () => null, PhotoView: () => null }));
// O CartButton de verdade, anotando o botão que ele devolve (para ver quem leva o ref).
vi.mock("../order/cart-button", async (importOriginal) => {
  const real = await importOriginal<typeof import("../order/cart-button")>();
  const CartButton = (p: Parameters<typeof real.CartButton>[0]) => {
    const el = real.CartButton(p);
    if (el) h.seen.push(el);
    return el;
  };
  return { CartButton };
});

const { CartButton } = await import("../order/cart-button");
const { ComunidadeLayer } = await import("./layer");

type BtnProps = { className: string; ref?: unknown };
const props = (el: ReactElement) => el.props as BtnProps;

// Monta os carrinhos como o menu-app: o da capa sempre, o do story com ele aberto, e a
// camada da Comunidade (que traz o seu) depois do story.
function render({ viewerOpen, layerOpen }: { viewerOpen: boolean; layerOpen: boolean }) {
  h.seen.length = 0;
  h.order = {
    islandRef: h.island, enabled: true, viewerOpen, lines: [], orders: [], lang: "pt-BR", sheet: null, openCart: () => {},
  };
  h.comunidade = { state: { enabled: true }, open: layerOpen, setOpen: () => {}, tab: "palco", setTab: () => {}, offline: false };
  renderToStaticMarkup(
    createElement(
      Fragment,
      null,
      createElement(CartButton, { inViewer: false, className: "round hero-cart" }),
      viewerOpen ? createElement(CartButton, { inViewer: true, className: "vcart glass" }) : null,
      createElement(ComunidadeLayer),
    ),
  );
  return {
    withIsland: h.seen.filter((el) => props(el).ref === h.island).map((el) => props(el).className),
    all: h.seen.map((el) => props(el).className),
  };
}

describe("carrinho da camada da Comunidade e o alvo do voo (islandRef)", () => {
  beforeEach(() => {
    h.island.current = null;
  });

  it("com o story aberto, só o carrinho do story fica com o islandRef", () => {
    const r = render({ viewerOpen: true, layerOpen: false });
    expect(r.all).toContain("o-cartbtn cmu-cart");
    expect(r.withIsland).toEqual(["o-cartbtn vcart glass"]);
  });

  it("com a camada aberta (story fechado), o alvo continua o carrinho da capa", () => {
    const r = render({ viewerOpen: false, layerOpen: true });
    expect(r.all).toContain("o-cartbtn cmu-cart");
    expect(r.withIsland).toEqual(["o-cartbtn round hero-cart"]);
  });

  it("com tudo fechado, o alvo é o carrinho da capa", () => {
    const r = render({ viewerOpen: false, layerOpen: false });
    expect(r.withIsland).toEqual(["o-cartbtn round hero-cart"]);
  });
});
