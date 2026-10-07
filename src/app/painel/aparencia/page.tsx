import type { Metadata } from "next";
import { Suspense } from "react";
import { getPublicMenu } from "@/lib/menu/data";
import { fontVariables } from "@/lib/menu/fonts";
import { DEFAULT_FONT_THEME, isFontTheme } from "@/lib/menu/font-themes";
import { mediaUrl, thumbSrc, posterSrc } from "@/lib/menu/media";
import type { MenuCategory, OpeningHours } from "@/lib/menu/types";
import { currentRestaurant } from "../current";
import { PanelNav } from "../panel-nav";
import { FontPicker, type PreviewData } from "./font-picker";
import "@/styles/font-themes.css";
import "../panel.css";

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
  const { restaurant, isOwner } = await currentRestaurant(
    "font_theme, cover_image_path, logo_path, opening_hours, timezone",
  );
  const r = restaurant as typeof restaurant & {
    font_theme: string;
    cover_image_path: string | null;
    logo_path: string | null;
    opening_hours: OpeningHours | null;
    timezone: string;
  };
  const menu = await getPublicMenu(r.slug);
  const logo = mediaUrl(r.logo_path);

  const preview: PreviewData = {
    name: r.name,
    logo,
    hours: r.opening_hours,
    timezone: r.timezone,
    cover: r.cover_image_path ? mediaUrl(r.cover_image_path) : "/demo/v-forno-poster.jpg",
    categories: (menu && toPreview(menu.categories)) ?? SAMPLE,
  };

  return (
    <div className="ap-app">
      <PanelNav name={r.name} slug={r.slug} logo={logo} active="/painel/aparencia" />
      <main>
        <div className="ap-crumb">Aparência</div>
        <h1>Fonte do cardápio</h1>
        <p className="ap-lead">
          Escolha a fonte dos nomes dos pratos e das categorias. A logo é a imagem que você envia
          em Perfil do restaurante e não muda com a fonte. A prévia mostra como seus clientes vão
          ver o cardápio no celular.
        </p>
        <FontPicker
          restaurantId={r.id}
          published={isFontTheme(r.font_theme) ? r.font_theme : DEFAULT_FONT_THEME}
          canPublish={isOwner}
          preview={preview}
        />
      </main>
    </div>
  );
}
