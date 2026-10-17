"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { setupDone, type SetupStep } from "@/lib/painel/setup-steps";

// "Montar a casa": a lista calculada no servidor (setupSteps), lida uma vez ao abrir a tela. Cada passo tem
// ✓ quando feito ou um botão para onde ele se faz; o que só o dono faz aparece com "Peça ao dono" para o
// funcionário. "Esconder" vale só neste aparelho (localStorage, sempre em try/catch: sem ele a lista
// continua funcionando). Some sozinha quando tudo está feito.

const keyOf = (rid: string) => `painel:setup-hidden:${rid}`;
const noop = () => () => {};

export function SetupCard({ rid, steps }: { rid: string; steps: SetupStep[] }) {
  // O localStorage só existe no navegador: no servidor a lista aparece, e some na hidratação se escondida.
  const stored = useSyncExternalStore(
    noop,
    () => {
      try {
        return window.localStorage.getItem(keyOf(rid)) === "1";
      } catch {
        return false;
      }
    },
    () => false,
  );
  const [hiddenNow, setHiddenNow] = useState(false);
  if (stored || hiddenNow || setupDone(steps)) return null;

  const hide = () => {
    try {
      window.localStorage.setItem(keyOf(rid), "1");
    } catch {
      // Sem armazenamento (aba anônima, bloqueio): esconde só até recarregar.
    }
    setHiddenNow(true);
  };

  const done = steps.filter((s) => s.done).length;
  return (
    <section className="ap-card ag-setup" aria-labelledby="ag-h-setup">
      <div className="ap-card-head">
        <h2 id="ag-h-setup">Montar a casa</h2>
        <span className="ag-setup-n">
          {done} de {steps.length} feitos
        </span>
      </div>
      <ol className="ag-steps">
        {steps.map((s) => (
          <li key={s.id} className={s.done ? "done" : undefined}>
            <span className="ag-mark" aria-hidden>
              {s.done ? "✓" : ""}
            </span>
            <span className="ag-step">
              {s.label}
              {s.done && <span className="ag-sr"> (feito)</span>}
            </span>
            {!s.done &&
              (s.blocked ? (
                <span className="ag-ask">Peça ao dono</span>
              ) : (
                <Link className="btn outline ag-go" href={s.href}>
                  Fazer
                </Link>
              ))}
          </li>
        ))}
      </ol>
      <button type="button" className="ag-hide" onClick={hide}>
        Esconder
      </button>
    </section>
  );
}
