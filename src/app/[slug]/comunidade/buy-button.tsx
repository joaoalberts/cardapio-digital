"use client";

import { createContext, useContext, useRef } from "react";
import { buyFlow, buyState, priceInfo, type BuyState } from "@/lib/comunidade/client-logic";
import { ct } from "@/lib/comunidade/i18n";
import type { Origin } from "@/lib/comunidade/types";
import type { MenuItem } from "@/lib/menu/types";
import { thumbSrc } from "@/lib/menu/media";
import { flyTo } from "../order/fly";
import { useOrder } from "../order/order-context";
import { IconCheck, IconPlus, priceText } from "./parts";
import { useComunidade } from "./provider";

// "Pedir também" (ficha v2): disco e texto em limão, o preço em creme. A mesma regra do
// "Pedir" do story (buyState): some sem pedido ligado, com preço escondido ou no meio a meio
// em curso; o prato ligado que o carrinho recusaria agora vira "indisponível" desligado; já
// no pedido, "✓ No pedido". Sem conexão, some até ela voltar (ficha: "Sem conexão").
// Prato simples entra direto, com a origem da Comunidade, e a foto voa até o carrinho da
// camada; prato com tamanhos ou meio a meio abre a folha de tamanhos dentro da Comunidade
// (BuySheetCtx, em layer.tsx), sem fechá-la.
// source = de onde veio o toque (enquete ou post). Sem source (destaque da casa sem enquete
// nem post), a linha entra sem origem: não há o que atribuir.
// itemId null = nada ligado (opção da enquete só com o texto da casa): o botão some.

export type BuySource = { kind: "palco" | "mural"; ref: string } | null;

// Folha de tamanhos da camada; fora dela (testes), o prato abre na folha do pedido.
export const BuySheetCtx = createContext<((item: MenuItem, origin: Origin | undefined) => void) | null>(null);

export const originOf = (source: BuySource): Origin | undefined =>
  source ? { origin: source.kind === "palco" ? "comunidade_palco" : "comunidade_mural", origin_ref: source.ref, origin_at: Date.now() } : undefined;

// O estado do botão, para quem precisa decidir o que mostrar no lugar dele.
export function useBuyState(itemId: string | null): BuyState {
  const o = useOrder();
  const c = useComunidade();
  const item = itemId ? o.itemById(itemId) : undefined;
  if (c.offline) return "hidden";
  return buyState(item, {
    linked: !!itemId,
    enabled: o.enabled,
    pick: !!o.pick,
    inCart: item ? o.inCart(item.id) : 0,
    menu: o.menu,
    // Antes do primeiro tique do relógio (só no primeiro quadro), a hora da leitura.
    now: new Date(c.minute || (c.state ? Date.parse(c.state.now) : 0)),
  });
}

type Variant = "sm" | "big" | "wide";

export function BuyButton({
  itemId, source, variant, photo = false, price = false,
}: {
  itemId: string | null;
  source: BuySource;
  variant?: Variant;
  photo?: boolean; // sobre foto: tom escuro por trás
  price?: boolean; // preço no botão (some nos pratos com preços de tamanho diferentes)
}) {
  const o = useOrder();
  const c = useComunidade();
  const sheet = useContext(BuySheetCtx);
  const btn = useRef<HTMLButtonElement>(null);
  const st = useBuyState(itemId);
  const item = itemId ? o.itemById(itemId) : undefined;
  if (st === "hidden") return null;
  const L = o.lang;
  const cls = `cmu-buy${variant ? ` ${variant}` : ""}${photo ? " photo" : ""}`;
  const pi = priceInfo(item);
  const pr = price && pi && !pi.from ? priceText(pi, L) : null;

  if (st === "unavailable") {
    return (
      <button className={`${cls} off`} disabled>
        <span className="cmu-disc" aria-hidden>
          <IconPlus />
        </span>
        <span className="cmu-t">{ct("unavailable", L)}</span>
      </button>
    );
  }
  if (st === "in_cart") {
    return (
      <button className={`${cls} done`} aria-disabled="true" onClick={(e) => e.preventDefault()}>
        <span className="cmu-disc" aria-hidden>
          <IconCheck />
        </span>
        <span className="cmu-t">{ct("inOrder", L)}</span>
      </button>
    );
  }

  const buy = () => {
    if (!item) return;
    c.track("buy_tap");
    const origin = originOf(source);
    const flow = buyFlow(item, o.menu);
    if (flow.kind === "sheet") {
      if (sheet) sheet(item, origin);
      else {
        c.setOpen(false);
        o.openItem(item, { qty: 1, ...(origin ? { origin } : {}) });
      }
      return;
    }
    o.add({ item: item.id, option: flow.option, half: null, qty: 1, note: "", ...(origin ?? {}) }, null, { quiet: true });
    // O carrinho da camada fica por cima do da capa: a foto voa até ele.
    const cart = btn.current?.closest(".cmu-layer")?.querySelector<HTMLElement>(".cmu-cart");
    if (btn.current && cart) void flyTo(btn.current, cart, thumbSrc(item));
  };

  return (
    <button ref={btn} className={cls} onClick={buy} aria-label={`${ct("buyAlso", L)}: ${item?.name ?? ""}${pr ? `, ${pr}` : ""}`}>
      <span className="cmu-disc" aria-hidden>
        <IconPlus />
      </span>
      <span className="cmu-t">{ct("buyAlso", L)}</span>
      {pr && <span className="cmu-pr">{pr}</span>}
    </button>
  );
}
