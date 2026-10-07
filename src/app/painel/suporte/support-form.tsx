"use client";

import { useState, useTransition } from "react";
import { sendSupport } from "./actions";

export function SupportForm({ restaurantId, whatsapp }: { restaurantId: string; whatsapp: string | null }) {
  const [f, setF] = useState({ subject: "", whatsapp: "", message: "" });
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value }));

  const send = () =>
    start(async () => {
      setErr(null);
      const res = await sendSupport(restaurantId, f);
      if (res.error) return setErr(res.error);
      setSent(true);
      setF({ subject: "", whatsapp: "", message: "" });
    });

  return (
    <div className="sp">
      <p className="sp-note">Entre em contato conosco através do formulário abaixo :)</p>
      <label className="sp-field">
        <span>Assunto</span>
        <input value={f.subject} onChange={set("subject")} maxLength={120} />
      </label>
      <label className="sp-field">
        <span>WhatsApp</span>
        <input value={f.whatsapp} onChange={set("whatsapp")} maxLength={30} inputMode="tel" />
      </label>
      <label className="sp-field">
        <span>Descrição</span>
        <textarea value={f.message} onChange={set("message")} maxLength={3000} rows={4} />
      </label>
      {err && (
        <p className="md-err" role="alert">
          {err}
        </p>
      )}
      {sent && <p className="sp-ok">Mensagem enviada. Respondemos pelo seu e-mail ou WhatsApp.</p>}
      <div>
        <button className="btn primary" onClick={send} disabled={pending || !f.subject.trim() || !f.message.trim()}>
          {pending ? "Enviando…" : "Enviar mensagem"}
        </button>
      </div>
      {whatsapp && (
        <p className="sp-note">
          Ou mande mensagem pelo WhatsApp:{" "}
          <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer" aria-label="Abrir WhatsApp">
            <svg viewBox="0 0 24 24" aria-hidden>
              <rect width="24" height="24" rx="5" fill="#25d366" />
              <path d="M6 18l.9-2.8A6.3 6.3 0 1112 18.3a6.3 6.3 0 01-3.1-.8zM10 9.6c0 2.3 1.9 4.2 4.2 4.2l.8-1.1-1.5-.8-.8.6a3 3 0 01-1.4-1.4l.6-.8-.8-1.5z" fill="#fff" />
            </svg>
          </a>
        </p>
      )}
    </div>
  );
}
