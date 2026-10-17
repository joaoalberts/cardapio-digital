import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import * as db from "@/lib/db/nocodb";
import { parseConfig } from "@/lib/apareca/config";
import { communityOff } from "@/lib/comunidade/off";
import { mediaUrl } from "@/lib/menu/media";
import { tvStatus } from "@/lib/painel/tv-status";
import { currentRestaurant } from "../current";
import { PanelShell } from "../shell";
import { TvsEditor, type TvsData } from "./tvs-editor";
import "../panel.css";
import "../comunidade/comunidade.css";
import "../apareca/apareca.css";
import "./tvs.css";

export const metadata: Metadata = { title: "TVs" };

// Tela TVs: junta o que ficava em Comunidade › Telão (conectar, desconectar, modo simples) com a zona de
// cada TV e o editor de zonas do Apareça. Lê só o que as duas telas já liam: community_tvs, dining_tables
// e a linha do restaurante (apareca_config e community_tv_simple).

export default function TvsPage() {
  return (
    <div className="ap">
      <Suspense fallback={<div className="ap-loading" />}>
        <Tvs />
      </Suspense>
    </div>
  );
}

type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
// O NocoDB devolve "AAAA-MM-DD HH:MM:SS+00:00"; o T no lugar do espaço vale em qualquer motor.
const at = (v: unknown) => {
  const t = typeof v === "string" && v.trim() ? Date.parse(v.trim().replace(" ", "T")) : NaN;
  return Number.isFinite(t) ? t : null;
};

async function Tvs() {
  const { restaurant } = await currentRestaurant();
  const r = restaurant as typeof restaurant & { logo_path: string | null } & Raw;
  const mine = { restaurant_id: r.id };
  const [tvRows, tableRows, h] = await Promise.all([
    db.list<Raw>("community_tvs", mine).catch(() => [] as Raw[]),
    db.list<Raw>("dining_tables", mine).catch(() => [] as Raw[]),
    headers(),
  ]);
  const now = new Date();
  const cfg = parseConfig(r.apareca_config);
  // Zonas só valem para o Apareça: sem a liberação do João, o seletor e o editor somem.
  const aparecaOn = r.apareca_allowed === true;

  // TVs conectadas e não desconectadas, da mais nova para a mais antiga. O hash do segredo nunca sai daqui.
  const tvs: TvsData["tvs"] = tvRows
    .flatMap((t) => {
      const id = str(t.id);
      const paired = at(t.paired_at);
      if (!id || t.restaurant_id !== r.id || paired === null || t.revoked === true) return [];
      const zone = cfg.tv_zones[id];
      return [{ id, label: str(t.label) ?? "TV", paired, status: tvStatus(str(t.last_seen_at), now), zone: zone ?? null }];
    })
    .sort((a, b) => b.paired - a.paired)
    .map(({ id, label, status, zone }) => ({ id, label, status, zone }));
  const tables = tableRows
    .flatMap((t) => (typeof t.id === "string" && t.restaurant_id === r.id ? [{ id: t.id, label: str(t.label) ?? "Sem nome" }] : []))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { numeric: true }));

  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const data: TvsData = {
    restaurantId: r.id,
    off: communityOff(),
    tvUrl: host ? `${proto}://${host}/${r.slug}/telao` : `/${r.slug}/telao`,
    tvSimple: r.community_tv_simple === true,
    tvs,
    aparecaOn,
    zones: cfg.zones,
    tableZones: cfg.table_zones,
    tables,
  };

  return (
    <PanelShell restaurant={{ id: r.id, name: r.name, slug: r.slug, logo: mediaUrl(r.logo_path) }} active="/painel/tvs" title="TVs">
      <TvsEditor data={data} />
    </PanelShell>
  );
}
