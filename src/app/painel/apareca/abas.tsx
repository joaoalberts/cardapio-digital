"use client";

import { Children, useRef, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";

// Abas do painel do Apareça (Vídeos da casa, Ajustes, Números). Todas continuam montadas (só escondidas)
// para não perder o que se digitou ao trocar de aba. A aba escolhida fica no endereço (#ajustes…) para
// sobreviver a um recarregar; um # desconhecido (os antigos #fila e #zonas) cai na primeira. A nota
// (opcional) fica logo abaixo das abas, visível em todas.

export type Aba = { id: string; label: string };

const onHash = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};
const readHash = () => window.location.hash.slice(1);

export function Abas({ abas, note, children }: { abas: Aba[]; note?: ReactNode; children: ReactNode }) {
  const hash = useSyncExternalStore(onHash, readHash, () => "");
  const active = abas.some((a) => a.id === hash) ? hash : abas[0].id;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // replace: trocar de aba não enche o "voltar" do navegador.
  const pick = (id: string) => window.location.replace(`#${id === abas[0].id ? "" : id}`);

  // Setas, Home e End trocam de aba, como pede o padrão de abas acessíveis.
  const onKey = (e: KeyboardEvent, i: number) => {
    const last = abas.length - 1;
    const to = { ArrowRight: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, Home: 0, End: last }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    pick(abas[to].id);
    refs.current[to]?.focus();
  };

  const panels = Children.toArray(children);
  return (
    <>
      <div className="app-tabs" role="tablist" aria-label="Apareça na TV">
        {abas.map((a, i) => (
          <button
            key={a.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`app-tab-${a.id}`}
            aria-controls={`app-panel-${a.id}`}
            aria-selected={active === a.id}
            tabIndex={active === a.id ? 0 : -1}
            className="app-tab"
            onClick={() => pick(a.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {a.label}
          </button>
        ))}
      </div>
      {note}
      {abas.map((a, i) => (
        <div key={a.id} role="tabpanel" id={`app-panel-${a.id}`} aria-labelledby={`app-tab-${a.id}`} hidden={active !== a.id}>
          {panels[i]}
        </div>
      ))}
    </>
  );
}
