import type { Metadata } from "next";
import { Suspense } from "react";
import { fontVariables } from "@/lib/menu/fonts";
import { mediaUrl } from "@/lib/menu/media";
import type { OpeningHours } from "@/lib/menu/types";
import { currentRestaurant } from "../current";
import { PanelNav } from "../panel-nav";
import { translationEnabled } from "@/lib/translate";
import { ProfileForm } from "./profile-form";
import "../panel.css";

export const metadata: Metadata = { title: "Perfil do restaurante" };

export default function PerfilPage() {
  return (
    <div className={`ap ${fontVariables}`}>
      <Suspense fallback={<div className="ap-loading" />}>
        <Perfil />
      </Suspense>
    </div>
  );
}

async function Perfil() {
  const { restaurant, isOwner } = await currentRestaurant("logo_path, opening_hours, timezone, languages");
  const r = restaurant as typeof restaurant & {
    logo_path: string | null;
    opening_hours: OpeningHours | null;
    timezone: string;
    languages: string[];
  };
  const logo = mediaUrl(r.logo_path);
  return (
    <div className="ap-app">
      <PanelNav name={r.name} slug={r.slug} logo={logo} active="/painel/perfil" />
      <main>
        <div className="ap-crumb">Perfil do restaurante</div>
        <h1>Logo, horário e idiomas</h1>
        <p className="ap-lead">
          A logo aparece num círculo no topo do cardápio e não muda com a fonte. O horário vira o
          selo “Aberto | até 23h” logo abaixo dela.
        </p>
        <ProfileForm
          restaurantId={r.id}
          name={r.name}
          logo={logo}
          hours={r.opening_hours}
          timezone={r.timezone}
          languages={r.languages}
          canTranslate={translationEnabled()}
          canEdit={isOwner}
        />
      </main>
    </div>
  );
}
