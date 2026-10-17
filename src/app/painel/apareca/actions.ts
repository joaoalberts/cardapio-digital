"use server";

import { updateTag } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";
import { isMember, isOwner } from "@/lib/auth";
import * as db from "@/lib/db/nocodb";
import { parseConfig } from "@/lib/apareca/config";
import { estimateUsd, tetoUsd, uploadGate } from "@/lib/apareca/cost";
import { assetInfo, createAparecaUpload, deleteMuxAsset, frameUrl, hlsUrl, releaseMuxUpload } from "@/lib/apareca/mux-video";
import { aparecaOff } from "@/lib/apareca/off";
import {
  allowedModes, applyConfigPatch, cleanZones, HOUSE_LIST_MAX, HOUSE_TITLE_MAX, houseSyncPlan, newestOf, NOT_ALLOWED, queueItems,
  reorderHouse, teamDecide, type ConfigPatch, type QueueItem, type TeamAction,
} from "@/lib/apareca/panel-logic";
import { aparecaReport, type AparecaReport } from "@/lib/apareca/reports";
import { aparecaTags, forgetSnapshot, monthUsage, readAparecaHeadFresh, readSnapshot, type StoreDeps } from "@/lib/apareca/store";
import type { AparecaConfig, AparecaTallyRow, HouseVideoRow, Zone } from "@/lib/apareca/types";

// Painel "Apareça na TV": fila de moderação, configurações, zonas e institucionais. Toda ação confere se quem chamou é membro do
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
    // Coerente com o envio (submit.ts, isPaused): sem leitura do uso, os envios ficam pausados,
    // então o painel mostra a faixa de pausa (A7).
    return "paused";
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

// ---------- Configurações, zonas e institucionais (T15) ----------
// Toda ação confere isMember (o interruptor, isOwner) e lê a linha do restaurante pelo id da
// sessão; ids de vídeo, mesa e TV só valem se forem do restaurante. Depois de gravar, limpa a
// cabeça (por slug) e os institucionais (por id) do cache do Next nesta instância; as outras
// veem em até 60 s.

const FAIL = "Não foi possível salvar. Tente de novo.";
type Rest = { Id: number; id: string; slug: string; apareca_allowed?: unknown; apareca_ai_allowed?: unknown; apareca_config?: unknown };

async function mine(rid: unknown, owner = false): Promise<Rest | null> {
  if (!okId(rid)) return null;
  if (!(await (owner ? isOwner(rid) : isMember(rid)))) return null;
  const r = await db.first<Rest>("restaurants", { uid: rid });
  return r && r.id === rid ? r : null;
}

function refresh(r: Rest) {
  updateTag(aparecaTags.slug(String(r.slug).toLowerCase()));
  updateTag(aparecaTags.rid(r.id));
}

const hasAiKey = () => Boolean(process.env.ANTHROPIC_API_KEY) && !aparecaOff();

async function writeConfig(r: Rest, cfg: AparecaConfig): Promise<{ error?: string }> {
  try {
    await db.updateRows("restaurants", [{ Id: r.Id, apareca_config: cfg }]);
  } catch {
    return { error: FAIL };
  }
  ctxMemo.delete(r.id); // nomes das zonas da fila
  refresh(r);
  return {};
}

// Só o dono. Ligar exige a liberação do João (apareca_allowed); desligar vale sempre.
export async function setAparecaEnabled(rid: string, on: boolean): Promise<Result> {
  const r = await mine(rid, true);
  if (!r) return { error: "Só o dono liga ou desliga o Apareça na TV." };
  if (on === true && r.apareca_allowed !== true) return { error: NOT_ALLOWED };
  try {
    await db.updateRows("restaurants", [{ Id: r.Id, apareca_enabled: on === true }]);
  } catch {
    return { error: FAIL };
  }
  refresh(r);
  return {};
}

// Modo só entre os de allowedModes; faixas do painel conferidas em applyConfigPatch.
export async function saveConfig(rid: string, patch: Partial<AparecaConfig>): Promise<Result> {
  const r = await mine(rid);
  if (!r) return { error: DENIED };
  const modes = allowedModes({ ai_allowed: r.apareca_ai_allowed === true }, hasAiKey());
  const clean: Record<string, unknown> = { ...(patch ?? {}) };
  delete clean.zones;
  delete clean.table_zones;
  delete clean.tv_zones;
  const out = applyConfigPatch(parseConfig(r.apareca_config), clean as ConfigPatch, modes);
  if ("error" in out) return { error: out.error };
  return writeConfig(r, out.cfg);
}

export async function saveZones(
  rid: string, zones: Zone[], tables: Record<string, string>, tvs: Record<string, string>,
): Promise<Result> {
  const r = await mine(rid);
  if (!r) return { error: DENIED };
  let own: { tables: Set<string>; tvs: Set<string> };
  try {
    const [tRows, tvRows] = await Promise.all([
      db.list<{ id?: unknown; restaurant_id?: unknown }>("dining_tables", { restaurant_id: r.id }),
      db.list<{ id?: unknown; restaurant_id?: unknown }>("community_tvs", { restaurant_id: r.id }),
    ]);
    const ids = (rows: { id?: unknown; restaurant_id?: unknown }[]) =>
      new Set(rows.flatMap((x) => (typeof x.id === "string" && x.restaurant_id === r.id ? [x.id] : [])));
    own = { tables: ids(tRows), tvs: ids(tvRows) };
  } catch {
    return { error: FAIL };
  }
  const z = cleanZones(zones, tables, tvs, own);
  if ("error" in z) return { error: z.error };
  return writeConfig(r, { ...parseConfig(r.apareca_config), ...z });
}

// ---------- Institucionais ----------

