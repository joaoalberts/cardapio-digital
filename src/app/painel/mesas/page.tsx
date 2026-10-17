import type { Metadata } from "next";
import { Suspense } from "react";
import { mediaUrl } from "@/lib/menu/media";
import * as db from "@/lib/db/nocodb";
import { currentRestaurant } from "../current";
import { PanelShell } from "../shell";
import { TablesEditor } from "./tables-editor";
import "../panel.css";
import "../cardapio/cardapio.css";
import "./mesas.css";

export const metadata: Metadata = { title: "Mesas e QR" };

export default function MesasPage() {
  return (
    <div className="ap">
      <Suspense fallback={<div className="ap-loading" />}>
        <Mesas />
      </Suspense>
    </div>
  );
}

async function Mesas() {
  const { restaurant } = await currentRestaurant("logo_path");
  const r = restaurant as typeof restaurant & { logo_path: string | null };
  const rows = await db.list<{ id: string; label: string; code: string }>("dining_tables", { restaurant_id: r.id });
  const data = rows.map(({ id, label, code }) => ({ id, label, code }));
  return (
    <PanelShell restaurant={{ id: r.id, name: r.name, slug: r.slug, logo: mediaUrl(r.logo_path) }} active="/painel/mesas" title="Mesas e QR" lead="As mesas da casa e o QR de cada uma para imprimir.">
      <section className="ap-card">
        <div className="ap-card-head">
          <h2>Mesas e QR Code</h2>
        </div>
        <TablesEditor restaurantId={r.id} initial={data} />
      </section>
    </PanelShell>
  );
}
