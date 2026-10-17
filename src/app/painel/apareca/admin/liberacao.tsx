"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { setAiAllowed, setAllowed } from "./actions";

// Os dois interruptores do super admin num restaurante. Quem confere a permissão é a action,
// no servidor; aqui é só o botão. Depois de gravar, a página relê o banco (router.refresh).

const SAVE_FAIL = "Não foi possível salvar. Confira a internet.";

export function Liberacao({ rid, allowed, aiAllowed }: { rid: string; allowed: boolean; aiAllowed: boolean }) {
  const router = useRouter();
  const [state, setState] = useOptimistic({ allowed, aiAllowed });
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const flip = (key: "allowed" | "aiAllowed") =>
    start(async () => {
      const next = !state[key];
      // Desligar a liberação desliga também o interruptor do dono; a IA continua como estava.
      setState({ ...state, [key]: next });
      setErr(null);
      const call = key === "allowed" ? setAllowed : setAiAllowed;
      const r = await call(rid, next).catch(() => ({ error: SAVE_FAIL }));
      if (r.error) setErr(r.error);
      router.refresh();
    });

  const sw = (key: "allowed" | "aiAllowed", label: string, hint: string) => {
    const id = `app-adm-${key}-${rid}`;
    return (
      <div className="app-sw-row">
        <div>
          <b id={id}>{label}</b>
          <small>{hint}</small>
        </div>
        <button
          type="button"
          className="app-sw"
          role="switch"
          aria-checked={state[key]}
          aria-labelledby={id}
          aria-describedby={`app-adm-name-${rid}`}
          disabled={busy}
          onClick={() => flip(key)}
        >
          <i />
        </button>
      </div>
    );
  };

  return (
    <div className="app-adm-sw">
      {err && (
        <p className="app-msg" role="alert">
          {err}
        </p>
      )}
      {sw("allowed", "Liberado", state.allowed ? "O dono pode ligar o Apareça na TV." : "Desligar também desliga o recurso na casa.")}
      {sw("aiAllowed", "IA liberada", state.aiAllowed ? "O dono pode escolher a moderação automática." : "Desligar volta a moderação para manual.")}
    </div>
  );
}
