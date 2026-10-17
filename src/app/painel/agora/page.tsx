import type { Metadata } from "next";
import { Suspense } from "react";
import * as db from "@/lib/db/nocodb";
import { aparecaOff } from "@/lib/apareca/off";
import { getHouseVideos } from "@/lib/apareca/store";
import { communityOff } from "@/lib/comunidade/off";
import { mediaUrl } from "@/lib/menu/media";
import { EMPTY_QUEUE, type AgoraResult } from "@/lib/painel/agora";
import { setupDone, setupSteps } from "@/lib/painel/setup-steps";
import { loadMakerData } from "../comunidade/load";
import { currentRestaurant } from "../current";
import { PanelShell } from "../shell";
import { loadAgora } from "./actions";
import { AgoraLive } from "./agora-live";
import { SetupCard } from "./setup-card";
import "../panel.css";
import "../cardapio/cardapio.css";
import "../comunidade/comunidade.css";
import "../apareca/apareca.css";
import "./agora.css";

export const metadata: Metadata = { title: "Agora" };

// Tela "Agora", a da noite, no celular da equipe. Lê uma vez: o restaurante, o loadAgora (fila + enquete + TVs,
// o mesmo que o ciclo de 10 s), os pratos (para Nova enquete e Foto de prato) e as contagens da lista Montar
// a casa. A lista não entra no ciclo de 10 s: terminado um passo, a tela recarrega ao voltar.

export default function AgoraPage() {
  return (
    <div className="ap">
      <Suspense fallback={<div className="ap-loading" />}>
        <Agora />
      </Suspense>
    </div>
  );
}

type Raw = Record<string, unknown>;

async function Agora() {
  const { restaurant, isOwner } = await currentRestaurant();
  const r = restaurant as typeof restaurant & { logo_path: string | null } & Raw;
  const allowed = r.apareca_allowed === true;
  const [agora, maker, tables, house] = await Promise.all([
    loadAgora(r.id).catch(() => null),
    loadMakerData(r),
    db.count("dining_tables", { restaurant_id: r.id }).catch(() => 0),
    // Do cache do Apareça (60 s), e só para quem foi liberado: os passos dele nem aparecem sem a liberação.
    allowed ? getHouseVideos(r.id).catch(() => []) : Promise.resolve([]),
  ]);
  // Sem a leitura (erro ou rede), a tela abre vazia e o ciclo de 10 s tenta de novo.
  const initial: AgoraResult = agora ?? {
    queue: EMPTY_QUEUE, queueOk: true, poll: null, tvs: [], communityOn: r.community_enabled === true && !communityOff(), aparecaAllowed: allowed,
  };

  const steps = setupSteps({
    // Decisão do controlador (17/10): itens = os pratos que o cardápio público mostra (sem os especiais).
    items: maker.categories.reduce((n, c) => n + c.items.length, 0),
    tables,
    communityOn: r.community_enabled === true,
    tvs: initial.tvs.length,
    houseReady: house.filter((h) => h.restaurant_id === r.id && h.status === "ready" && h.active === true).length,
    aparecaAllowed: allowed,
    aparecaOn: r.apareca_enabled === true,
    isOwner,
  });

  return (
    <PanelShell restaurant={{ id: r.id, name: r.name, slug: r.slug, logo: mediaUrl(r.logo_path), aparecaAllowed: r.apareca_allowed === true }} active="/painel/agora" title="Agora" lead="O que precisa de você neste momento.">
      <AgoraLive
        rid={r.id}
        isOwner={isOwner}
        initial={initial}
        initialOk={agora !== null && agora.queueOk}
        aparecaOff={aparecaOff()}
        maker={maker}
        setup={setupDone(steps) ? null : <SetupCard rid={r.id} steps={steps} />}
      />
    </PanelShell>
  );
}
