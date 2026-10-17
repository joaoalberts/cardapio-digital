"use client";

import { startTransition, useState, useTransition } from "react";

// Botão discreto que pede confirmação antes de uma ação que não dá para desfazer. Deu certo,
// a linha fica em "Um instante…" até o refresh tirá-la da lista; deu errado, volta na hora.
export function Confirm({ label, ask, yes, onYes }: { label: string; ask: string; yes: string; onYes: () => Promise<boolean | void> }) {
  const [asking, setAsking] = useState(false);
  const [busy, startYes] = useTransition();
  if (!asking)
    return (
      <span className="cp-acts">
        <button className="cp-link" onClick={() => setAsking(true)}>
          {label}
        </button>
      </span>
    );
  return (
    <span className="cp-acts asking">
      <span>{ask}</span>
      <button
        className="cp-link danger"
        disabled={busy}
        onClick={() =>
          startYes(async () => {
            if ((await onYes()) !== false) startTransition(() => setAsking(false));
            else setAsking(false);
          })
        }
      >
        {busy ? "Um instante…" : yes}
      </button>
      <button className="cp-link" disabled={busy} onClick={() => setAsking(false)}>
        Não
      </button>
    </span>
  );
}
