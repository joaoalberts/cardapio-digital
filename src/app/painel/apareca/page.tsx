import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import * as db from "@/lib/db/nocodb";
import { currentUser } from "@/lib/auth";
import { parseConfig } from "@/lib/apareca/config";
import { frameUrl } from "@/lib/apareca/mux-video";
import { aparecaOff } from "@/lib/apareca/off";
import { allowedModes, HOUSE_MAX_S } from "@/lib/apareca/panel-logic";
import { isSuperAdminUser } from "@/lib/apareca/superadmin";
import type { HouseVideoRow } from "@/lib/apareca/types";
import { mediaUrl } from "@/lib/menu/media";
import { muxEnabled } from "@/lib/mux";
import { currentRestaurant } from "../current";
import { PanelShell } from "../shell";
import { listQueue, loadReport, type QueueResult } from "./actions";
import { ConfigEditor } from "./config-editor";
import { Fila } from "./fila";
import { Institucionais, type HouseItem } from "./institucionais";
import { Relatorios } from "./relatorios";
import { Zonas } from "./zonas";
import "../panel.css";
import "./apareca.css";

export const metadata: Metadata = { title: "Apareça na TV" };

export default function AparecaPage() {
  return (
    <div className="ap">
      <Suspense fallback={<div className="ap-loading" />}>
        <Apareca />
      </Suspense>
    </div>
  );
}

const EMPTY: QueueResult = { items: [], newest: null, warn: "ok" };
type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function toHouseItem(h: HouseVideoRow): HouseItem {
  const ms = typeof h.duration_ms === "number" && h.duration_ms > 0 ? h.duration_ms : null;
  return {
    id: h.id,
    title: h.title || "Sem título",
    status: h.status === "ready" || h.status === "failed" ? h.status : "processing",
    active: h.active === true,
    duration_s: ms ? Math.round(ms / 1000) : null,
    poster: h.status === "ready" && h.mux_playback_id ? frameUrl(h.mux_playback_id, 1) : null,
    too_long: h.status === "failed" && ms !== null && ms > HOUSE_MAX_S * 1000,
  };
}

async function Apareca() {
  const { restaurant, isOwner } = await currentRestaurant();
  const r = restaurant as typeof restaurant & { logo_path: string | null; community_enabled?: unknown } & Raw;
  const mine = { restaurant_id: r.id };
  const [initial, report, houseRows, tableRows, tvRows, user] = await Promise.all([
    listQueue(r.id).catch(() => null),
    loadReport(r.id, 7).catch(() => null),
    db.list<HouseVideoRow>("apareca_house_videos", mine).catch(() => [] as HouseVideoRow[]),
    db.list<Raw>("dining_tables", mine).catch(() => [] as Raw[]),
    db.list<Raw>("community_tvs", mine).catch(() => [] as Raw[]),
    currentUser().catch(() => null),
  ]);
  // Link discreto para a liberação por restaurante: só o super admin (conferido no servidor) vê.
  const superAdmin = isSuperAdminUser(user);
  const cfg = parseConfig(r.apareca_config);
  const allowed = r.apareca_allowed === true;
  const modes = allowedModes({ ai_allowed: r.apareca_ai_allowed === true }, Boolean(process.env.ANTHROPIC_API_KEY) && !aparecaOff());
  const house = houseRows
    .filter((h) => h.restaurant_id === r.id)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.Id - b.Id)
    .map(toHouseItem);
  const tables = tableRows
    .flatMap((t) => (typeof t.id === "string" && t.restaurant_id === r.id ? [{ id: t.id, label: str(t.label) ?? "Sem nome" }] : []))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { numeric: true }));
  // Só as TVs pareadas e não desconectadas, com o nome dado na Comunidade.
  const tvs = tvRows.flatMap((t) =>
    typeof t.id === "string" && t.restaurant_id === r.id && str(t.paired_at) && t.revoked !== true
      ? [{ id: t.id, label: str(t.label) ?? "TV sem nome" }]
      : [],
  );

  return (
    <PanelShell restaurant={{ id: r.id, name: r.name, slug: r.slug, logo: mediaUrl(r.logo_path) }} active="/painel/apareca" title="Apareça na TV">
      <Fila rid={r.id} initial={initial ?? EMPTY} initialOk={initial !== null} communityOn={r.community_enabled === true} />
      <div className="app-setup">
        <ConfigEditor
          rid={r.id}
          isOwner={isOwner}
          allowed={allowed}
          enabled={r.apareca_enabled === true}
          modes={modes}
          cfg={{
            mode: cfg.mode, clients_max: cfg.rule.clients_max, plays: cfg.plays, device_per_hour: cfg.device_per_hour,
            hours: cfg.hours, retention_h: cfg.retention_h,
          }}
        />
        <Institucionais rid={r.id} items={house} muxOn={muxEnabled()} />
        <Zonas rid={r.id} zones={cfg.zones} tableZones={cfg.table_zones} tvZones={cfg.tv_zones} tables={tables} tvs={tvs} />
        <Relatorios rid={r.id} initial={report} />
        {superAdmin && (
          <p className="app-adm-link">
            <Link href="/painel/apareca/admin">Liberação por restaurante</Link>
          </p>
        )}
      </div>
    </PanelShell>
  );
}
