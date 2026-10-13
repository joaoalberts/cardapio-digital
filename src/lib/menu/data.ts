import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import * as db from "@/lib/db/nocodb";
import type { MenuCategory, MenuItem, MenuMedia, MenuRestaurant, OpeningHours, PublicMenu } from "./types";

export function menuTag(slug: string) {
  return `menu:${slug}`;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Nome da mesa pelo código do QR. Sem cache: é uma busca pequena, feita só por quem lê o
// QR de uma mesa. Qualquer falha só deixa de mostrar a mesa; o cardápio continua.
export async function getTableLabel(slug: string, code: string): Promise<string | null> {
  const s = slug.toLowerCase();
  const c = code.toUpperCase();
  if (!SLUG.test(s) || !/^[A-Z0-9]{1,12}$/.test(c)) return null;
  try {
    const r = await db.first<{ id: string }>("restaurants", { slug: s });
    if (!r) return null;
    const t = await db.first<{ label: string; active: boolean }>("dining_tables", { restaurant_id: r.id, code: c });
    return t?.active ? t.label : null;
  } catch {
    return null;
  }
}

type R = Omit<MenuRestaurant, "cover" | "language"> & {
  show_hours: boolean;
  show_payments: boolean;
};
type C = { id: string; name: string; description: string | null; available_from: string | null; available_to: string | null; active: boolean };
type I = Omit<MenuItem, "media"> & { category_id: string; active: boolean };
type M = MenuMedia & { Id: number; item_id: string | null; category_id: string | null; status: string };
type T = { category_id: string | null; item_id: string | null; language: string; name: string; description: string | null };

const media = (m: M): MenuMedia => ({
  id: m.id,
  kind: m.kind,
  storage_path: m.storage_path,
  mux_playback_id: m.mux_playback_id,
  mux_mp4: m.mux_mp4,
  poster_path: m.poster_path,
});

// Cardápio público em cache; o painel invalida pela tag ao salvar.
// Só o que está ativo e pronto, no idioma pedido; sem tradução, cai no texto base (pt-BR).
export async function getPublicMenu(slug: string, lang = "pt-BR"): Promise<PublicMenu | null> {
  "use cache";
  cacheTag(menuTag(slug));
  cacheLife("minutes");

  const s = slug.toLowerCase();
  if (!SLUG.test(s)) return null;
  const r = await db.first<R>("restaurants", { slug: s });
  if (!r) return null;

  const byRestaurant = { restaurant_id: r.id };
  const [cats, items, allMedia, trs] = await Promise.all([
    db.list<C>("categories", byRestaurant, { sort: "position,Id" }),
    db.list<I>("items", byRestaurant, { sort: "position,Id" }),
    db.list<M>("media", byRestaurant, { sort: "position,Id" }),
    db.list<T>("translations", byRestaurant),
  ]);

  const languages = r.languages?.length ? r.languages : ["pt-BR"];
  const language = languages.includes(lang) ? lang : "pt-BR";
  const tr = (key: "category_id" | "item_id", id: string) =>
    language === "pt-BR" ? undefined : trs.find((t) => t[key] === id && t.language === language);
  const ready = allMedia.filter((m) => m.status === "ready");
  // Mais recente = criada por último (maior Id), como o "order by created_at desc" de antes.
  const latest = (list: M[]) => (list.length ? media(list.reduce((a, b) => (a.Id > b.Id ? a : b))) : null);

  const categories: MenuCategory[] = cats
    .filter((c) => c.active)
    .map((c) => {
      const ct = tr("category_id", c.id);
      return {
        id: c.id,
        name: ct?.name || c.name,
        description: ct?.description || c.description || "",
        available_from: c.available_from || null,
        available_to: c.available_to || null,
        cover: latest(ready.filter((m) => m.category_id === c.id)),
        items: items
          .filter((i) => i.category_id === c.id && i.active)
          .map((i) => {
            const it = tr("item_id", i.id);
            return {
              id: i.id,
              name: it?.name || i.name,
              description: it?.description || i.description || "",
              price_cents: i.price_cents ?? 0,
              promo_price_cents: i.promo_price_cents ?? null,
              hide_price: !!i.hide_price,
              featured: !!i.featured,
              serves: i.serves ?? null,
              country: i.country ?? null,
              price_options: i.price_options ?? null,
              tags: i.tags ?? [],
              media: ready.filter((m) => m.item_id === i.id).map(media),
            };
          }),
      };
    });

  const restaurant: MenuRestaurant = {
    id: r.id,
    name: r.name,
    slug: r.slug,
    logo_path: r.logo_path ?? null,
    brand_color: r.brand_color ?? null,
    languages,
    menu_version: r.menu_version ?? 1,
    cover_video_path: r.cover_video_path ?? null,
    cover_image_path: r.cover_image_path ?? null,
    cover: latest(ready.filter((m) => !m.item_id && !m.category_id)),
    font_theme: r.font_theme || "moderno",
    timezone: r.timezone || "America/Sao_Paulo",
    opening_hours: r.show_hours ? ((r.opening_hours as OpeningHours | null) ?? null) : null,
    description: r.description ?? "",
    phone: r.phone ?? null,
    address: r.address ?? null,
    instagram: r.instagram ?? null,
    facebook: r.facebook ?? null,
    wifi_name: r.wifi_name ?? null,
    wifi_password: r.wifi_password ?? null,
    payment_methods: r.show_payments ? (r.payment_methods ?? []) : [],
    language,
  };
  return { restaurant, categories };
}
