"use client";

import type { MenuItem } from "@/lib/menu/types";
import { t as tr } from "@/lib/menu/i18n";
import { useOrder } from "./order-context";

// Botão discreto "Pedir" no rodapé do story: abre a folha de vidro do prato. Enquanto o
// cliente escolhe a outra metade de uma pizza, quem fala é a barrinha (pick-bar.tsx).
export function StoryActions({ item }: { item: MenuItem }) {
  const o = useOrder();
  if (!o.enabled || item.hide_price || o.pick) return null;
  const n = o.inCart(item.id);
  return (
    <div className="o-acts">
      <button className="o-ask glass" onClick={() => o.openItem(item)} aria-label={`${tr("oAsk", o.lang)} ${item.name}${n > 0 ? ` (${n} ${tr("oInBag", o.lang)})` : ""}`}>
        <svg className="icon" viewBox="0 0 24 24" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
        {tr("oAsk", o.lang)}
        {n > 0 && <span className="o-qty-in" aria-hidden>{n}</span>}
      </button>
    </div>
  );
}
