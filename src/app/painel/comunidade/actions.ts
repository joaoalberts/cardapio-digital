"use server";

import { updateTag } from "next/cache";
import { isMember, isOwner } from "@/lib/auth";
import * as db from "@/lib/db/nocodb";
import { pollPhase } from "@/lib/comunidade/clock";
import { communityTags, getCommunityHead } from "@/lib/comunidade/server";
import { confirmPair } from "@/lib/comunidade/tv";
import type { PollRow } from "@/lib/comunidade/types";
import { toContent } from "@/lib/comunidade/votes";
import { getPublicMenu } from "@/lib/menu/data";
import { ownsFile, removeFiles } from "@/lib/storage";
import { inCommunityFolder, pollOverlap, validatePoll, type PollInput } from "./validate";

// Painel "Comunidade": interruptor, hora do dia, enquetes, fotos da casa e telão.
// Toda ação confere se quem chamou é membro do restaurante (o interruptor, se é o dono) e
// toda busca filtra pelo restaurante, então um id de outra casa nunca é achado. Depois de
// gravar, limpa o cache da Comunidade (cabeça pelo slug e conteúdo pelo id) na instância
// que rodou a ação; as outras veem em até ~60 s + o cache da CDN.

type Result = { error?: string };
const FAIL = "Não foi possível salvar. Tente de novo.";
const DENIED = "Entre de novo no painel.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const okId = (id: unknown): id is string => typeof id === "string" && UUID.test(id);

type Rest = { Id: number; id: string; slug: string; timezone: string | null };

// Restaurante da sessão: membro (ou dono) e a linha dele (slug para a tag, fuso para a hora).
async function mine(restaurantId: string, owner = false): Promise<Rest | null> {
  if (!okId(restaurantId)) return null;
  if (!(await (owner ? isOwner(restaurantId) : isMember(restaurantId)))) return null;
  return db.first<Rest>("restaurants", { uid: restaurantId });
}

function refresh(r: Rest) {
  updateTag(communityTags.rid(r.id));
  updateTag(communityTags.slug(r.slug));
}

// Pratos que estão no cardápio agora (sem os produtos especiais, que ficam escondidos).
async function menuItemIds(slug: string): Promise<Set<string>> {
  const menu = await getPublicMenu(slug);
  return new Set(menu?.categories.flatMap((c) => c.items.filter((i) => !i.special).map((i) => i.id)) ?? []);
}

// ---------- Interruptor e hora do dia ----------

export async function setCommunityEnabled(restaurantId: string, on: boolean): Promise<Result> {
  const r = await mine(restaurantId, true);
  if (!r) return { error: "Só o dono liga ou desliga a Comunidade." };
  try {
    await db.updateRows("restaurants", [{ Id: r.Id, community_enabled: on === true }]);
  } catch {
    return { error: FAIL };
  }
  refresh(r);
  return {};
}

export async function setDayStart(restaurantId: string, hhmm: string): Promise<Result> {
  if (typeof hhmm !== "string" || !HHMM.test(hhmm)) return { error: "Confira a hora (ex.: 05:00)." };
  const r = await mine(restaurantId);
  if (!r) return { error: DENIED };
  try {
    await db.updateRows("restaurants", [{ Id: r.Id, community_day_start: hhmm }]);
  } catch {
    return { error: FAIL };
  }
  refresh(r);
  return {};
}

// ---------- Enquetes ----------

async function pollOf(r: Rest, id: string): Promise<PollRow | null> {
  const row = await db.first<Record<string, unknown>>("community_polls", { uid: id, restaurant_id: r.id });
  return row ? (toContent({ polls: [row], posts: [], tvs: [] }, new Date(0)).polls[0] ?? null) : null;
}

export async function createPoll(restaurantId: string, input: PollInput): Promise<Result & { id?: string }> {
  const r = await mine(restaurantId);
  if (!r) return { error: DENIED };
  try {
    const now = new Date();
    const v = validatePoll(input, await menuItemIds(r.slug), now, r.timezone || "America/Sao_Paulo");
    if (!v.ok) return { error: v.error };
    const rows = await db.list<Record<string, unknown>>("community_polls", { restaurant_id: r.id }, { sort: "-Id", limit: 200 });
    if (pollOverlap(v.row, toContent({ polls: rows, posts: [], tvs: [] }, now).polls, now)) {
      return { error: "Já tem uma enquete nesse horário. Encerre ou apague a outra, ou escolha outra hora." };
    }
    const row = await db.insertOne("community_polls", { ...v.row, restaurant_id: r.id, closed_at: null });
    refresh(r);
    return { id: row.id };
  } catch {
    return { error: FAIL };
  }
}

