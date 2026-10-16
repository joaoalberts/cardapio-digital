import type { Metadata } from "next";
import { Suspense } from "react";
import { mediaUrl } from "@/lib/menu/media";
import { currentRestaurant } from "../current";
import { PanelShell } from "../shell";
import { listQueue, type QueueResult } from "./actions";
import { Fila } from "./fila";
import "../panel.css";
import "./apareca.css";

export const metadata: Metadata = { title: "Apareça na TV" };

export default function AparecaPage() {
  return (
    <div className="ap">
      <Suspense fallback={<div className="ap-loading" />}>
        <Apareca />
      </Suspense>
    </div>
  );
}

const EMPTY: QueueResult = { items: [], newest: null, warn: "ok" };

async function Apareca() {
  const { restaurant } = await currentRestaurant();
  const r = restaurant as typeof restaurant & { logo_path: string | null; community_enabled?: unknown };
  const initial = await listQueue(r.id).catch(() => null);
  return (
    <PanelShell restaurant={{ id: r.id, name: r.name, slug: r.slug, logo: mediaUrl(r.logo_path) }} active="/painel/apareca" title="Apareça na TV">
      <Fila rid={r.id} initial={initial ?? EMPTY} initialOk={initial !== null} communityOn={r.community_enabled === true} />
    </PanelShell>
  );
}
