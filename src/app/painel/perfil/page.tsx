import type { Metadata } from "next";
import { Suspense } from "react";
import { mediaUrl } from "@/lib/menu/media";
import type { OpeningHours } from "@/lib/menu/types";
import { currentUser } from "@/lib/auth";
import * as db from "@/lib/db/nocodb";
import { translationEnabled } from "@/lib/translate";
import { currentRestaurant } from "../current";
import { PanelShell } from "../shell";
import { PasswordForm } from "./password-form";
import { ProfileForm } from "./profile-form";
import "../panel.css";
import "../cardapio/cardapio.css";

export const metadata: Metadata = { title: "Perfil" };

export default function PerfilPage() {
  return (
    <div className="ap">
      <Suspense fallback={<div className="ap-loading" />}>
        <Perfil />
      </Suspense>
    </div>
  );
}

async function Perfil() {
  const { restaurant, isOwner } = await currentRestaurant(
    "logo_path, opening_hours, timezone, languages, phone, address, description, brand_color, instagram, facebook, wifi_name, wifi_password, show_hours, show_payments, payment_methods",
  );
  const r = restaurant as typeof restaurant & {
    logo_path: string | null;
    opening_hours: OpeningHours | null;
    timezone: string;
    languages: string[];
    phone: string | null;
    address: string | null;
    description: string;
    brand_color: string | null;
    instagram: string | null;
    facebook: string | null;
    wifi_name: string | null;
    wifi_password: string | null;
    show_hours: boolean;
    show_payments: boolean;
    payment_methods: string[];
  };
  type Cover = {
    Id: number; item_id: string | null; category_id: string | null; kind: "photo" | "video"; storage_path: string | null;
    poster_path: string | null; mux_playback_id: string | null; status: "processing" | "ready" | "failed";
  };
  const [user, banners] = await Promise.all([
    currentUser(),
    db.list<Cover>("media", { restaurant_id: r.id, item_id: null, category_id: null }, { sort: "-Id", limit: 1 }),
  ]);
  const cover = banners[0];
  const logo = mediaUrl(r.logo_path);
  return (
    <PanelShell restaurant={{ id: r.id, name: r.name, slug: r.slug, logo }} active="/painel/perfil" title="Perfil" lead="Nome, endereço, horário e Instagram da casa.">
      <ProfileForm
        data={{
          id: r.id,
          name: r.name,
          slug: r.slug,
          email: user?.email ?? "",
          logo,
          banner: cover
            ? {
                kind: cover.kind,
                status: cover.status,
                url: (cover.mux_playback_id ? `https://stream.mux.com/${cover.mux_playback_id}.m3u8` : mediaUrl(cover.storage_path)) ?? "",
                thumb:
                  mediaUrl(cover.poster_path ?? cover.storage_path) ??
                  (cover.mux_playback_id ? `https://image.mux.com/${cover.mux_playback_id}/thumbnail.jpg` : ""),
              }
            : null,
          phone: r.phone ?? "",
          address: r.address ?? "",
          description: r.description ?? "",
          brandColor: r.brand_color ?? "#b8862f",
          instagram: r.instagram ?? "",
          facebook: r.facebook ?? "",
          wifiName: r.wifi_name ?? "",
          wifiPassword: r.wifi_password ?? "",
          showHours: !!r.show_hours,
          hours: r.opening_hours,
          timezone: r.timezone || "America/Sao_Paulo",
          showPayments: !!r.show_payments,
          paymentMethods: r.payment_methods ?? [],
          languages: r.languages ?? ["pt-BR"],
        }}
        canTranslate={translationEnabled()}
        canEdit={isOwner}
      />
      <PasswordForm />
    </PanelShell>
  );
}
