import type { Metadata } from "next";
import { Suspense } from "react";
import { fontVariables } from "@/lib/menu/fonts";
import { mediaUrl } from "@/lib/menu/media";
import { parseSubgroup } from "@/lib/menu/list";
import * as db from "@/lib/db/nocodb";
import { translationEnabled } from "@/lib/translate";
import { currentRestaurant } from "../current";
import { PanelShell } from "../shell";
import { ownerMenuHref } from "../menu-link";
import { MenuEditor, type EditorCategory, type EditorItem } from "./menu-editor";
import "../panel.css";
import "./cardapio.css";

export const metadata: Metadata = { title: "Cardápio" };

export default function CardapioPage() {
  return (
    <div className={`ap ${fontVariables}`}>
      <Suspense fallback={<div className="ap-loading" />}>
        <Cardapio />
      </Suspense>
    </div>
  );
}

type Tr = { language: string; name: string; description: string; auto: boolean; category_id: string | null; item_id: string | null };

async function Cardapio() {
  const { restaurant, isOwner } = await currentRestaurant("logo_path, languages, brand_color, wifi_name, wifi_password");
  const r = restaurant as typeof restaurant & {
    logo_path: string | null;
    languages: string[];
    brand_color: string | null;
    wifi_name: string | null;
    wifi_password: string | null;
  };
  type Cat = { id: string; name: string; active: boolean; description: string | null; available_from: string | null; available_to: string | null; half_half: boolean; special?: boolean };
  type It = {
    id: string; category_id: string; name: string; description: string | null; price_cents: number;
    promo_price_cents: number | null; tags: string[] | null; active: boolean; featured: boolean; hide_price: boolean;
    serves: number | null; country: string | null; price_options: unknown; subgroup?: string | null;
  };
  type Med = {
    item_id: string | null; category_id: string | null; kind: "photo" | "video"; storage_path: string | null;
    poster_path: string | null; mux_playback_id: string | null; status: "processing" | "ready" | "failed";
  };
  const byRestaurant = { restaurant_id: r.id };
  const [cats, items, media, trs] = await Promise.all([
    db.list<Cat>("categories", byRestaurant, { sort: "position,Id" }),
    db.list<It>("items", byRestaurant, { sort: "position,Id" }),
    db.list<Med>("media", byRestaurant, { sort: "position,Id" }),
    db.list<Tr>("translations", byRestaurant),
  ]);

  const translations = trs;
  const pick = (t: Tr) => ({ language: t.language, name: t.name, description: t.description ?? "", auto: t.auto });

  const toMedia = (m: Med | undefined): EditorItem["media"] =>
    m
      ? {
          kind: m.kind,
          status: m.status,
          url: (m.mux_playback_id ? `https://stream.mux.com/${m.mux_playback_id}.m3u8` : mediaUrl(m.storage_path)) ?? "",
          thumb:
            mediaUrl(m.poster_path ?? m.storage_path) ??
            (m.mux_playback_id ? `https://image.mux.com/${m.mux_playback_id}/thumbnail.jpg` : ""),
        }
      : null;
  const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

  // A categoria escondida dos produtos especiais tem a seção própria (/painel/especiais).
  const categories: EditorCategory[] = cats.filter((c) => !c.special).map((c) => ({
    id: c.id,
    name: c.name,
    active: c.active,
    description: c.description ?? "",
    availableFrom: hhmm(c.available_from),
    availableTo: hhmm(c.available_to),
    halfHalf: !!c.half_half,
    media: toMedia(media.findLast((x) => x.category_id === c.id)),
    translations: translations.filter((t) => t.category_id === c.id).map(pick),
    items: items
      .filter((i) => i.category_id === c.id)
      .map((i) => ({
        id: i.id,
        categoryId: i.category_id,
        name: i.name,
        description: i.description ?? "",
        priceCents: i.price_cents,
        promoCents: i.promo_price_cents,
        tags: i.tags ?? [],
        active: i.active,
        featured: i.featured,
        hidePrice: i.hide_price,
        serves: i.serves,
        country: i.country,
        priceOptions: (i.price_options as { label: string; price_cents: number }[] | null)?.map((o) => ({
          label: o.label,
          priceCents: o.price_cents,
        })) ?? null,
        subgroup: parseSubgroup(i.subgroup),
        media: toMedia(media.find((x) => x.item_id === i.id)),
        translations: translations.filter((t) => t.item_id === i.id).map(pick),
      })),
  }));

  const logo = mediaUrl(r.logo_path);
  return (
    <PanelShell restaurant={{ id: r.id, name: r.name, slug: r.slug, logo, aparecaAllowed: r.apareca_allowed === true }} active="/painel/cardapio" title="Cardápio" lead="Pratos, preços e fotos do cardápio.">
      <MenuEditor
        restaurant={{
          id: r.id,
          name: r.name,
          slug: r.slug,
          brandColor: r.brand_color,
          wifiName: r.wifi_name,
          wifiPassword: r.wifi_password,
          isOwner,
          previewHref: await ownerMenuHref(r.id, r.slug),
        }}
        languages={(r.languages ?? []).filter((l) => l !== "pt-BR")}
        canTranslate={translationEnabled()}
        categories={categories}
      />
    </PanelShell>
  );
}
