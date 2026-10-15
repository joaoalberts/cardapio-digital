"use client";

import type { MenuItem } from "@/lib/menu/types";
import { tf, t as tr } from "@/lib/menu/i18n";
import { itemPrice } from "@/lib/orders/pricing";
import { money, useOrder } from "./order-context";

// "Observação" e "Adicionar" no rodapé do story. Prato simples entra direto; com
// tamanhos ou meio a meio, abre a folha do prato.
export function StoryActions({ item }: { item: MenuItem }) {
  const o = useOrder();
  if (!o.enabled || item.hide_price) return null;
  const L = o.lang;
  const simple = !item.price_options?.length && !item.half_half;
  const price = itemPrice(item);
  const n = o.inCart(item.id);
  return (
    <div className="o-acts">
      <button className="o-btn-note" onClick={() => o.openItem(item, { focusNote: true })}>
        <svg className="icon" viewBox="0 0 24 24" aria-hidden><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /></svg>
        {tr("oNote", L)}
      </button>
      <button
        className="o-btn-add"
        onClick={(e) =>
          simple && price != null
            ? o.add({ item: item.id, option: null, half: null, qty: 1, note: "" }, e.currentTarget)
            : o.openItem(item)
        }
      >
        {simple && price != null ? `${tr("oAdd", L)} · ${money(price, L)}` : tr("oChoose", L)}
        {n > 0 && <span className="o-qty-in">{tf("oInOrder", L, { n })}</span>}
      </button>
    </div>
  );
}
