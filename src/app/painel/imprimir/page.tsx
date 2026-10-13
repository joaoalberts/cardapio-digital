import type { Metadata } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { getPublicMenu } from "@/lib/menu/data";
import { formatPrice, mediaUrl } from "@/lib/menu/media";
import { tagLabel } from "@/lib/menu/tags";
import * as db from "@/lib/db/nocodb";
import { currentRestaurant } from "../current";
import { PrintNow } from "./print-now";
import "./imprimir.css";

export const metadata: Metadata = { title: "Imprimir" };

// Página para imprimir ou salvar em PDF: o display de mesa com QR Code ou o cardápio.
export default function ImprimirPage({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  return (
    <Suspense fallback={null}>
      <Imprimir searchParams={searchParams} />
    </Suspense>
  );
}

async function Imprimir({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  const { tipo } = await searchParams;
  const { restaurant } = await currentRestaurant("logo_path, brand_color");
  const r = restaurant as typeof restaurant & { logo_path: string | null; brand_color: string | null };
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const link = `${proto}://${host}/${r.slug}`;
  const logo = mediaUrl(r.logo_path);
  const accent = r.brand_color ?? "#b8862f";

  if (tipo === "mesas") {
    const data = await db.list<{ label: string; code: string }>("dining_tables", { restaurant_id: r.id });
    // Um QR por mesa, com o código dela: o cardápio abre com o nome da mesa.
    const mesas = await Promise.all(
      (data ?? []).map(async (t) => ({
        label: t.label,
        svg: await QRCode.toString(`${link}?mesa=${t.code}`, { type: "svg", margin: 0, errorCorrectionLevel: "M" }),
      })),
    );
    if (!mesas.length) {
      return (
        <div className="pr-sheet menu">
          <p className="pr-empty">Ainda não há mesas. Crie as mesas em Mesas, no painel, e volte aqui para imprimir.</p>
        </div>
      );
    }
    // Quatro mesas por folha A4, como os displays.
    const folhas = Array.from({ length: Math.ceil(mesas.length / 4) }, (_, s) => mesas.slice(s * 4, s * 4 + 4));
    return (
      <>
        <PrintNow label="Imprimir QR das mesas" />
        {folhas.map((folha, s) => (
          <div key={s} className="pr-sheet mesa" style={{ "--accent": accent } as React.CSSProperties}>
            {folha.map((m, k) => (
              <section key={k} className="pr-card">
                {/* eslint-disable-next-line @next/next/no-img-element -- logo enviada pelo restaurante */}
                {logo ? <img className="pr-logo" src={logo} alt="" /> : <b className="pr-name">{r.name}</b>}
                <p className="pr-table">{m.label}</p>
                <div className="pr-qr" dangerouslySetInnerHTML={{ __html: m.svg }} />
                <p className="pr-call">Aponte a câmera do celular</p>
                <p className="pr-link">{link.replace(/^https?:\/\//, "")}</p>
              </section>
            ))}
          </div>
        ))}
      </>
    );
  }

  if (tipo !== "cardapio") {
    const qr = await QRCode.toString(link, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
    // Quatro displays por folha A4: é só recortar e colocar nas mesas.
    return (
      <div className="pr-sheet mesa" style={{ "--accent": accent } as React.CSSProperties}>
        <PrintNow label="Imprimir displays" />
        {[0, 1, 2, 3].map((k) => (
          <section key={k} className="pr-card">
            {/* eslint-disable-next-line @next/next/no-img-element -- logo enviada pelo restaurante */}
            {logo ? <img className="pr-logo" src={logo} alt="" /> : <b className="pr-name">{r.name}</b>}
            <p className="pr-kicker">Cardápio digital</p>
            <div className="pr-qr" dangerouslySetInnerHTML={{ __html: qr }} />
            <p className="pr-call">Aponte a câmera do celular</p>
            <p className="pr-link">{link.replace(/^https?:\/\//, "")}</p>
          </section>
        ))}
      </div>
    );
  }

  const menu = await getPublicMenu(r.slug);
  return (
    <div className="pr-sheet menu" style={{ "--accent": accent } as React.CSSProperties}>
      <PrintNow label="Salvar em PDF" auto />
      <header className="pr-head">
        {/* eslint-disable-next-line @next/next/no-img-element -- logo enviada pelo restaurante */}
        {logo && <img className="pr-logo" src={logo} alt="" />}
        <h1>{r.name}</h1>
      </header>
      {(menu?.categories ?? []).map((c) => (
        <section key={c.id} className="pr-cat">
          <h2>{c.name}</h2>
          {c.description && <p className="pr-obs">{c.description}</p>}
          {c.items.map((i) => (
            <div key={i.id} className="pr-item">
              <div>
                <b>{i.name}</b>
                {i.description && <p>{i.description}</p>}
                {!!i.tags?.length && <small>{i.tags.map((t) => tagLabel(t)).join(" · ")}</small>}
              </div>
              {!i.hide_price && (
                <span className="pr-price">
                  {i.price_options?.length
                    ? i.price_options.map((o) => `${o.label} ${formatPrice(o.price_cents, "pt-BR")}`).join(" · ")
                    : formatPrice(i.promo_price_cents ?? i.price_cents, "pt-BR")}
                </span>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
