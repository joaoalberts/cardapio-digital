import type { Metadata } from "next";
import { Suspense } from "react";
import { mediaUrl } from "@/lib/menu/media";
import { currentRestaurant } from "../current";
import { PanelShell } from "../shell";
import { SupportForm } from "./support-form";
import "../panel.css";
import "../cardapio/cardapio.css";

export const metadata: Metadata = { title: "Suporte" };

export default function SuportePage() {
  return (
    <div className="ap">
      <Suspense fallback={<div className="ap-loading" />}>
        <Suporte />
      </Suspense>
    </div>
  );
}

async function Suporte() {
  const { restaurant } = await currentRestaurant("logo_path");
  const r = restaurant as typeof restaurant & { logo_path: string | null };
  // Número do suporte (só dígitos, com DDI), configurado na Vercel; sem ele, só o formulário.
  const whatsapp = (process.env.SUPPORT_WHATSAPP ?? "").replace(/\D/g, "") || null;
  return (
    <PanelShell restaurant={{ id: r.id, name: r.name, slug: r.slug, logo: mediaUrl(r.logo_path) }} active="/painel/suporte" title="Suporte">
      <section className="ap-card">
        <div className="ap-card-head">
          <svg className="icon" viewBox="0 0 24 24" aria-hidden>
            <path d="M3 5h18v14H3zM3 6l9 7 9-7" />
          </svg>
          <h2>Contato</h2>
        </div>
        <SupportForm restaurantId={r.id} whatsapp={whatsapp} />
      </section>
    </PanelShell>
  );
}
