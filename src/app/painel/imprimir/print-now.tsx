"use client";

import { useEffect } from "react";

// Botão (some na impressão) e, no cardápio, a janela de impressão já abre sozinha.
export function PrintNow({ label, auto }: { label: string; auto?: boolean }) {
  useEffect(() => {
    if (!auto) return;
    const id = setTimeout(() => print(), 600);
    return () => clearTimeout(id);
  }, [auto]);
  return (
    <button className="pr-btn" onClick={() => print()}>
      {label}
    </button>
  );
}
