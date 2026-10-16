import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import * as nocodb from "@/lib/db/nocodb";
import { SLUG_PATTERN } from "@/lib/slug";
import { toHead } from "@/lib/comunidade/votes";
import { parseConfig } from "./config";
import { resolveStuck } from "./moderation";
import { releaseMuxUpload } from "./mux-video";
import type { MonthUsage } from "./cost";
import { isExpired, isStuckUpload, purgePlan } from "./retention";
import type { AparecaHead, AparecaTallyRow, HouseVideoRow, VideoRow } from "./types";

// Dados "ao vivo" do Apareça: a cabeça do restaurante e os institucionais em cache do Next
// (as actions do painel chamam updateTag com aparecaTags), e o retrato da fila em memória
// de cada instância, por SNAPSHOT_MS, para celular, TV e painel não baterem no NocoDB a cada consulta.

export const aparecaTags = { slug: (s: string) => `apareca:slug:${s}`, rid: (id: string) => `apareca:rid:${id}` };

const SNAPSHOT_MS = 5_000; // minha escolha (brief da T5)
const USAGE_MS = 60_000;
// Ids apagados há pouco: uma leitura que começou antes do fim do purge e volta depois dele
// ainda traz a linha; ela é ignorada por este prazo (bem maior que SNAPSHOT_MS).
const RECENT_MS = 30_000;
const DEFAULT_TZ = "America/Sao_Paulo";

export type StoreDb = Pick<typeof nocodb, "list" | "first" | "insert" | "removeIds">;
// Sem vencidos; ai_review parado além do prazo da IA aparece como pending (resolveStuck), só na
// leitura: a linha no banco continua ai_review e o veredito atrasado só grava sobre ai_review.
export type Snapshot = { at: number; videos: VideoRow[] };
export type StoreDeps = {
  db: StoreDb;
  // releaseUpload: opcional (padrão releaseMuxUpload); confere o upload de envio parado sem asset.
  mux: { deleteAsset: (id: string) => Promise<void>; releaseUpload?: (uploadId: string) => Promise<void> };
  now?: () => Date;
  defer?: (fn: () => Promise<void>) => void; // after() na rota
};

type Raw = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

// Linha de restaurants → cabeça do Apareça. Nome, fuso, horário e Comunidade seguem a mesma
// leitura da Comunidade (toHead); os interruptores vazios contam como desligados.
function toAparecaHead(r: Raw | null): AparecaHead | null {
  const c = toHead(r);
  if (!r || !c) return null;
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    timezone: c.timezone,
    opening_hours: c.opening_hours,
    allowed: r.apareca_allowed === true,
    ai_allowed: r.apareca_ai_allowed === true,
    enabled: r.apareca_enabled === true,
    community_enabled: c.enabled,
    config: parseConfig(r.apareca_config),
    logo_path: c.logo_path,
    brand_color: c.brand_color,
    instagram: c.instagram,
  };
}

export async function getAparecaHead(slug: string): Promise<AparecaHead | null> {
  "use cache";
  const s = slug.toLowerCase();
  cacheTag(aparecaTags.slug(s));
  cacheLife({ revalidate: 60, expire: 300 });
  if (!SLUG_PATTERN.test(s)) return null;
  return toAparecaHead(await nocodb.first<Raw>("restaurants", { slug: s }));
}

// Cabeça lida direto do banco, sem cache, pelo id do restaurante: a moderação da IA confere o modo
// e o interruptor de agora antes de gravar o veredito (a cabeça em cache pode ter até 60 s).
export async function readAparecaHeadFresh(rid: string): Promise<AparecaHead | null> {
  return toAparecaHead(await nocodb.first<Raw>("restaurants", { uid: rid }));
}

// Todos os institucionais da casa (inclusive inativos e em preparo), por posição: quem usa filtra.
export async function getHouseVideos(rid: string): Promise<HouseVideoRow[]> {
  "use cache";
  cacheTag(aparecaTags.rid(rid));
  cacheLife({ revalidate: 60, expire: 300 });
  const rows = await nocodb.list<HouseVideoRow>("apareca_house_videos", { restaurant_id: rid });
  return rows.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.Id - b.Id);
}

