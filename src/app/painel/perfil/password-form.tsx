"use client";

import { useActionState, useEffect, useRef } from "react";
import { changePassword, type FormState } from "@/app/(auth)/actions";

// Trocar senha: pede a atual e a nova duas vezes.
export function PasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(changePassword, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.message) form.current?.reset();
  }, [state]);

  return (
    <section className="ap-card pf">
      <div className="ap-card-head">
        <svg className="icon" viewBox="0 0 24 24" aria-hidden>
          <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 017 0v3" />
        </svg>
        <h2>Trocar senha</h2>
      </div>
      <form ref={form} action={action} className="pf-form">
        <label className="pf-field">
          <span className="pf-cap">Senha atual</span>
          <input name="current" type="password" autoComplete="current-password" required />
        </label>
        <label className="pf-field">
          <span className="pf-cap">Senha nova</span>
          <input name="password" type="password" autoComplete="new-password" minLength={8} required />
          <small className="pf-hint">Pelo menos 8 caracteres.</small>
        </label>
        <label className="pf-field">
          <span className="pf-cap">Repita a senha nova</span>
          <input name="confirm" type="password" autoComplete="new-password" minLength={8} required />
        </label>
        {state.error && (
          <p className="md-err" role="alert">
            {state.error}
          </p>
        )}
        {state.message && (
          <p className="pf-ok" role="status">
            {state.message}
          </p>
        )}
        <div>
          <button type="submit" className="btn primary" disabled={pending}>
            {pending ? "Salvando…" : "Salvar senha"}
          </button>
        </div>
      </form>
    </section>
  );
}
