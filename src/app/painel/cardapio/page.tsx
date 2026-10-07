import type { Metadata } from "next";
import { Suspense } from "react";
import { fontVariables } from "@/lib/menu/fonts";
import { mediaUrl } from "@/lib/menu/media";
import { createClient } from "@/lib/supabase/server";
import { translationEnabled } from "@/lib/translate";
import { currentRestaurant } from "../current";
import { PanelNav } from "../panel-nav";
import { MenuEditor, type EditorCategory } from "./menu-editor";
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
  const { restaurant } = await currentRestaurant("logo_path, languages");
  const r = restaurant as typeof restaurant & { logo_path: string | null; languages: string[] };
  const supabase = await createClient();

  // As regras do banco já limitam tudo ao restaurante do usuário; o filtro deixa explícito.
  const [cats, items, media, trs] = await Promise.all([
    supabase.from("categories").select("id, name, active, position, created_at").eq("restaurant_id", r.id).order("position").order("created_at"),
    supabase
      .from("items")
      .select("id, category_id, name, description, price_cents, promo_price_cents, tags, active, position, created_at")
      .eq("restaurant_id", r.id)
      .order("position")
      .order("created_at"),
    supabase
      .from("media")
      .select("item_id, kind, storage_path, poster_path, mux_playback_id, status, position")
      .eq("restaurant_id", r.id)
      .order("position"),
    supabase.from("translations").select("language, name, description, auto, category_id, item_id").eq("restaurant_id", r.id),
  ]);
  for (const q of [cats, items, media, trs]) if (q.error) throw q.error;

  const translations = (trs.data ?? []) as Tr[];
  const pick = (t: Tr) => ({ language: t.language, name: t.name, description: t.description, auto: t.auto });

  const categories: EditorCategory[] = (cats.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    active: c.active,
    translations: translations.filter((t) => t.category_id === c.id).map(pick),
    items: (items.data ?? [])
      .filter((i) => i.category_id === c.id)
      .map((i) => {
        const m = (media.data ?? []).find((x) => x.item_id === i.id);
        return {
          id: i.id,
          categoryId: i.category_id,
          name: i.name,
          description: i.description,
          priceCents: i.price_cents,
          promoCents: i.promo_price_cents,
          tags: i.tags ?? [],
          active: i.active,
          media: m
            ? {
                kind: m.kind,
                status: m.status,
                url: (m.mux_playback_id ? `https://stream.mux.com/${m.mux_playback_id}.m3u8` : mediaUrl(m.storage_path)) ?? "",
                thumb:
                  mediaUrl(m.poster_path ?? m.storage_path) ??
                  (m.mux_playback_id ? `https://image.mux.com/${m.mux_playback_id}/thumbnail.jpg` : ""),
              }
            : null,
          translations: translations.filter((t) => t.item_id === i.id).map(pick),
        };
      }),
  }));

  const logo = mediaUrl(r.logo_path);
  return (
    <div className="ap-app">
      <PanelNav name={r.name} slug={r.slug} logo={logo} active="/painel/cardapio" />
      <main>
        <div className="ap-crumb">Cardápio</div>
        <h1>Categorias e pratos</h1>
        <p className="ap-lead">
          O que você salvar aqui aparece no cardápio dos clientes na hora. Use as setas para mudar a
          ordem e o olho para esconder sem apagar.
        </p>
        <MenuEditor
          restaurantId={r.id}
          slug={r.slug}
          languages={r.languages.filter((l) => l !== "pt-BR")}
          canTranslate={translationEnabled()}
          categories={categories}
        />
      </main>
    </div>
  );
}
