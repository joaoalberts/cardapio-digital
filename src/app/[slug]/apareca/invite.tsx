"use client";

import { useEffect, useRef, useState } from "react";
import { useOrder } from "../order/order-context";

// Convite "Apareça na TV!" na capa do cardápio, na linha dos botões do topo, logo acima do
// balão da Comunidade. Só aparece com mesa válida (lida agora ou lembrada) e com o recurso
// ligado e aberto (GET público, uma consulta). Desligado, fechado, pausado ou com erro: não
// renderiza nada, e o cardápio fica igual ao de antes.
// Com o balão na versão compacta (ele ocupa a linha do topo), o convite vira só o ícone, na
// coluna da direita (CSS, .hero:has(.cmu-bal-c)).

type Head = { enabled?: unknown; open?: unknown };

export function AparecaInvite() {
  const { table, slug } = useOrder();
  const [open, setOpen] = useState(false);
  const asked = useRef(false);
  const hasTable = !!table;

  useEffect(() => {
    if (!hasTable || asked.current) return;
    asked.current = true;
    const ctrl = new AbortController();
    fetch(`/api/apareca/${encodeURIComponent(slug)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<Head>) : null))
      .then((h) => setOpen(h?.enabled === true && h.open === true))
      .catch(() => {});
    return () => {
      ctrl.abort();
      asked.current = false;
    };
  }, [hasTable, slug]);

  if (!open || !table) return null;
  return (
    <a className="apa-inv" href={`/${slug}/apareca?mesa=${encodeURIComponent(table.code)}`} aria-label="Apareça na TV! Grave 6 segundos e apareça no telão">
      <span className="apa-inv-ic" aria-hidden>
        <TvIcon />
      </span>
      <span className="apa-inv-t">Apareça na TV!</span>
    </a>
  );
}

export function TvIcon() {
  return (
    <svg viewBox="0 0 24 24" className="apa-ic">
      <rect x="3" y="6" width="18" height="12.5" rx="2.6" />
      <path d="M9 3.5l3 2.5 3-2.5M8.5 21h7" />
      <circle cx="12" cy="12.25" r="2.4" className="apa-ic-dot" />
    </svg>
  );
}
