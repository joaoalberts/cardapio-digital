"use server";

import { isMember } from "@/lib/auth";
import * as db from "@/lib/db/nocodb";
import { communityOff } from "@/lib/comunidade/off";
import { toContent } from "@/lib/comunidade/votes";
import { agoraFrom, EMPTY_QUEUE, type AgoraResult } from "@/lib/painel/agora";
import { memoAgora } from "@/lib/painel/agora-memo";
import { listQueue } from "../apareca/actions";

// Leitura do ciclo de 10 s da tela "Agora": fila do Apareça, enquete no ar e TVs numa ação só. Confere o membro
// a cada chamada (como o listQueue) e só então usa o memo de 5 s. Sem memo: 3 leituras (restaurants,
// community_polls e community_tvs) além das do listQueue; sem a liberação do Apareça, o listQueue nem é chamado.
// Não lê placar, metas nem votos: o placar lê 5.000 linhas e não cabe num ciclo de 10 s.

const DENIED = "Entre de novo no painel.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// A casa agenda só para o dia; as 50 mais novas sempre trazem a que está no ar.
const POLLS_READ = 50;
type Raw = Record<string, unknown>;

async function readAgora(rid: string): Promise<AgoraResult> {
  const mine = { restaurant_id: rid };
  const [r, polls, tvRows] = await Promise.all([
    db.first<Raw>("restaurants", { uid: rid }),
    db.list<Raw>("community_polls", mine, { sort: "-Id", limit: POLLS_READ }),
    db.list<Raw>("community_tvs", mine),
  ]);
  const now = new Date();
  const aparecaAllowed = r?.apareca_allowed === true;
  return agoraFrom({
    // Falha da fila (retrato, contexto) não derruba a enquete nem as TVs: vira queueOk false.
    queue: aparecaAllowed ? await listQueue(rid).catch(() => null) : EMPTY_QUEUE,
    pollRows: toContent({ polls, posts: [], tvs: [] }, now).polls,
    tvRows,
    now,
    communityOn: r?.community_enabled === true && !communityOff(),
    aparecaAllowed,
    restaurantId: rid,
  });
}

export async function loadAgora(rid: string): Promise<AgoraResult> {
  if (typeof rid !== "string" || !UUID.test(rid) || !(await isMember(rid))) throw new Error(DENIED);
  return memoAgora(rid, () => readAgora(rid));
}
