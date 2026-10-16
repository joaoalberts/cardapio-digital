"use server";

import { after } from "next/server";
import { isMember } from "@/lib/auth";
import * as db from "@/lib/db/nocodb";
import { estimateUsd, tetoUsd, uploadGate } from "@/lib/apareca/cost";
import { deleteMuxAsset, frameUrl, hlsUrl } from "@/lib/apareca/mux-video";
import { newestOf, queueItems, teamDecide, type QueueItem, type TeamAction } from "@/lib/apareca/panel-logic";
import { forgetSnapshot, monthUsage, readAparecaHeadFresh, readSnapshot, type StoreDeps } from "@/lib/apareca/store";
import type { Zone } from "@/lib/apareca/types";

// Painel "Apareça na TV": fila de moderação. Toda ação confere se quem chamou é membro do
// restaurante e toda busca filtra pelo restaurante, então um id de outra casa nunca é achado.
// A fila vem do retrato em memória (store.ts, 5 s); depois de cada decisão, o retrato desta
// instância é esquecido (forgetSnapshot). As outras instâncias veem em até 5 s.

type Result = { error?: string };
export type QueueResult = { items: QueueItem[]; newest: string | null; warn: "ok" | "warn" | "paused" };

const DENIED = "Entre de novo no painel.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const okId = (id: unknown): id is string => typeof id === "string" && UUID.test(id);
const CONTEXT_MS = 60_000; // nomes de mesa e zonas mudam pouco: uma leitura por minuto por instância
const POSTER_S = 1; // capa: o quadro de 1 s do vídeo

const allowed = async (rid: unknown): Promise<boolean> => okId(rid) && (await isMember(rid));
const storeDeps = (): StoreDeps => ({ db, mux: { deleteAsset: deleteMuxAsset }, defer: (fn) => after(fn) });

// Mês do teto no fuso de Brasília, como nas rotas do cliente (submit-server.ts).
const monthOf = (now: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(now);

type Ctx = { tables: Map<string, string>; zones: Zone[] };
const ctxMemo = new Map<string, { at: number; p: Promise<Ctx> }>();

function context(rid: string): Promise<Ctx> {
  const t = Date.now();
  const m = ctxMemo.get(rid);
  if (m && t - m.at < CONTEXT_MS && t >= m.at) return m.p;
  const p = Promise.all([
    db.list<{ id?: unknown; label?: unknown }>("dining_tables", { restaurant_id: rid }),
    readAparecaHeadFresh(rid),
  ]).then(([rows, head]) => ({
    tables: new Map(
      rows.flatMap((r) => (typeof r.id === "string" && typeof r.label === "string" && r.label ? [[r.id, r.label] as const] : [])),
    ),
    zones: head?.config.zones ?? [],
  }));
  const fresh = { at: t, p };
  p.catch(() => {
    if (ctxMemo.get(rid) === fresh) ctxMemo.delete(rid);
  });
  ctxMemo.set(rid, fresh);
  return p;
}

async function gate(): Promise<QueueResult["warn"]> {
  try {
    const usd = estimateUsd(await monthUsage(storeDeps(), monthOf(new Date())));
    return uploadGate(usd, tetoUsd(process.env.APARECA_TETO_USD));
  } catch {
    return "ok"; // sem leitura do uso, sem faixa; o envio do cliente confere o teto de novo
  }
}

export async function listQueue(rid: string): Promise<QueueResult> {
  if (!(await allowed(rid))) throw new Error(DENIED);
  const [snap, ctx, warn] = await Promise.all([readSnapshot(storeDeps(), rid), context(rid), gate()]);
  const items = queueItems(snap.videos, { ...ctx, hls: hlsUrl, poster: (p) => frameUrl(p, POSTER_S) });
  return { items, newest: newestOf(items), warn };
}

async function decide(rid: string, id: string, action: TeamAction): Promise<Result> {
  if (!okId(id) || !(await allowed(rid))) return { error: DENIED };
  try {
    return await teamDecide({ db, deleteAsset: deleteMuxAsset, forget: forgetSnapshot }, rid, id, action);
  } catch {
    return { error: "Não foi possível salvar. Tente de novo." };
  }
}

export async function approveVideo(rid: string, id: string): Promise<Result> {
  return decide(rid, id, "approve");
}

// Apaga o asset no Mux depois de gravar rejected.
export async function rejectVideo(rid: string, id: string): Promise<Result> {
  return decide(rid, id, "reject");
}

// Status removed e apaga o asset: sai da TV na próxima consulta da programação.
export async function removeFromTv(rid: string, id: string): Promise<Result> {
  return decide(rid, id, "remove");
}
