import type { Metadata } from "next";
import { Suspense } from "react";
import { mediaUrl } from "@/lib/menu/media";
import { specialInfo } from "@/lib/menu/specials";
import * as db from "@/lib/db/nocodb";
import { currentRestaurant } from "../current";
import { PanelShell } from "../shell";
import { ensureSpecialCategory } from "./actions";
import { SpecialsEditor, type EditorSpecial } from "./especiais-editor";
import "../panel.css";
import "../cardapio/cardapio.css";
import "./especiais.css";

export const metadata: Metadata = { title: "Produtos especiais" };

export default function EspeciaisPage() {
  return (
    <div className="ap">
      <Suspense fallback={<div className="ap-loading" />}>
        <Especiais />
      </Suspense>
    </div>
  );
}

type It = {
  id: string; name: string; description: string | null; price_cents: number; promo_price_cents: number | null; active: boolean;
  special_every_h: number | null; special_show_s: number | null; special_days: unknown; special_from: string | null; special_to: string | null; special_limit: number | null; special_times: unknown;
};
type Med = { item_id: string | null; kind: "photo" | "video"; storage_path: string | null; poster_path: string | null; mux_playback_id: string | null; status: "processing" | "ready" | "failed" };

async function Especiais() {
  const { restaurant } = await currentRestaurant();
  const r = restaurant as typeof restaurant & { logo_path: string | null };
  const catId = await ensureSpecialCategory(r.id);
  const [items, media] = await Promise.all([
    db.list<It>("items", { restaurant_id: r.id, category_id: catId }, { sort: "position,Id" }),
    db.list<Med>("media", { restaurant_id: r.id }, { sort: "position,Id" }),
  ]);
  const toMedia = (m: Med | undefined): EditorSpecial["media"] =>
    m
      ? {
          kind: m.kind,
          status: m.status,
          url: (m.mux_playback_id ? `https://stream.mux.com/${m.mux_playback_id}.m3u8` : mediaUrl(m.storage_path)) ?? "",
          thumb: mediaUrl(m.poster_path ?? m.storage_path) ?? (m.mux_playback_id ? `https://image.mux.com/${m.mux_playback_id}/thumbnail.jpg` : ""),
        }
      : null;
  const specials: EditorSpecial[] = items.map((i) => {
    const s = specialInfo(i);
    return {
      id: i.id,
      name: i.name,
      description: i.description ?? "",
      priceCents: i.price_cents,
      promoCents: i.promo_price_cents,
      active: i.active,
      everyH: s.every_h,
      showS: s.show_s,
      days: s.days,
      from: s.from,
      to: s.to,
      limit: s.limit,
      times: s.times ?? [],
      media: toMedia(media.find((x) => x.item_id === i.id)),
    };
  });
  return (
    <PanelShell restaurant={{ id: r.id, name: r.name, slug: r.slug, logo: mediaUrl(r.logo_path) }} active="/painel/especiais" title="Produtos especiais">
      <SpecialsEditor restaurantId={r.id} specials={specials} />
    </PanelShell>
  );
}
