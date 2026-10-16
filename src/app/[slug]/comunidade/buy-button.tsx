"use client";

import { useRef } from "react";
import { buyState } from "@/lib/comunidade/client-logic";
import { ct } from "@/lib/comunidade/i18n";
import type { Origin } from "@/lib/comunidade/types";
import { thumbSrc } from "@/lib/menu/media";
import { flyTo } from "../order/fly";
import { useOrder } from "../order/order-context";
import { useComunidade } from "./provider";

// "Pedir também": a mesma regra do "Pedir" do story (some sem pedido ligado, com preço
// escondido ou no meio a meio em curso). Prato simples entra direto no pedido, com a origem
// da Comunidade, e a foto voa até o carrinho da camada; prato com tamanhos ou meio a meio
// fecha a camada e abre a folha do prato, que leva a origem até o pedido.
// source = de onde veio o toque (enquete ou post). Sem source (destaque da casa sem enquete
// nem post), a linha entra sem origem: não há o que atribuir.

export type BuySource = { kind: "palco" | "mural"; ref: string } | null;

export function BuyButton({ itemId, source, big = false }: { itemId: string | null; source: BuySource; big?: boolean }) {
  const o = useOrder();
  const c = useComunidade();
  const btn = useRef<HTMLButtonElement>(null);
  const item = itemId ? o.itemById(itemId) : undefined;
  const st = buyState(item, { enabled: o.enabled, pick: !!o.pick, inCart: item ? o.inCart(item.id) : 0 });
  if (st === "hidden") return null;
  const L = o.lang;
  const cls = `cmu-also${big ? " big" : ""}`;

  if (st === "unavailable") {
    return (
      <button className={cls} disabled>
        <Plus />
        <span className="cmu-t">{ct("unavailable", L)}</span>
      </button>
    );
  }
  if (st === "in_cart") {
    return (
      <button className={`${cls} done`} aria-disabled="true" onClick={(e) => e.preventDefault()}>
        <Plus />
        <span className="cmu-t">{ct("inOrder", L)}</span>
      </button>
    );
  }

  const buy = () => {
    if (!item) return;
    c.track("buy_tap");
    const origin: Origin | undefined = source
      ? { origin: source.kind === "palco" ? "comunidade_palco" : "comunidade_mural", origin_ref: source.ref, origin_at: Date.now() }
      : undefined;
    const simple = !item.price_options?.length && !item.half_half;
    if (!simple) {
      c.setOpen(false);
      o.openItem(item, { qty: 1, ...(origin ? { origin } : {}) });
      return;
    }
    o.add({ item: item.id, option: null, half: null, qty: 1, note: "", ...(origin ?? {}) }, null);
    // O carrinho da camada fica por cima do da capa: a foto voa até ele.
    const cart = btn.current?.closest(".cmu-layer")?.querySelector<HTMLElement>(".cmu-cart");
    if (btn.current && cart) void flyTo(btn.current, cart, thumbSrc(item));
  };

  return (
    <button ref={btn} className={cls} onClick={buy} aria-label={`${ct("buyAlso", L)}: ${item?.name ?? ""}`}>
      <Plus />
      <span className="cmu-t">{ct("buyAlso", L)}</span>
    </button>
  );
}

// Disco limão com o "+" que vira "✓" quando o prato já está no pedido.
const Plus = () => (
  <span className="cmu-pl" aria-hidden>
    <svg className="ps icon" viewBox="0 0 24 24">
      <path d="M12 5v14M5 12h14" />
    </svg>
    <svg className="ck icon" viewBox="0 0 24 24">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  </span>
);
