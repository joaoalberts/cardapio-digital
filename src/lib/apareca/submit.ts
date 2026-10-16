import "server-only";
import { sharedLimiter, type Limiter } from "@/lib/comunidade/limiter";
import type { PollRow, TvRow } from "@/lib/comunidade/types";
import type * as nocodb from "@/lib/db/nocodb";
import { featureState } from "./config";
import { tetoUsd, uploadGate } from "./cost";
import { onAssetReady } from "./moderation";
import { mp4Url, type AssetInfo, type assetInfo, type createAparecaUpload } from "./mux-video";
import { cleanName } from "./name";
import { estimateWait, pollLeftMs, queuePosition, tvsIn } from "./queue";
import { expiresAt, isExpired, isStuckUpload } from "./retention";
import { forgetSnapshot, readSnapshot, type StoreDb, type StoreDeps } from "./store";
import type { AparecaHead, VideoRow } from "./types";

// Lógica das rotas públicas do cliente (/api/apareca/[slug]/...), sem nada do Next.
// O restaurante sempre vem do slug resolvido aqui; a mesa vem pelo código do QR e vira o uid
// da linha de dining_tables. Nenhuma resposta leva device_id, table_id, zona, ai_reason,
// motivo de reprovação nem ids do Mux: o "meu vídeo" devolve só o estado público (MyStatus).

export type PublicHead = { enabled: boolean; open: boolean; why: "off" | "not_allowed" | "disabled" | "no_community" | "closed" | "paused" | null };
export type StartResult =
  | { ok: true; id: string; upload_url: string; expires_at: string }
  | { ok: false; code: "invalid" | "not_found" | "off" | "table" | "closed" | "paused" | "too_many" | "name" | "consent" | "mux" };
