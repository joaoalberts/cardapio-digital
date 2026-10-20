"use server";

import { isMember } from "@/lib/auth";
import * as db from "@/lib/db/nocodb";
import { agoraFrom, EMPTY_QUEUE, type AgoraResult } from "@/lib/painel/agora";
import { memoAgora } from "@/lib/painel/agora-memo";
import { listQueue } from "../apareca/actions";

// Leitura do ciclo de 10 s da tela "Agora": fila do Apareça e TVs numa ação só. Confere o membro
// a cada chamada (como o listQueue) e só então usa o memo de 5 s. Sem memo: 2 leituras (restaurants e
// community_tvs) além das do listQueue; sem a liberação do Apareça, o listQueue nem é chamado.

const DENIED = "Entre de novo no painel.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Raw = Record<string, unknown>;

async function readAgora(rid: string): Promise<AgoraResult> {
  const mine = { restaurant_id: rid };
  const [r, tvRows] = await Promise.all([
    db.first<Raw>("restaurants", { uid: rid }),
    db.list<Raw>("community_tvs", mine),
  ]);
  const now = new Date();
  const aparecaAllowed = r?.apareca_allowed === true;
  return agoraFrom({
    // Falha da fila (retrato, contexto) não derruba as TVs: vira queueOk false.
    queue: aparecaAllowed ? await listQueue(rid).catch(() => null) : EMPTY_QUEUE,
    tvRows,
    now,
    aparecaAllowed,
    restaurantId: rid,
  });
}

export async function loadAgora(rid: string): Promise<AgoraResult> {
  if (typeof rid !== "string" || !UUID.test(rid) || !(await isMember(rid))) throw new Error(DENIED);
  return memoAgora(rid, () => readAgora(rid));
}
