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

// Story aberto cobre a capa: os vídeos dos cards soltam o arquivo (não só pausam). No
// iPhone, cada vídeo carregado ocupa decodificador e memória, e com a capa inteira
// carregada por baixo o vídeo do story demorava a começar (16/10). Ao voltar, os cards
// mostram a capa e recarregam (o navegador guarda o que já baixou).
let covered = false;
const coverListeners = new Set<() => void>();
export function setHomeCovered(v: boolean) {
  if (covered === v) return;
  covered = v;
  coverListeners.forEach((l) => l());
}
export function useHomeCovered(): boolean {
  return useSyncExternalStore(
    (l) => {
      coverListeners.add(l);
      return () => coverListeners.delete(l);
    },
    () => covered,
    () => false,
  );
}