// Encerra agora uma enquete aberta (fica 15 min no Palco e no telão com a vencedora).
export async function closePoll(restaurantId: string, id: string): Promise<Result> {
  const r = okId(id) ? await mine(restaurantId) : null;
  if (!r) return { error: DENIED };
  try {
    const p = await pollOf(r, id);
    if (!p || pollPhase(p, new Date()) !== "open") return { error: "Essa enquete não está no ar." };
    await db.update("community_polls", { uid: id, restaurant_id: r.id }, { closed_at: new Date().toISOString() });
  } catch {
    return { error: FAIL };
  }
  refresh(r);
  return {};
}

// Só antes de abrir: uma enquete que já recebeu voto não some.
export async function deletePoll(restaurantId: string, id: string): Promise<Result> {
  const r = okId(id) ? await mine(restaurantId) : null;
  if (!r) return { error: DENIED };
  try {
    const p = await pollOf(r, id);
    if (!p || pollPhase(p, new Date()) !== "scheduled") return { error: "Só dá para apagar uma enquete que ainda não começou." };
    await db.remove("community_polls", { uid: id, restaurant_id: r.id });
  } catch {
    return { error: FAIL };
  }
  refresh(r);
  return {};
}

// ---------- Fotos da casa ----------

export async function addHousePost(
  restaurantId: string,
  input: { item_id: string; photo_url: string; thumb_url: string; on_tv: boolean },
): Promise<Result & { id?: string }> {
  const r = await mine(restaurantId);
  if (!r) return { error: DENIED };
  const file = (u: unknown): u is string => typeof u === "string" && ownsFile(r.id, u) && inCommunityFolder(r.id, u);
  if (!input || !file(input.photo_url) || !file(input.thumb_url)) return { error: "Arquivo inválido." };
  try {
    if (!okId(input.item_id) || !(await menuItemIds(r.slug)).has(input.item_id)) return { error: "Escolha um prato que está no cardápio." };
    const row = await db.insertOne("community_posts", {
      restaurant_id: r.id,
      item_id: input.item_id,
      photo_path: input.photo_url,
      thumb_path: input.thumb_url,
      source: "house",
      status: "approved",
      on_tv: input.on_tv === true,
      hidden_at: null,
    });
    refresh(r);
    return { id: row.id };
  } catch {
    return { error: FAIL };
  }
}

export async function setPostTv(restaurantId: string, id: string, on: boolean): Promise<Result> {
  const r = okId(id) ? await mine(restaurantId) : null;
  if (!r) return { error: DENIED };
  try {
    const n = await db.update("community_posts", { uid: id, restaurant_id: r.id, status: "approved" }, { on_tv: on === true });
    if (!n) return { error: FAIL };
  } catch {
    return { error: FAIL };
  }
  refresh(r);
  return {};
}

// Some do Mural e do telão na hora nesta instância; nas outras, em até ~70 s.
export async function hidePost(restaurantId: string, id: string): Promise<Result> {
  const r = okId(id) ? await mine(restaurantId) : null;
  if (!r) return { error: DENIED };
  try {
    const n = await db.update(
      "community_posts",
      { uid: id, restaurant_id: r.id },
      { status: "hidden", hidden_at: new Date().toISOString(), on_tv: false },
    );
    if (!n) return { error: FAIL };
  } catch {
    return { error: FAIL };
  }
  refresh(r);
  return {};
}

// Apaga a linha e depois os arquivos (foto e miniatura). Se o arquivo falhar, sobra só um
// arquivo órfão; a foto já não aparece em lugar nenhum.
export async function deletePost(restaurantId: string, id: string): Promise<Result> {
  const r = okId(id) ? await mine(restaurantId) : null;
  if (!r) return { error: DENIED };
  try {
    const p = await db.first<{ photo_path: string | null; thumb_path: string | null }>("community_posts", { uid: id, restaurant_id: r.id });
    if (!p) return { error: FAIL };
    await db.remove("community_posts", { uid: id, restaurant_id: r.id });
    refresh(r);
    await removeFiles([p.photo_path, p.thumb_path].filter((u): u is string => typeof u === "string" && ownsFile(r.id, u)));
  } catch {
    return { error: "Não foi possível apagar a foto." };
  }
  return {};
}

// ---------- Telão ----------

export async function pairTv(restaurantId: string, code: string, label: string): Promise<Result> {
  const r = await mine(restaurantId);
  if (!r) return { error: DENIED };
  try {
    const res = await confirmPair({ db, getHead: getCommunityHead }, r.id, code, label);
    if (!res.ok) return { error: res.error };
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
  } catch {
    return { error: FAIL };
  }
  refresh(r);
  return {};
}
