"use client";

import { useEffect } from "react";
import { useOrder } from "./order-context";

// A mesa é resolvida no servidor (mesa-tag.tsx) sem atrasar o cardápio; aqui ela chega ao carrinho.
export function TableBridge({ code, label }: { code: string; label: string }) {
  const { setTable } = useOrder();
  useEffect(() => {
    setTable({ code, label });
    return () => setTable(null);
  }, [code, label, setTable]);
  return null;
}