async function houseOf(r: Rest, id: unknown): Promise<HouseVideoRow | null> {
  if (!okId(id)) return null;
  const h = await db.first<HouseVideoRow>("apareca_house_videos", { uid: id, restaurant_id: r.id });
  return h && h.restaurant_id === r.id ? h : null;
}

const houseRows = async (r: Rest) =>
  (await db.list<HouseVideoRow>("apareca_house_videos", { restaurant_id: r.id })).filter((h) => h.restaurant_id === r.id);

// Cria a linha (em preparo, ativa, no fim da lista) e devolve a URL de envio direto ao Mux.
// O tamanho (200 MB) é conferido no navegador; a duração (3 min), no syncHouseVideos.
export async function startHouseUpload(rid: string, title: string): Promise<{ error?: string; id?: string; url?: string }> {
  const t = typeof title === "string" ? title.trim().replace(/\s+/g, " ") : "";
  if (!t) return { error: "Dê um título ao vídeo." };
  if (t.length > HOUSE_TITLE_MAX) return { error: `O título pode ter até ${HOUSE_TITLE_MAX} caracteres.` };
  const r = await mine(rid);
  if (!r) return { error: DENIED };
  try {
    const rows = await houseRows(r);
    if (rows.length >= HOUSE_LIST_MAX) return { error: `No máximo ${HOUSE_LIST_MAX} vídeos institucionais. Apague um para enviar outro.` };
    const id = crypto.randomUUID();
    const origin = (await headers()).get("origin") ?? "*";
    const up = await createAparecaUpload(origin, `apareca:${r.id}:casa:${id}`);
    const position = rows.reduce((m, h) => Math.max(m, Number(h.position) || 0), -1) + 1;
    await db.insert("apareca_house_videos", [{
      uid: id, restaurant_id: r.id, title: t, mux_upload_id: up.id, mux_asset_id: null, mux_playback_id: null,
      duration_ms: null, aspect: null, position, active: true, status: "processing",
    }]);
    refresh(r);
    return { id, url: up.url };
  } catch (e) {
    console.error("apareca: envio de institucional", String(e).slice(0, 300));
    return { error: "Não foi possível preparar o envio do vídeo. Tente de novo." };
  }
}

// Confere no Mux os institucionais em preparo; devolve quantos ainda estão em preparo.
export async function syncHouseVideos(rid: string): Promise<{ pending: number }> {
  const r = await mine(rid).catch(() => null);
  if (!r) return { pending: 0 };
  try {
    const plan = await houseSyncPlan({ rows: await houseRows(r), assetInfo, deleteAsset: deleteMuxAsset });
    if (plan.updates.length) {
      await db.updateRows("apareca_house_videos", plan.updates);
      refresh(r);
    }
    return { pending: plan.pending };
  } catch {
    return { pending: 0 };
  }
}

export async function setHouseActive(rid: string, id: string, on: boolean): Promise<Result> {
  const r = await mine(rid);
  if (!r) return { error: DENIED };
  try {
    const h = await houseOf(r, id);
    if (!h) return { error: "Este vídeo não existe mais." };
    await db.updateRows("apareca_house_videos", [{ Id: h.Id, active: on === true }]);
  } catch {
    return { error: FAIL };
  }
  refresh(r);
  return {};
}

export async function moveHouse(rid: string, id: string, dir: -1 | 1): Promise<Result> {
  if (dir !== -1 && dir !== 1) return { error: FAIL };
  const r = await mine(rid);
  if (!r) return { error: DENIED };
  try {
    if (!okId(id)) return { error: "Este vídeo não existe mais." };
    const plan = reorderHouse(await houseRows(r), id, dir);
    if (!plan) return { error: "Este vídeo não existe mais." };
    if (!plan.length) return {};
    await db.updateRows("apareca_house_videos", plan);
  } catch {
    return { error: FAIL };
  }
  refresh(r);
  return {};
}

// Asset no Mux primeiro (ou o envio ainda sem asset), depois a linha. Se o Mux falhar, a linha fica.
export async function deleteHouse(rid: string, id: string): Promise<Result> {
  const r = await mine(rid);
  if (!r) return { error: DENIED };
  try {
    const h = await houseOf(r, id);
    if (!h) return { error: "Este vídeo não existe mais." };
    if (h.mux_asset_id) await deleteMuxAsset(h.mux_asset_id);
    else if (h.mux_upload_id && h.status === "processing") await releaseMuxUpload(h.mux_upload_id);
    await db.removeIds("apareca_house_videos", [h.Id]);
  } catch {
    return { error: "Não foi possível apagar o vídeo. Tente de novo." };
  }
  refresh(r);
  return {};
}

// Relatórios: o que já virou apareca_tally (vídeos apagados) mais os vídeos vivos. Confere o membro e lê só
// as linhas deste restaurante. O dia e a hora seguem o fuso dele.
export type ReportResult = AparecaReport & { range: 7 | 30; timezone: string };
const DEFAULT_TZ = "America/Sao_Paulo";

export async function loadReport(rid: string, days: 7 | 30): Promise<ReportResult> {
  if (!(await allowed(rid))) throw new Error(DENIED);
  const range: 7 | 30 = days === 30 ? 30 : 7;
  const [head, tallies, snap] = await Promise.all([
    readAparecaHeadFresh(rid),
    db.list<AparecaTallyRow>("apareca_tally", { restaurant_id: rid }),
    readSnapshot(storeDeps(), rid),
  ]);
  const timezone = head?.timezone || DEFAULT_TZ;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - (range - 1) * 86_400_000).toISOString().slice(0, 10);
  const report = aparecaReport({
    tallies: tallies.filter((t) => t.restaurant_id === rid),
    live: snap.videos.filter((v) => v.restaurant_id === rid),
    from, to: today, timezone,
  });
  return { ...report, range, timezone };
}
