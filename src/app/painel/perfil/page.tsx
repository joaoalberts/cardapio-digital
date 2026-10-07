import type { Metadata } from "next";
import { Suspense } from "react";
import { mediaUrl } from "@/lib/menu/media";
import type { OpeningHours } from "@/lib/menu/types";
import { createClient } from "@/lib/supabase/server";
import { translationEnabled } from "@/lib/translate";
import { currentRestaurant } from "../current";
import { PanelShell } from "../shell";
import { ProfileForm } from "./profile-form";
import "../panel.css";
import "../cardapio/cardapio.css";

export const metadata: Metadata = { title: "Editar Perfil" };

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
  const supabase = await createClient();
  const [{ data: auth }, { data: cover }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("media")
      .select("kind, storage_path, poster_path, mux_playback_id, status")
      .eq("restaurant_id", r.id)
      .is("item_id", null)
      .is("category_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const logo = mediaUrl(r.logo_path);
  return (
    <PanelShell restaurant={{ id: r.id, name: r.name, slug: r.slug, logo }} active="/painel/perfil" title="Editar Perfil">
      <ProfileForm
        data={{
          id: r.id,
          name: r.name,
          slug: r.slug,
          email: auth.user?.email ?? "",
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
          showHours: r.show_hours,
          hours: r.opening_hours,
          timezone: r.timezone,
          showPayments: r.show_payments,
          paymentMethods: r.payment_methods ?? [],
          languages: r.languages,
        }}
        canTranslate={translationEnabled()}
        canEdit={isOwner}
      />
    </PanelShell>
  );
}
