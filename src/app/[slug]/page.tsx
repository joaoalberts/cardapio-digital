import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { preconnect } from "react-dom";
import { fontVariables } from "@/lib/menu/fonts";
import { getPublicMenu } from "@/lib/menu/data";
import { isValidSlug } from "@/lib/slug";
import { MenuApp } from "./menu-app";
import { MesaTag } from "./mesa-tag";
import "@/styles/font-themes.css";
import "./menu.css";
import "./order/order.css";
import "./order/special.css";
import "./comunidade/comunidade.css";

export const viewport: Viewport = {
  themeColor: "#0b0a09",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export async function generateMetadata({ params }: PageProps<"/[slug]">): Promise<Metadata> {
  const slug = (await params).slug.toLowerCase();
  const menu = isValidSlug(slug) ? await getPublicMenu(slug) : null;
  if (!menu) return { title: "Cardápio não encontrado" };
  return { title: menu.restaurant.name, description: `Cardápio de ${menu.restaurant.name}` };
}

export default function MenuPage({ params, searchParams }: PageProps<"/[slug]">) {
  return (
    <Suspense fallback={<div className="cm-loading" aria-busy="true" />}>
      <Menu params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Menu({
  params,
  searchParams,
}: {
  params: PageProps<"/[slug]">["params"];
  searchParams: PageProps<"/[slug]">["searchParams"];
}) {
  const slug = (await params).slug.toLowerCase();
  if (!isValidSlug(slug)) notFound();
  const menu = await getPublicMenu(slug);
  if (!menu) notFound();
  // Abre a conexão com o Mux enquanto a página ainda carrega: o primeiro vídeo começa
  // algumas centenas de ms antes no celular.
  preconnect("https://stream.mux.com");
  return (
    <div className={fontVariables}>
      {/* Mesa do QR: resolvida à parte, para o cardápio aparecer sem esperar por ela. */}
      <MenuApp
        initialMenu={menu}
        tableTag={
          <Suspense fallback={null}>
            <MesaTag slug={slug} search={searchParams} />
          </Suspense>
        }
      />
    </div>
  );
}
