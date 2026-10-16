"use client";

import { useEffect, useState, type CSSProperties } from "react";

// Peças pequenas da Comunidade: relógio que anda por segundo, anel de contagem, ponto
// "ao vivo" e ícones. O anel gira pelo ângulo --cmu-left (@property em comunidade.css).

// Relógio do celular (mais a correção do servidor) que anda a cada `every` ms só enquanto
// `active`; parado, fica no último valor. Começa no relógio do servidor (seed) para a
// primeira pintura já mostrar o tempo certo.
export function useClock(active: boolean, seed: number, skew = 0, every = 1000): number {
  const [now, setNow] = useState(seed);
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now() + skew);
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, every);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [active, skew, every]);
  return now;
}

export function Ring({ angle, text, className = "" }: { angle: number; text?: string; className?: string }) {
  return (
    <span className={`cmu-tmr ${className}`} style={{ "--cmu-left": `${angle}deg` } as CSSProperties} aria-hidden>
      <i className="cmu-ring" />
      {text != null && <b>{text}</b>}
    </span>
  );
}

export const Live = ({ hidden }: { hidden?: boolean }) => (hidden ? null : <i className="cmu-live" aria-hidden />);

export const IconTv = () => (
  <svg className="icon" viewBox="0 0 24 24" aria-hidden>
    <rect x="3" y="5" width="18" height="12" rx="2.5" />
    <path d="M8 21h8M12 17v4" />
  </svg>
);
export const IconClock = () => (
  <svg className="icon" viewBox="0 0 24 24" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
export const IconQr = () => (
  <svg className="icon" viewBox="0 0 24 24" aria-hidden>
    <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" />
    <path d="M14 14h2v2h-2zM18 14h2M14 18v2M18 18h2v2" />
  </svg>
);
export const IconChevron = () => (
  <svg className="icon" viewBox="0 0 24 24" aria-hidden>
    <path d="M9 6l6 6-6 6" />
  </svg>
);
export const IconClose = () => (
  <svg className="icon" viewBox="0 0 24 24" aria-hidden>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const IconCamera = () => (
  <svg className="icon" viewBox="0 0 24 24" aria-hidden>
    <path d="M4 8.5A2.5 2.5 0 016.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0120 8.5v8a2.5 2.5 0 01-2.5 2.5h-11A2.5 2.5 0 014 16.5z" />
    <circle cx="12" cy="12.5" r="3.5" />
  </svg>
);
