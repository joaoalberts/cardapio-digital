import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { fontVariables } from "@/lib/menu/fonts";
import { getPublicMenu } from "@/lib/menu/data";
import { isValidSlug } from "@/lib/slug";
import { MenuApp } from "./menu-app";
import "@/styles/font-themes.css";
import "./menu.css";

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

export default function MenuPage({ params }: PageProps<"/[slug]">) {
  return (
    <Suspense fallback={<div className="cm-loading" aria-busy="true" />}>
      <Menu params={params} />
    </Suspense>
  );
}

async function Menu({ params }: { params: PageProps<"/[slug]">["params"] }) {
  const slug = (await params).slug.toLowerCase();
  if (!isValidSlug(slug)) notFound();
  const menu = await getPublicMenu(slug);
  if (!menu) notFound();
  return (
    <div className={fontVariables}>
      <MenuApp initialMenu={menu} />
    </div>
  );
}
