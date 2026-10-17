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
import { Abas } from "./abas";
import { loadReport } from "./actions";
import { ConfigEditor } from "./config-editor";
import { Institucionais, type HouseItem } from "./institucionais";
import { Relatorios } from "./relatorios";
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

// A ordem segue o uso: os vídeos da casa de vez em quando, os ajustes quase nunca e os números quando o
// dono quer olhar. A Fila foi para a tela Agora; as zonas e as TVs, para a tela TVs.
const ABAS = [
  { id: "casa", label: "Vídeos da casa" },
  { id: "ajustes", label: "Ajustes" },
  { id: "numeros", label: "Números" },
];

type Raw = Record<string, unknown>;

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
  const r = restaurant as typeof restaurant & { logo_path: string | null } & Raw;
  const mine = { restaurant_id: r.id };
  const [report, houseRows, user] = await Promise.all([
    loadReport(r.id, 7).catch(() => null),
    db.list<HouseVideoRow>("apareca_house_videos", mine).catch(() => [] as HouseVideoRow[]),
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

  return (
    <PanelShell restaurant={{ id: r.id, name: r.name, slug: r.slug, logo: mediaUrl(r.logo_path) }} active="/painel/apareca" title="Apareça na TV" lead="Aqui ficam os ajustes do Apareça. No dia a dia, use a tela Agora.">
      <Abas
        abas={ABAS}
        note={
          <>
            <p className="app-moved">
              Os vídeos para aprovar ficam em <Link href="/painel/agora">Agora</Link>
            </p>
            <p className="app-moved">
              As TVs ficam em <Link href="/painel/tvs">Mais › TVs</Link>
            </p>
          </>
        }
      >
        <div className="app-setup">
          <Institucionais rid={r.id} items={house} muxOn={muxEnabled()} />
        </div>
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
        </div>
        <div className="app-setup">
          <Relatorios rid={r.id} initial={report} />
          {superAdmin && (
            <p className="app-adm-link">
              <Link href="/painel/apareca/admin">Liberação por restaurante</Link>
            </p>
          )}
        </div>
      </Abas>
    </PanelShell>
  );
}
