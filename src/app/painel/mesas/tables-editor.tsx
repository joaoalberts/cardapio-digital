"use client";

import { useState, useTransition } from "react";
import { addTable, removeTable } from "./actions";

export type TableRow = { id: string; label: string; code: string };

// Próximo nome sugerido: "Mesa N", com N uma unidade acima do maior número já usado.
function nextLabel(list: TableRow[]) {
  const nums = list.map((t) => /^Mesa (\d+)$/.exec(t.label)?.[1]).filter(Boolean).map(Number);
  return `Mesa ${nums.length ? Math.max(...nums) + 1 : 1}`;
}

export function TablesEditor({ restaurantId, initial }: { restaurantId: string; initial: TableRow[] }) {
  const [tables, setTables] = useState(initial);
  const [label, setLabel] = useState(() => nextLabel(initial));
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const add = () =>
    start(async () => {
      setErr(null);
      const name = label.trim();
      const res = await addTable(restaurantId, name);
      if (res.error) return setErr(res.error);
      const list = [...tables, { id: res.id!, label: name, code: res.code! }];
      setTables(list);
      setLabel(nextLabel(list));
    });

  const remove = (t: TableRow) => {
    if (!window.confirm(`Remover ${t.label}? O QR já impresso dela deixa de identificar a mesa.`)) return;
    start(async () => {
      setErr(null);
      const res = await removeTable(restaurantId, t.id);
      if (res.error) return setErr(res.error);
      setTables((list) => list.filter((x) => x.id !== t.id));
    });
  };

  return (
    <div className="mz">
      <p className="mz-note">Cada mesa tem o seu próprio QR Code. Imprima e cole na mesa certa.</p>
      <form
        className="mz-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (label.trim()) add();
        }}
      >
        <label className="mz-field">
          <span>Nome da mesa</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} />
        </label>
        <button className="btn primary" type="submit" disabled={pending || !label.trim()}>
          {pending ? "Salvando…" : "Adicionar mesa"}
        </button>
      </form>
      {err && (
        <p className="md-err" role="alert">
          {err}
        </p>
      )}
      {tables.length ? (
        <ul className="mz-list">
          {tables.map((t) => (
            <li key={t.id}>
              <span>{t.label}</span>
              <button className="btn outline" onClick={() => remove(t)} disabled={pending}>
                Remover
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mz-empty">Nenhuma mesa ainda. Adicione a primeira acima.</p>
      )}
      {!!tables.length && (
        <div className="mz-foot">
          <a className="btn primary" href="/painel/imprimir?tipo=mesas" target="_blank" rel="noreferrer">
            Imprimir QR das mesas
          </a>
        </div>
      )}
    </div>
  );
}
