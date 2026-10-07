import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPublicMenu } from "@/lib/menu/data";
import { fontVariables } from "@/lib/menu/fonts";
import { DEFAULT_FONT_THEME, isFontTheme } from "@/lib/menu/font-themes";
import { mediaUrl, thumbSrc, posterSrc } from "@/lib/menu/media";
import type { MenuCategory } from "@/lib/menu/types";
import { FontPicker, type PreviewData } from "./font-picker";
import "@/styles/font-themes.css";
import "./aparencia.css";

export const metadata: Metadata = { title: "Aparência" };

export default function AparenciaPage() {
  return (
    <div className={`ap ${fontVariables}`}>
      <Suspense fallback={<div className="ap-loading" />}>
        <Aparencia />
      </Suspense>
    </div>
  );
}

// Prévia com o cardápio do próprio restaurante; sem pratos ainda, usa um exemplo.
const SAMPLE: PreviewData["categories"] = [
  {
    name: "Pizzas",
    count: 4,
    thumb: "/demo/pz-margherita-t.jpg",
    items: [
      { name: "Margherita da Casa", description: "Molho de tomate pelado, muçarela, tomate-cereja e manjericão fresco.", price_cents: 6200, image: "/demo/pz-queijos.jpg", thumb: "/demo/pz-queijos-t.jpg" },
    ],
  },
  {
    name: "Massas",
    count: 4,
    thumb: "/demo/ms-pomodoro-t.jpg",
    items: [
      { name: "Penne all’Arrabbiata", description: "Molho de tomate apimentado, alho e salsinha.", price_cents: 5200, image: "/demo/ms-pomodoro.jpg", thumb: "/demo/ms-pomodoro-t.jpg" },
      { name: "Spaghetti à Bolonhesa", description: "Ragu de carne cozido por seis horas e parmesão.", price_cents: 5800, image: "/demo/ms-bolonhesa.jpg", thumb: "/demo/ms-bolonhesa-t.jpg" },
      { name: "Linguine de Frango e Ervas", description: "Frango grelhado, cogumelos e ervas.", price_cents: 6100, image: "/demo/ms-frango-t.jpg", thumb: "/demo/ms-frango-t.jpg" },
    ],
  },
  { name: "Burgers", count: 4, thumb: "/demo/bg-classico-t.jpg", items: [] },
  { name: "Sobremesas", count: 4, thumb: "/demo/sb-chocolate-t.jpg", items: [] },
];

function toPreview(categories: MenuCategory[]): PreviewData["categories"] | null {
  const withItems = categories.filter((c) => c.items.length);
  if (!withItems.length) return null;
  return withItems.slice(0, 6).map((c) => ({
    name: c.name,
    count: c.items.length,
    thumb: thumbSrc(c.items[0]),
    items: c.items.slice(0, 4).map((i) => {
      const m = i.media[0];
      return {
        name: i.name,
        description: i.description,
        price_cents: i.price_cents,
        image: m ? (m.kind === "photo" ? mediaUrl(m.storage_path) : posterSrc(m)) : null,
        thumb: thumbSrc(i),
      };
    }),
  }));
}

async function Aparencia() {
  await connection();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar");

  const { data: restaurant, error } = await supabase
    .from("restaurants")
    .select("id, name, slug, font_theme, cover_image_path, members!inner(role)")
    .eq("members.user_id", user.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!restaurant) redirect("/painel");

  const menu = await getPublicMenu(restaurant.slug);
  const isOwner = restaurant.members.some((m) => m.role === "owner");

  const preview: PreviewData = {
    name: restaurant.name,
    cover: restaurant.cover_image_path ? mediaUrl(restaurant.cover_image_path) : "/demo/v-forno-poster.jpg",
    categories: (menu && toPreview(menu.categories)) ?? SAMPLE,
  };

  return (
    <div className="ap-app">
      <aside>
        <div className="ap-brand">
          <b>●</b> CARDÁPIO
        </div>
        <div className="ap-rest">
          <i>{initials(restaurant.name)}</i>
          <span>{restaurant.name}</span>
        </div>
        <nav>
          <Link href="/painel">
            <svg className="icon" viewBox="0 0 24 24" aria-hidden>
              <path d="M7 3v8M5 3v5a2 2 0 004 0V3M7 11v10M17 3c-2 0-3 2-3 5s1 4 3 4v9" />
            </svg>
            Início
          </Link>
          <Link href="/painel/aparencia" className="on" aria-current="page">
            <svg className="icon" viewBox="0 0 24 24" aria-hidden>
              <path d="M4 20h4L19 9a2.8 2.8 0 00-4-4L4 16v4zM13.5 6.5l4 4" />
            </svg>
            Aparência
          </Link>
          <a href={`/${restaurant.slug}`} target="_blank" rel="noreferrer">
            <svg className="icon" viewBox="0 0 24 24" aria-hidden>
              <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />
            </svg>
            Abrir cardápio
          </a>
        </nav>
      </aside>
      <main>
        <div className="ap-crumb">Aparência</div>
        <h1>Fonte do cardápio</h1>
        <p className="ap-lead">
          Escolha a fonte dos nomes dos pratos, das categorias e do logo. A prévia mostra como seus
          clientes vão ver o cardápio no celular.
        </p>
        <FontPicker
          restaurantId={restaurant.id}
          published={isFontTheme(restaurant.font_theme) ? restaurant.font_theme : DEFAULT_FONT_THEME}
          canPublish={isOwner}
          preview={preview}
        />
      </main>
    </div>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
