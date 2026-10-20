"use server";

import { updateTag } from "next/cache";
import { forgetTv } from "@/lib/apareca/tv";
import { isMember } from "@/lib/auth";
import * as db from "@/lib/db/nocodb";
import { forgetAgora } from "@/lib/painel/agora-memo";
import { confirmPair } from "@/lib/tv/pair";
import { getTvHead, tvTags } from "@/lib/tv/server";

// Tela TVs: conectar, desconectar e o modo simples. Toda ação confere se quem chamou é membro do
// restaurante e toda busca filtra pelo restaurante, então um id de outra casa nunca é achado.
// Depois de gravar, limpa o cache da TV (cabeça pelo slug e TVs pelo id) na instância que rodou
// a ação; as outras veem em até ~2 min.

type Result = { error?: string };
const FAIL = "Não foi possível salvar. Tente de novo.";
const DENIED = "Entre de novo no painel.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const okId = (id: unknown): id is string => typeof id === "string" && UUID.test(id);

type Rest = { Id: number; id: string; slug: string };

// Restaurante da sessão: membro e a linha dele (slug para a tag).
async function mine(restaurantId: string): Promise<Rest | null> {
  if (!okId(restaurantId)) return null;
  if (!(await isMember(restaurantId))) return null;
  return db.first<Rest>("restaurants", { uid: restaurantId });
}

function refresh(r: Rest) {
  updateTag(tvTags.rid(r.id));
  updateTag(tvTags.slug(r.slug));
  forgetAgora(r.id); // TVs da tela Agora (memo de 5 s desta instância)
}

export async function pairTv(restaurantId: string, code: string, label: string): Promise<Result> {
  const r = await mine(restaurantId);
  if (!r) return { error: DENIED };
  try {
    const res = await confirmPair({ db, getHead: getTvHead }, r.id, code, label);
    if (!res.ok) return { error: res.error };
  } catch {
    return { error: FAIL };
  }
  refresh(r);
  return {};
}

// Modo simples do telão (TV mais antiga): sem animação. A TV pareada lê o valor na conferência
// de estado (a cada 5 min) e aplica sem recarregar.
export async function setTvSimple(restaurantId: string, on: boolean): Promise<Result> {
  const r = await mine(restaurantId);
  if (!r) return { error: DENIED };
  try {
    await db.updateRows("restaurants", [{ Id: r.Id, community_tv_simple: on === true }]);
  } catch {
    return { error: FAIL };
  }
  refresh(r);
  return {};
}

// A TV desconectada recebe 401 na próxima conferência, apaga o segredo e volta ao código.
export async function revokeTv(restaurantId: string, id: string): Promise<Result> {
  const r = okId(id) ? await mine(restaurantId) : null;
  if (!r) return { error: DENIED };
  try {
    const n = await db.update("community_tvs", { uid: id, restaurant_id: r.id }, { revoked: true, pair_code: null });
    if (!n) return { error: FAIL };
    forgetTv(id); // o Apareça na TV desta instância para de reconhecer a TV na hora (as outras, em até 60 s)
  } catch {
    return { error: FAIL };
  }
  refresh(r);
  return {};
}