export type MyStatus = {
  state: "sending" | "preparing" | "review" | "queue" | "on_tv" | "shown" | "not_shown" | "gone";
  position: number | null;
  eta_ms: number | null;
  first_shown_at: string | null;
  download: string | null;
};
export type SubmitDb = StoreDb & Pick<typeof nocodb, "insertOne" | "updateRows">;
// Limitadores em memória (por instância). device(max): um por valor de device_per_hour.
// ipGlobal: opcional (padrão: o compartilhado do processo), soma o IP em todos os restaurantes.
export type SubmitLimits = { ip: Limiter; device: (max: number) => Limiter; download: Limiter; ipGlobal?: Limiter };
export type SubmitDeps = {
  db: SubmitDb;
  store: Pick<StoreDeps, "mux" | "now" | "defer">;
  getHead: (slug: string) => Promise<AparecaHead | null>;
  mux: { createUpload: typeof createAparecaUpload; assetInfo: typeof assetInfo };
  monthUsd: () => Promise<number>;
  // Chamado (por defer) quando o vídeo pronto passou na duração: pending ou ai_review. A rota liga
  // aqui a moderação da IA (runModeration), que só age em ai_review.
  onReady: (v: VideoRow, head: AparecaHead) => Promise<void>;
  // IA disponível para este restaurante? Padrão: desligada (a rota usa aiAvailable com a chave).
  aiOn?: (head: AparecaHead) => boolean;
  now?: () => Date;
  off?: () => boolean;
  origin: string;
  // Opcionais (padrões entre parênteses): IP de quem chama ("anon"), limitadores (compartilhados
  // no processo), durações dos institucionais ([]) e enquetes/TVs da Comunidade (sem enquete, 1 TV).
  ip?: string;
  limits?: SubmitLimits;
  houseS?: (rid: string) => Promise<number[]>;
  community?: (rid: string) => Promise<{ polls: PollRow[]; tvs: TvRow[] }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MESA = /^[A-Z2-9]{6}$/;
const HOUR_MS = 60 * 60_000;
// No Wi-Fi do restaurante todos os clientes saem pelo mesmo IP público, e o João pediu até
// 100 vídeos por noite: o limite por IP é por restaurante e largo (60/h, decisão do controlador
// na correção 1 da T7). O limite principal por pessoa é o device_per_hour (padrão 2).
const IP_PER_HOUR = 60;
// Teto do mesmo IP somando todos os restaurantes: sem ele, um IP espalhado por várias casas teria
// 60 por casa. 120/h cobre um IP de rede móvel (CGNAT) compartilhado por clientes de duas casas
// cheias (decisão do controlador na correção 2 da T7).
const IP_PER_HOUR_GLOBAL = 120;
const DOWNLOADS_PER_HOUR = 5; // minha escolha: o contador de downloads não infla com toques repetidos
const CONSENT_SKEW_MS = 10 * 60_000;
const MUX_CHECK_MS = 5_000; // Mux consultado no máximo 1 vez a cada 5 s por vídeo
const MEMO_MAX = 5_000;

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const clock = (d: Pick<SubmitDeps, "now">) => (d.now ?? (() => new Date()))();
const storeDeps = (d: SubmitDeps): StoreDeps => ({ db: d.db, mux: d.store.mux, now: d.store.now ?? d.now, defer: d.store.defer });
const later = (d: SubmitDeps, fn: () => Promise<void>) =>
  d.store.defer ? d.store.defer(fn) : void fn().catch(() => {});

const globalIpLimiter = () => sharedLimiter("apareca.envio.ip-global", { max: IP_PER_HOUR_GLOBAL, windowMs: HOUR_MS });

export function defaultLimits(): SubmitLimits {
  return {
    ip: sharedLimiter("apareca.envio.ip", { max: IP_PER_HOUR, windowMs: HOUR_MS }),
    ipGlobal: globalIpLimiter(),
    device: (max) => sharedLimiter(`apareca.envio.device.${max}`, { max, windowMs: HOUR_MS }),
    download: sharedLimiter("apareca.baixou", { max: DOWNLOADS_PER_HOUR, windowMs: HOUR_MS }),
  };
}

// Teto do Mux: com ≥ 90% do APARECA_TETO_USD, os envios pausam. Erro ao somar o mês também
// pausa (o teto é de segurança: melhor parar que gastar sem saber).
async function isPaused(d: SubmitDeps): Promise<boolean> {
  try {
    return uploadGate(await d.monthUsd(), tetoUsd(process.env.APARECA_TETO_USD)) === "paused";
  } catch {
    return true;
  }
}

// ---------- Cabeça pública (convite no cardápio) ----------

export async function publicHead(d: SubmitDeps, slug: string): Promise<PublicHead | null> {
  const head = await d.getHead(slug);
  if (!head) return null;
  let st = featureState(head, { now: clock(d), off: d.off?.() ?? false, paused: false });
  if (st.on && (await isPaused(d))) st = { on: false, why: "paused" };
  if (st.on) return { enabled: true, open: true, why: null };
  return { enabled: st.why === "closed" || st.why === "paused", open: false, why: st.why };
}

// ---------- Envio ----------

type StartInput = { mesa: string; device: string; name: unknown; consent: unknown; consent_at: unknown };

function parseStart(body: unknown): StartInput | null {
  if (!isObj(body)) return null;
  if (typeof body.mesa !== "string" || !MESA.test(body.mesa)) return null;
  if (typeof body.device !== "string" || !UUID.test(body.device)) return null;
  return { mesa: body.mesa, device: body.device, name: body.name, consent: body.consent, consent_at: body.consent_at };
}

// Hora do aceite do celular, se perto do relógio do servidor; senão, a do servidor.
function consentAt(raw: unknown, now: Date): string {
  const t = typeof raw === "string" ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(t) && Math.abs(t - now.getTime()) <= CONSENT_SKEW_MS ? new Date(t).toISOString() : now.toISOString();
}

export async function startSubmission(d: SubmitDeps, slug: string, body: unknown): Promise<StartResult> {
  const input = parseStart(body);
  if (!input) return { ok: false, code: "invalid" };
  const head = await d.getHead(slug);
  if (!head) return { ok: false, code: "not_found" };
  const now = clock(d);
  const st = featureState(head, { now, off: d.off?.() ?? false, paused: false });
  if (!st.on && st.why !== "closed") return { ok: false, code: "off" };

  const table = await d.db.first<{ id?: unknown; restaurant_id?: unknown; active?: unknown }>("dining_tables", {
    restaurant_id: head.id,
    code: input.mesa,
  });
  if (!table || table.active !== true || table.restaurant_id !== head.id || typeof table.id !== "string" || !UUID.test(table.id)) {
    return { ok: false, code: "table" };
  }
  const tableId = table.id;
  if (!st.on) return { ok: false, code: "closed" };
  if (await isPaused(d)) return { ok: false, code: "paused" };
  if (input.consent !== true) return { ok: false, code: "consent" };
  const name = cleanName(input.name);
  if (!name.ok) return { ok: false, code: "name" };

  // Limite por device: as linhas da última hora (vale entre instâncias) e o limitador em memória
  // (vale entre os 5 s do retrato). Limites por IP (por restaurante e global): só em memória.
  const cfg = head.config;
  const snap = await readSnapshot(storeDeps(d), head.id);
  const since = now.getTime() - HOUR_MS;
  const recent = snap.videos.filter((v) => v.device_id === input.device && Date.parse(v.created_at) > since).length;
  if (recent >= cfg.device_per_hour) return { ok: false, code: "too_many" };
  const limits = d.limits ?? defaultLimits();
  const devLimiter = limits.device(cfg.device_per_hour);
  const devKey = `${head.id}:${input.device}`;
  const ip = d.ip ?? "anon";
  const ipKey = `${ip}|${head.id}`; // molde do telao/codigo: IP por restaurante
  const ipGlobal = limits.ipGlobal ?? globalIpLimiter();
  if (!devLimiter.hit(devKey)) return { ok: false, code: "too_many" };
  if (!limits.ip.hit(ipKey)) {
    devLimiter.undo(devKey);
    return { ok: false, code: "too_many" };
  }
  if (!ipGlobal.hit(ip)) {
    devLimiter.undo(devKey);
    limits.ip.undo(ipKey);
    return { ok: false, code: "too_many" };
  }
  const giveBack = () => {
    devLimiter.undo(devKey);
    limits.ip.undo(ipKey);
    ipGlobal.undo(ip);
  };

  const uid = crypto.randomUUID();
  let up: { id: string; url: string };
  try {
    up = await d.mux.createUpload(d.origin, `apareca:${head.id}:${tableId}:${uid}`);
  } catch (e) {
    console.error("apareca: upload do Mux", String(e).slice(0, 300));
    giveBack();
    return { ok: false, code: "mux" };
  }

  const expires = expiresAt(now, cfg.retention_h);
  const row: Omit<VideoRow, "Id" | "id"> & { uid: string } = {
    uid,
    restaurant_id: head.id,
    kind: "cliente",
    table_id: tableId,
    zone_id: cfg.table_zones[tableId] ?? null,
    device_id: input.device,
    name: name.name,
    consent_at: consentAt(input.consent_at, now),
    mux_upload_id: up.id,
    mux_asset_id: null,
    mux_playback_id: null,
    duration_ms: null,
    status: "uploading",
    decided_by: null,
    decided_at: null,
    ai_reason: null,
    plays: 0,
    plays_target: cfg.plays,
    first_shown_at: null,
    downloads: 0,
    expires_at: expires,
    created_at: now.toISOString(),
  };
  try {
    await d.db.insertOne("apareca_videos", row);
  } catch (e) {
    giveBack(); // o upload sem linha expira sozinho no Mux (nunca recebe o arquivo)
    throw e;
  }
  forgetSnapshot(head.id);
  return { ok: true, id: uid, upload_url: up.url, expires_at: expires };
}

// ---------- Meu vídeo ----------

const NONE = { position: null, eta_ms: null, first_shown_at: null, download: null } as const;
const GONE: MyStatus = { state: "gone", ...NONE };
const NOT_SHOWN: MyStatus = { state: "not_shown", ...NONE };

// Memórias por instância: última consulta ao Mux, MP4 já pronto e onReady já chamado.
const lastCheck = new Map<string, number>();
const mp4Known = new Set<string>();
const readied = new Set<string>();

function remember<T>(m: Map<string, T> | Set<string>, prune: () => void) {
  if (m.size > MEMO_MAX) prune();
}

// Consulta o Mux no máximo 1 vez a cada 5 s por vídeo; erro vira "sem notícia".
async function checkMux(d: SubmitDeps, v: VideoRow, now: Date): Promise<AssetInfo | null> {
  const t = now.getTime();
  const last = lastCheck.get(v.id);
  if (last !== undefined && t - last < MUX_CHECK_MS && t >= last) return null;
  lastCheck.set(v.id, t);
  remember(lastCheck, () => {
    for (const [id, at] of lastCheck) if (t - at >= MUX_CHECK_MS) lastCheck.delete(id);
  });
  try {
    return await d.mux.assetInfo(v.mux_upload_id);
  } catch {
    return null;
  }
}

async function mp4Ready(d: SubmitDeps, v: VideoRow, now: Date): Promise<boolean> {
  if (mp4Known.has(v.id)) return true;
  const info = await checkMux(d, v, now);
  if (info?.status === "ready" && info.mp4) {
    remember(mp4Known, () => mp4Known.clear());
    mp4Known.add(v.id);
    return true;
  }
  return false;
}

type Owned = { row: VideoRow; alive: boolean; videos: VideoRow[] };

// A linha do dono, viva ou vencida. O retrato apaga o vencido (purge em after()); a leitura
// direta só acontece quando o id não está no retrato. Outro device, outro restaurante ou id
// inexistente: null (a rota responde not_found igual nos três casos).
async function findOwned(d: SubmitDeps, head: AparecaHead, id: string, device: string, now: Date): Promise<Owned | null> {
  const snap = await readSnapshot(storeDeps(d), head.id);
  const row = snap.videos.find((v) => v.id === id) ?? (await d.db.first<VideoRow>("apareca_videos", { uid: id }));
  if (!row || row.restaurant_id !== head.id || row.device_id !== device) return null;
  const alive = !isExpired(row, now) && !isStuckUpload(row, now);
  return { row, alive, videos: snap.videos };
}

function parseOwner(body: unknown): { id: string; device: string } | null {
  if (!isObj(body)) return null;
  const { id, device } = body;
  if (typeof id !== "string" || !UUID.test(id) || typeof device !== "string" || !UUID.test(device)) return null;
  return { id, device };
}

const SETTLING = new Set<VideoRow["status"]>(["uploading", "processing"]);

// Relê a linha no banco: o retrato pode ter até 5 s, e outra instância pode já ter decidido.
// null = a linha sumiu (vencida e apagada); quem chama fica com o que tinha.
const reread = (d: SubmitDeps, v: VideoRow) => d.db.first<VideoRow>("apareca_videos", { uid: v.id });

// Upload terminou? Confere a duração (acima de MAX_ASSET_S reprova e apaga o asset, sem nunca passar
// por pending), grava os dados do asset com a decisão (pending ou ai_review) e chama onReady
// (uma vez por instância). Só grava se a linha ainda estiver uploading/processing no banco.
async function settleUpload(d: SubmitDeps, head: AparecaHead, v: VideoRow, now: Date): Promise<VideoRow> {
  const info = await checkMux(d, v, now);
  if (!info || info.status === "processing") return v;
  const cur = await reread(d, v);
  if (!cur) return v;
  if (!SETTLING.has(cur.status)) return cur;
  if (info.status === "failed") {
    await d.db.updateRows("apareca_videos", [{ Id: cur.Id, status: "failed" }]);
    forgetSnapshot(head.id);
    return { ...cur, status: "failed" };
  }
  const asset = {
    mux_asset_id: info.assetId,
    mux_playback_id: info.playbackId,
    duration_ms: Math.round(info.durationS * 1000),
  };
  const decision = onAssetReady({ duration_s: info.durationS }, head.config.mode, d.aiOn?.(head) ?? false);
  if (decision.status === "rejected") {
    const patch = {
      status: "rejected" as const,
      ...asset,
      decided_by: decision.by,
      decided_at: now.toISOString(),
      ai_reason: decision.reason, // só no banco
    };
    await d.db.updateRows("apareca_videos", [{ Id: cur.Id, ...patch }]);
    forgetSnapshot(head.id);
    // Falhou? A linha já está rejected (nunca vai à fila nem à TV) e a retenção apaga o asset depois.
    await d.store.mux.deleteAsset(info.assetId).catch((e: unknown) => {
      console.warn("apareca: apagar asset longo", String(e).slice(0, 200));
    });
    return { ...cur, ...patch };
  }
  const patch =
    decision.status === "ai_review"
      ? { status: "ai_review" as const, ...asset, decided_at: now.toISOString() } // carimbo do resolveStuck
      : { status: "pending" as const, ...asset };
  await d.db.updateRows("apareca_videos", [{ Id: cur.Id, ...patch }]);
  forgetSnapshot(head.id);
  if (info.mp4) mp4Known.add(v.id);
  const ready: VideoRow = { ...cur, ...patch };
  if (!readied.has(v.id)) {
    remember(readied, () => readied.clear());
    readied.add(v.id);
    later(d, () => d.onReady(ready, head));
  }
  return ready;
}

async function waitFor(d: SubmitDeps, head: AparecaHead, v: VideoRow, videos: VideoRow[], now: Date) {
  const known = new Set(head.config.zones.map((z) => z.id));
  const zoneOf = (x: VideoRow) => (x.zone_id && known.has(x.zone_id) ? x.zone_id : null);
  const line = [...videos.filter((x) => x.id !== v.id), v].map((x) => ({ ...x, zone_id: zoneOf(x) }));
  const zone = zoneOf(v);
  const position = queuePosition(line, v.id, zone);
  if (position === null) return { position: null, eta_ms: null };
  const [houseS, community] = await Promise.all([
    d.houseS?.(head.id).catch(() => []) ?? Promise.resolve([]),
    d.community?.(head.id).catch(() => null) ?? Promise.resolve(null),
  ]);
  const eta_ms = estimateWait({
    position,
    rule: head.config.rule,
    houseS,
    pollLeftMs: community ? pollLeftMs(community.polls, now) : 0,
    tvs: community ? tvsIn(community.tvs, head.config, zone) : 1,
  });
  return { position, eta_ms };
}

const downloadPath = (slug: string, id: string) => `/api/apareca/${slug}/baixar?id=${id}`;

export async function myStatus(d: SubmitDeps, slug: string, body: unknown): Promise<MyStatus | { error: "invalid" | "not_found" }> {
  const q = parseOwner(body);
  if (!q) return { error: "invalid" };
  const head = await d.getHead(slug);
  if (!head) return { error: "not_found" };
  const now = clock(d);
  const found = await findOwned(d, head, q.id, q.device, now);
  if (!found) return { error: "not_found" };
  if (!found.alive) return GONE;

  let v = found.row;
  if (v.status === "uploading" || v.status === "processing") {
    v = await settleUpload(d, head, v, now);
    if (v.status === "uploading") return { state: "sending", ...NONE };
    if (v.status === "processing") return { state: "preparing", ...NONE };
  }
  switch (v.status) {
    case "pending":
    case "ai_review":
      return { state: "review", ...(await waitFor(d, head, v, found.videos, now)), first_shown_at: null, download: null };
    case "approved": {
      const download = v.mux_playback_id && (await mp4Ready(d, v, now)) ? downloadPath(head.slug, v.id) : null;
      if (v.plays >= v.plays_target) return { state: "shown", position: null, eta_ms: null, first_shown_at: v.first_shown_at, download };
      if (v.first_shown_at) return { state: "on_tv", position: null, eta_ms: null, first_shown_at: v.first_shown_at, download };
      return { state: "queue", ...(await waitFor(d, head, v, found.videos, now)), first_shown_at: null, download };
    }
    default:
      return NOT_SHOWN; // rejected, removed, failed: sem motivo
  }
}

// ---------- Download ----------

// Endereço do MP4 para o 302 de "baixar": só do dono, aprovado, vivo e com o MP4 pronto.
export async function downloadTarget(d: SubmitDeps, slug: string, id: string, device: string): Promise<string | null> {
  const q = parseOwner({ id, device });
  if (!q) return null;
  const head = await d.getHead(slug);
  if (!head) return null;
  const now = clock(d);
  const found = await findOwned(d, head, q.id, q.device, now);
  if (!found?.alive || found.row.status !== "approved" || !found.row.mux_playback_id) return null;
  return (await mp4Ready(d, found.row, now)) ? mp4Url(found.row.mux_playback_id) : null;
}

// Conta um download (o celular avisa depois de baixar). Silencioso em qualquer recusa.
export async function countDownload(d: SubmitDeps, slug: string, body: unknown): Promise<void> {
  const q = parseOwner(body);
  if (!q) return;
  const head = await d.getHead(slug);
  if (!head) return;
  const found = await findOwned(d, head, q.id, q.device, clock(d));
  if (!found?.alive || found.row.status !== "approved") return;
  if (!(d.limits ?? defaultLimits()).download.hit(q.id)) return;
  await d.db.updateRows("apareca_videos", [{ Id: found.row.Id, downloads: (found.row.downloads || 0) + 1 }]);
  forgetSnapshot(head.id);
}
