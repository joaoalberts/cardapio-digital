"use client";

import { useRef, useState } from "react";

// Deslizar até 85% envia; um toque só balança (dica); Enter/Espaço e a ativação do leitor de tela enviam direto.
// onSend devolve false quando falhou: o botão volta ao começo.
export function SlideToSend({ label, busyLabel, disabled, onSend }: { label: string; busyLabel: string; disabled?: boolean; onSend: () => Promise<boolean> }) {
  const track = useRef<HTMLDivElement>(null);
  const start = useRef<number | null>(null);
  const moved = useRef(false);
  const [x, setX] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [nudge, setNudge] = useState(0);
  const max = () => (track.current ? track.current.clientWidth - 58 : 0);

  const fire = async () => {
    setX(max());
    setBusy(true);
    const ok = await onSend();
    setBusy(false);
    if (!ok) setX(0);
  };
  const end = () => {
    if (start.current === null) return;
    start.current = null;
    setDragging(false);
    if (x > max() * 0.85) return void fire();
    setX(0);
    if (!moved.current || x < 10) setNudge((k) => k + 1);
  };

  return (
    <div
      ref={track}
      className={`o-slide${disabled || busy ? " off" : ""}${dragging ? " drag" : ""}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || busy}
      aria-label={label}
      onPointerDown={(e) => {
        if (disabled || busy) return;
        start.current = e.clientX - x;
        moved.current = false;
        setDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (start.current === null) return;
        moved.current = true;
        setX(Math.max(0, Math.min(max(), e.clientX - start.current)));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onClick={(e) => {
        // Leitor de tela (toque duplo) e teclado geram clique sem arrasto: detail 0. Toque/mouse de verdade têm detail >= 1.
        if (e.detail !== 0 || disabled || busy) return;
        void fire();
      }}
      onKeyDown={(e) => {
        if (disabled || busy || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        void fire();
      }}
    >
      <div className="o-slide-fill" style={{ width: 58 + x }} />
      <div className="o-slide-txt">{busy ? busyLabel : label}</div>
      <div className="o-slide-knob" key={nudge} data-nudge={nudge > 0 || undefined} style={{ transform: `translateX(${x}px)` }}>
        <svg className="icon" viewBox="0 0 24 24" aria-hidden>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </div>
    </div>
  );
}
