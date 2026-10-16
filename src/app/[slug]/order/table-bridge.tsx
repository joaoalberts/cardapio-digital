"use client";

import { useEffect } from "react";
import { tableMemoryKey, writeTableMemory } from "@/lib/orders/table-memory";
import { useOrder } from "./order-context";

// A mesa é resolvida no servidor (mesa-tag.tsx) sem atrasar o cardápio; aqui ela chega ao carrinho.
// Cada mesa validada pelo servidor fica lembrada no celular por 4 h (table-memory.ts); ler o QR
// de outra mesa troca a lembrada.
export function TableBridge({ code, label }: { code: string; label: string }) {
  const { setTable, slug } = useOrder();
  useEffect(() => {
    setTable({ code, label });
    try {
      localStorage.setItem(tableMemoryKey(slug), writeTableMemory({ code, label }, Date.now()));
    } catch {}
    return () => setTable(null);
  }, [code, label, setTable, slug]);
  return null;
}
