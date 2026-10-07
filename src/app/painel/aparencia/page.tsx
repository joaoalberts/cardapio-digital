import type { Metadata } from "next";
import { Suspense } from "react";
import { getPublicMenu } from "@/lib/menu/data";
import { fontVariables } from "@/lib/menu/fonts";
import { DEFAULT_FONT_THEME, isFontTheme } from "@/lib/menu/font-themes";
import { mediaUrl } from "@/lib/menu/media";
import { currentRestaurant } from "../current";
import { PanelShell } from "../shell";
import { FontPicker } from "./font-picker";
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

async function Aparencia() {
  const { restaurant, isOwner } = await currentRestaurant("font_theme, logo_path");
  const r = restaurant as typeof restaurant & { font_theme: string; logo_path: string | null };
  const menu = await getPublicMenu(r.slug);
  const logo = mediaUrl(r.logo_path);
  const sampleDish = menu?.categories.find((c) => c.items.length)?.items[0]?.name ?? "Margherita da Casa";

  return (
    <PanelShell restaurant={{ id: r.id, name: r.name, slug: r.slug, logo }} active="/painel/aparencia" title="Aparência">
      <section className="ap-card">
        <div className="ap-card-head">
          <svg className="icon" viewBox="0 0 24 24" aria-hidden>
            <path d="M4 20l6-16h1l6 16M6.5 14h9" />
          </svg>
          <h2>Fonte do cardápio</h2>
        </div>
        <p className="ap-lead">
          Escolha a fonte dos nomes dos pratos e das categorias. A logo e o banner ficam em Editar
          Perfil e não mudam com a fonte. A prévia ao lado é o seu cardápio de verdade: toque nela
          para navegar.
        </p>
        <FontPicker
          restaurantId={r.id}
          published={isFontTheme(r.font_theme) ? r.font_theme : DEFAULT_FONT_THEME}
          canPublish={isOwner}
          slug={r.slug}
          sampleDish={sampleDish}
        />
      </section>
    </PanelShell>
  );
}
