import type { Metadata } from "next";
import { Suspense } from "react";
import { mediaUrl } from "@/lib/menu/media";
import * as db from "@/lib/db/nocodb";
import { listOpenOrders, type OrdersDb } from "@/lib/orders/service";
import { currentRestaurant } from "../current";
import { PanelShell } from "../shell";
import { KitchenBoard } from "./kitchen-board";
import "../panel.css";
import "./pedidos.css";

export const metadata: Metadata = { title: "Pedidos" };

export default function PedidosPage() {
  return (
    <div className="ap">
      <Suspense fallback={<div className="ap-loading" />}>
        <Pedidos />
      </Suspense>
    </div>
  );
}

async function Pedidos() {
  const { restaurant } = await currentRestaurant();
  const r = restaurant as typeof restaurant & { logo_path: string | null; orders_enabled?: boolean };
  const open = await listOpenOrders({ db: db as unknown as OrdersDb }, r.id).catch(() => []);
  const initial = open.map(({ id, status, table_label, lines, created_at, total_cents }) => ({ id, status, table_label, lines, created_at, total_cents }));
  return (
    <PanelShell restaurant={{ id: r.id, name: r.name, slug: r.slug, logo: mediaUrl(r.logo_path), aparecaAllowed: r.apareca_allowed === true }} active="/painel/pedidos" title="Pedidos" lead="Pedidos que chegaram das mesas. Toque para mudar o andamento.">
      <KitchenBoard restaurantId={r.id} initial={initial} enabled={!!r.orders_enabled} />
    </PanelShell>
  );
}