// ---------- Retrato da fila ----------

const snaps = new Map<string, { at: number; rows: Promise<VideoRow[]> }>();
// Vídeos (id) com purge em andamento: duas leituras ao mesmo tempo não apagam o mesmo vencido duas vezes.
const purging = new Set<string>();
const recentlyGone = new Map<string, number>(); // id -> até quando ignorar

function wasPurged(id: string, t: number): boolean {
  const until = recentlyGone.get(id);
  if (until === undefined) return false;
  if (t < until) return true;
  recentlyGone.delete(id);
  return false;
}
const tzCache = new Map<string, string>();

const gone = (v: VideoRow, now: Date) => isExpired(v, now) || isStuckUpload(v, now);
const runNow = (fn: () => Promise<void>) => void fn().catch(() => {});

export async function readSnapshot(d: StoreDeps, rid: string): Promise<Snapshot> {
  const now = (d.now ?? (() => new Date()))();
  const t = now.getTime();
  let s = snaps.get(rid);
  if (!s || t - s.at >= SNAPSHOT_MS || t < s.at) {
    const fresh = { at: t, rows: d.db.list<VideoRow>("apareca_videos", { restaurant_id: rid }) };
    // Leitura que falhou não fica guardada: a próxima tenta de novo.
    fresh.rows.catch(() => {
      if (snaps.get(rid) === fresh) snaps.delete(rid);
    });
    snaps.set(rid, fresh);
    s = fresh;
  }
  const rows = await s.rows;
  const videos: VideoRow[] = [];
  const toPurge: VideoRow[] = [];
  for (const v of rows) {
    if (!gone(v, now)) videos.push(resolveStuck(v, now) ? { ...v, status: "pending" } : v);
    else if (!purging.has(v.id) && !wasPurged(v.id, t)) {
      purging.add(v.id);
      toPurge.push(v);
    }
  }
  if (toPurge.length) {
    (d.defer ?? runNow)(async () => {
      try {
        await purge(d, toPurge);
      } finally {
        for (const v of toPurge) purging.delete(v.id);
        forgetSnapshot(rid); // o retrato guardado ainda tem as linhas apagadas
      }
    });
  }
  return { at: s.at, videos };
}

export function forgetSnapshot(rid: string): void {
  snaps.delete(rid);
}

// Fuso de cada restaurante para o dia do tally (uma leitura por restaurante e instância).
async function timezones(db: StoreDb, rids: string[]): Promise<(rid: string) => string> {
  await Promise.all(
    [...new Set(rids)].filter((rid) => !tzCache.has(rid)).map(async (rid) => {
      const r = await db.first<Raw>("restaurants", { uid: rid }).catch(() => null);
      const tz = str(r?.timezone);
      if (tz) tzCache.set(rid, tz);
    }),
  );
  return (rid) => tzCache.get(rid) ?? DEFAULT_TZ;
}

