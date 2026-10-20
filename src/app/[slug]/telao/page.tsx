import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import QRCode from "qrcode";
import { getPublicMenu } from "@/lib/menu/data";
import { DEFAULT_FONT_THEME, isFontTheme } from "@/lib/menu/font-themes";
import { fontVariables } from "@/lib/menu/fonts";
import { mediaUrl, posterSrc, thumbSrc } from "@/lib/menu/media";
import type { PublicMenu } from "@/lib/menu/types";
import { isValidSlug } from "@/lib/slug";
import { QR_ECC, qrLink } from "@/lib/tv/qr";
import { getTvHead } from "@/lib/tv/server";
import { TelaoApp } from "./telao-app";
import "@/styles/font-themes.css";
import "./telao.css";

// Telão: página pública em tela cheia para a TV do salão. O servidor só entrega a casa
// (nome, logo, @, capa, cor), o cardápio enxuto (nomes e fotos dos pratos) e o QR de
// /<slug>. O pareamento fica no cliente: o segredo da TV nasce e mora no localStorage dela.

export const viewport: Viewport = { themeColor: "#100c0a", width: "device-width", initialScale: 1 };

export async function generateMetadata({ params }: PageProps<"/[slug]/telao">): Promise<Metadata> {
  const slug = (await params).slug.toLowerCase();
  const head = isValidSlug(slug) ? await getTvHead(slug) : null;
  return { title: head ? `Telão · ${head.name}` : "Telão", robots: { index: false, follow: false } };
}

export default function TelaoPage({ params }: PageProps<"/[slug]/telao">) {
  return (
    <Suspense fallback={<div className="tl tl-boot" />}>
      <Telao params={params} />
    </Suspense>
  );
}

// Só o que o telão usa: o destaque da casa (featured, descrição, preço, horário da categoria)
// e o nome, o preço e a foto dos pratos. Fica de fora o resto
// do restaurante (Wi-Fi, telefone, endereço, pagamentos) e os produtos especiais.
function tvMenu(menu: PublicMenu): PublicMenu {
  const r = menu.restaurant;
  return {
    restaurant: {
      id: r.id, name: r.name, slug: r.slug, logo_path: r.logo_path, brand_color: r.brand_color, languages: r.languages,
      menu_version: r.menu_version, cover_video_path: null, cover_image_path: null, font_theme: r.font_theme,
      timezone: r.timezone, opening_hours: null, language: r.language, orders_enabled: r.orders_enabled,
    },
    categories: menu.categories.map((c) => ({
      id: c.id,
      name: c.name,
      available_from: c.available_from ?? null,
      available_to: c.available_to ?? null,
      items: c.items.map((i) => ({
        id: i.id, name: i.name, description: i.featured ? i.description : "", price_cents: i.price_cents, promo_price_cents: i.promo_price_cents ?? null,
        hide_price: i.hide_price, featured: i.featured, price_options: i.price_options ?? null, media: i.media.slice(0, 1),
        category_id: i.category_id, half_half: i.half_half, special: i.special ?? null,
      })),
    })),
  };
}

// Capa do cardápio (banner do perfil, capa antiga ou o 1º prato): a foto do pôster quando o
// destaque não tem foto.
function coverOf(menu: PublicMenu): string | null {
  const r = menu.restaurant;
  const b = r.cover;
  if (b) return b.kind === "photo" ? mediaUrl(b.storage_path) : posterSrc(b);
  return mediaUrl(r.cover_image_path) ?? thumbSrc(menu.categories[0]?.items[0]);
}

async function Telao({ params }: { params: PageProps<"/[slug]/telao">["params"] }) {
  await connection();
  const slug = (await params).slug.toLowerCase();
  if (!isValidSlug(slug)) notFound();
  const [head, menu] = await Promise.all([getTvHead(slug), getPublicMenu(slug)]);
  if (!head || !menu) notFound();
  const lang = menu.restaurant.language || "pt-BR";

  // QR absoluto para o celular de quem está no salão: o mesmo host pelo qual a TV abriu.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  const link = qrLink(proto, host, slug);
  const qrSvg = await QRCode.toString(link, { type: "svg", margin: 0, errorCorrectionLevel: QR_ECC, color: { dark: "#1b1714", light: "#0000" } });

  return (
    <div className={fontVariables}>
      <TelaoApp
        slug={slug}
        lang={lang}
        house={{
          name: head.name || menu.restaurant.name,
          instagram: head.instagram,
          logo: mediaUrl(head.logo_path ?? menu.restaurant.logo_path),
          cover: coverOf(menu),
          accent: head.brand_color ?? menu.restaurant.brand_color,
          timezone: head.timezone,
          fontTheme: isFontTheme(menu.restaurant.font_theme) ? menu.restaurant.font_theme : DEFAULT_FONT_THEME,
          ordersEnabled: menu.restaurant.orders_enabled === true,
        }}
        qrSvg={qrSvg}
        qrLink={link}
        menu={tvMenu(menu)}
      />
    </div>
  );
}
