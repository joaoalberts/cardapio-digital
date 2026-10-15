"use client";

import { useCallback, useEffect, useState } from "react";
import type { PublicOrder } from "@/lib/orders/service";

const EVERY_MS = 10_000;
const STOP_AFTER_MS = 2 * 60 * 60 * 1000;

// Pedidos deste celular. Consulta a cada 10 s só enquanto há pedido ainda não pronto
// e a página está visível; desiste depois de 2 h.
export function useDeviceOrders(slug: string, device: string | null, active: boolean) {
  const [orders, setOrders] = useState<PublicOrder[]>([]);
  const refresh = useCallback(async () => {
    if (!device) return;
    const r = await fetch(`/api/pedidos/${slug}?device=${device}`, { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ orders: PublicOrder[] }>) : null))
      .catch(() => null);
    if (r?.orders) setOrders(r.orders);
  }, [slug, device]);

  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => void refresh(), 0); // fora do corpo do efeito (react-hooks/set-state-in-effect)
    return () => clearTimeout(id);
  }, [active, refresh]);

  const pending = orders.some((o) => o.status === "new" || o.status === "preparing");
  useEffect(() => {
    if (!active || !pending) return;
    const started = Date.now();
    const id = setInterval(() => {
      if (Date.now() - started > STOP_AFTER_MS) return clearInterval(id);
      if (document.visibilityState === "visible") void refresh();
    }, EVERY_MS);
    return () => clearInterval(id);
  }, [active, pending, refresh]);

  const push = useCallback((o: PublicOrder) => setOrders((list) => [o, ...list.filter((x) => x.id !== o.id)]), []);
  return { orders, refresh, push };
}
