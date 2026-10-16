"use client";

import { useSyncExternalStore } from "react";

// Abertura do cardápio: primeiro o banner (o que a pessoa vê ao abrir o link). Os vídeos
// dos cards e o player de vídeo esperam o banner começar a tocar (ou um tempo máximo),
// para não disputarem a internet do celular com ele e a página não abrir travada.
let open = false;
const listeners = new Set<() => void>();

export function openStartGate() {
  if (open) return;
  open = true;
  listeners.forEach((l) => l());
}

export const startGateOpen = () => open;

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStartGate(): boolean {
  return useSyncExternalStore(subscribe, startGateOpen, () => false);
}

// Só para os testes.
export function resetStartGate() {
  open = false;
}