// Apaga os vencidos: asset no Mux primeiro, depois o relatório (apareca_tally), depois a linha.
// Envio parado sem asset: o upload é conferido no Mux (releaseUpload) antes. Asset ou upload que não
// se resolveu segura a linha (e fica fora do tally) para a próxima leitura tentar de novo.
// Várias linhas de tally para o mesmo restaurante e dia são normais: quem lê sempre soma.
export async function purge(d: StoreDeps, rows: VideoRow[]): Promise<{ deleted: number; failed: number }> {
  const now = (d.now ?? (() => new Date()))();
  const t = now.getTime();
  const candidates = rows.filter((v) => gone(v, now) && !wasPurged(v.id, t));
  if (!candidates.length) return { deleted: 0, failed: 0 };

  const ok: VideoRow[] = [];
  let failed = 0;
  await Promise.all(
    candidates.map(async (v) => {
      try {
        if (v.mux_asset_id) await d.mux.deleteAsset(v.mux_asset_id);
        else if (v.mux_upload_id) await (d.mux.releaseUpload ?? releaseMuxUpload)(v.mux_upload_id);
        ok.push(v);
      } catch {
        failed += 1;
      }
    }),
  );
  if (!ok.length) return { deleted: 0, failed };

  ok.sort((a, b) => a.Id - b.Id);
  const tz = await timezones(d.db, ok.map((v) => v.restaurant_id));
  const { tally } = purgePlan(ok, now, tz);
  if (tally.length) await d.db.insert("apareca_tally", tally);
  await d.db.removeIds("apareca_videos", ok.map((v) => v.Id));
  for (const v of ok) recentlyGone.set(v.id, t + RECENT_MS);
  for (const [id, until] of recentlyGone) if (until <= t) recentlyGone.delete(id);
  return { deleted: ok.length, failed };
}

// ---------- Uso do mês (teto do Mux) ----------

const usageMemo = new Map<string, { at: number; p: Promise<MonthUsage> }>();
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

function localMonth(timezone: string, iso: string): string | null {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" }).format(at);
}

async function computeUsage(db: StoreDb, month: string): Promise<MonthUsage> {
  const [tallies, live, houses] = await Promise.all([
    db.list<AparecaTallyRow>("apareca_tally", { month }),
    db.list<VideoRow>("apareca_videos"),
    db.list<HouseVideoRow>("apareca_house_videos"),
  ]);

  // Vídeos de clientes já apagados: o que o tally guardou.
  let encoded_s = 0;
  let played_s = 0;
  let mp4_s = 0;
  for (const t of tallies) {
    const c = t.counts ?? {};
    encoded_s += num(c.encoded_s);
    played_s += num(c.played_s);
    mp4_s += num(c.mp4_s);
    // Download do MP4 também é entrega; o tally não guarda a duração de cada vídeo, então usa a média do grupo.
    const sent = num(c.sent);
    if (sent) played_s += num(c.downloads) * (num(c.encoded_s) / sent);
  }

  // Vídeos de clientes ainda no banco (vivos ou vencidos à espera do purge; nunca os dois ao mesmo tempo).
  const tz = await timezones(db, live.map((v) => v.restaurant_id));
  for (const v of live) {
    const dur_s = num(v.duration_ms) / 1000;
    if (!dur_s || localMonth(tz(v.restaurant_id), v.created_at) !== month) continue;
    encoded_s += dur_s;
    played_s += (num(v.plays) + num(v.downloads)) * dur_s;
    if (v.mux_asset_id) mp4_s += dur_s; // MP4 "highest" nasce com o asset
  }

  // Institucionais ativos ficam guardados o mês todo.
  let houseStoredMin = 0;
  for (const h of houses) if (h.active === true) houseStoredMin += num(h.duration_ms) / 60_000;

  return {
    encoded_s,
    stored_min_month: houseStoredMin + encoded_s / 60,
    played_s,
    mp4_s,
    // Minutos dos institucionais exibidos em loop: ainda não há como medir. A T13 (sinal de vida da TV)
    // passa a contar; até lá, 0 (a fatia grátis de 60 mil min de entrega cobre com folga).
    house_min: 0,
  };
}

// Soma de todas as casas (o teto é da conta do Mux, não do restaurante). Memória de 60 s por mês.
export async function monthUsage(d: StoreDeps, month: string): Promise<MonthUsage> {
  const t = (d.now ?? (() => new Date()))().getTime();
  const m = usageMemo.get(month);
  if (m && t - m.at < USAGE_MS && t >= m.at) return m.p;
  const fresh = { at: t, p: computeUsage(d.db, month) };
  fresh.p.catch(() => {
    if (usageMemo.get(month) === fresh) usageMemo.delete(month);
  });
  usageMemo.set(month, fresh);
  return fresh.p;
}
