import type { Metadata } from "next";
import { Suspense } from "react";
import { fontVariables } from "@/lib/menu/fonts";
import { mediaUrl } from "@/lib/menu/media";
import { createClient } from "@/lib/supabase/server";
import { translationEnabled } from "@/lib/translate";
import { currentRestaurant } from "../current";
import { PanelShell } from "../shell";
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
  const supabase = await createClient();

  // As regras do banco já limitam tudo ao restaurante do usuário; o filtro deixa explícito.
  const [cats, items, media, trs] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, active, description, available_from, available_to, position, created_at").eq("restaurant_id", r.id).order("position").order("created_at"),
    supabase
      .from("items")
      .select(
        "id, category_id, name, description, price_cents, promo_price_cents, tags, active, featured, hide_price, serves, country, price_options, position, created_at",
      )
      .eq("restaurant_id", r.id)
      .order("position")
      .order("created_at"),
    supabase
      .from("media")
      .select("item_id, category_id, kind, storage_path, poster_path, mux_playback_id, status, position, created_at")
      .eq("restaurant_id", r.id)
      .order("position")
      .order("created_at"),
    supabase.from("translations").select("language, name, description, auto, category_id, item_id").eq("restaurant_id", r.id),
  ]);
  for (const q of [cats, items, media, trs]) if (q.error) throw q.error;

  const translations = (trs.data ?? []) as Tr[];
  const pick = (t: Tr) => ({ language: t.language, name: t.name, description: t.description, auto: t.auto });

  type M = NonNullable<typeof media.data>[number];
  const toMedia = (m: M | undefined): EditorItem["media"] =>
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

  const categories: EditorCategory[] = (cats.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    active: c.active,
    description: c.description ?? "",
    availableFrom: hhmm(c.available_from),
    availableTo: hhmm(c.available_to),
    media: toMedia((media.data ?? []).findLast((x) => x.category_id === c.id)),
    translations: translations.filter((t) => t.category_id === c.id).map(pick),
    items: (items.data ?? [])
      .filter((i) => i.category_id === c.id)
      .map((i) => ({
        id: i.id,
        categoryId: i.category_id,
        name: i.name,
        description: i.description,
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
        media: toMedia((media.data ?? []).find((x) => x.item_id === i.id)),
        translations: translations.filter((t) => t.item_id === i.id).map(pick),
      })),
  }));

  const logo = mediaUrl(r.logo_path);
  return (
    <PanelShell restaurant={{ name: r.name, slug: r.slug, logo }} active="/painel/cardapio" title="Cardápio Digital">
      <MenuEditor
        restaurant={{
          id: r.id,
          name: r.name,
          slug: r.slug,
          brandColor: r.brand_color,
          wifiName: r.wifi_name,
          wifiPassword: r.wifi_password,
          isOwner,
        }}
        languages={r.languages.filter((l) => l !== "pt-BR")}
        canTranslate={translationEnabled()}
        categories={categories}
      />
    </PanelShell>
  );
}
