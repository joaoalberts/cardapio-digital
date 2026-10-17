// Apareça na TV, lado da TV: quem é a TV, sinal de vida e "tocou".
// A TV é a mesma do telão da Comunidade: manda o segredo no cabeçalho x-telao e o banco só
// guarda o hash (community_tvs). A conferência do segredo é a mesma da Comunidade
// (matchTvSecret): hash, revogação e restaurante. Só TV pareada entra no Apareça.
// Funções puras, com banco, cabeça e relógio vindos de fora; memória por instância.
import { matchTvSecret, sha256Hex } from "@/lib/comunidade/tv";
import { zoneOf } from "./schedule";
import type { AparecaHead, HouseVideoRow, VideoRow } from "./types";

export const TV_ID_MS = 5 * 60_000; // identidade guardada por hash (brief: cache 5 min)
export const HEARTBEAT_MS = 60_000; // last_seen_at no máx. 1x por minuto por TV (spec)
// Institucionais exibidos: a duração soma em memória e vira uma linha de apareca_tally
// (só played_s, sem dado pessoal) a cada 10 min por restaurante. Minha escolha: uma linha
// por "tocou" encheria o tally (um institucional de 30 s são 120 linhas por hora por TV).
export const HOUSE_FLUSH_MS = 10 * 60_000;
const PLAY_MEMORY_MS = 60 * 60_000; // um "play" repetido dentro de 1 h conta uma vez
const DEFAULT_TZ = "America/Sao_Paulo";
const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Where = Record<string, string | number | boolean | null>;
type TvAppTable = "community_tvs" | "apareca_videos" | "apareca_tally";
export type TvAppDb = {
  list<T>(t: TvAppTable, w: Where): Promise<T[]>;
  update(t: TvAppTable, w: Where, p: Record<string, unknown>): Promise<number>;
  updateRows(t: TvAppTable, rows: ({ Id: number } & Record<string, unknown>)[]): Promise<void>;
  insert<T extends Record<string, unknown>>(t: TvAppTable, rows: T[]): Promise<unknown[]>;
};
export type TvIdentity = { tvId: string; restaurantId: string; zone: string | null };
export type AparecaTvDeps = {
  db: TvAppDb;
  getHead: (slug: string) => Promise<AparecaHead | null>;
  now?: () => Date;
  forget?: (rid: string) => void; // forgetSnapshot: o próximo programa já sai com o plays novo
  getHouse?: (rid: string) => Promise<HouseVideoRow[]>; // getHouseVideos (em cache do Next)
};

const nowMs = (d: AparecaTvDeps) => (d.now?.() ?? new Date()).getTime();
const iso = (t: number) => new Date(t).toISOString();

// ---------- Memória da instância ----------

const ids = new Map<string, { tvId: string; Id: number; at: number }>(); // `${rid}:${hash do segredo}` -> TV
const rowIds = new Map<string, number>(); // tvId -> Id numérico em community_tvs
const seenAt = new Map<string, number>(); // tvId -> último last_seen_at gravado
const plays = new Map<string, number>(); // play -> até quando lembrar
const timezones = new Map<string, string>(); // rid -> fuso (para o dia do tally)
const housePending = new Map<string, { since: number; day: string; month: string; s: number }>();

/** Só para os testes: esquece tudo o que a instância guardou. */
export function resetTvMemory(): void {
  for (const m of [ids, rowIds, seenAt, plays, timezones, housePending]) m.clear();
}

// ---------- Quem é a TV ----------

// 404: slug sem restaurante. 401: segredo torto, de outro restaurante, revogado, o hash no lugar
// do segredo ou TV ainda não pareada. A zona sai da config de agora (tv_zones), mesmo com a
// identidade em memória; zona apagada vale "todas as zonas". Só o sucesso fica guardado (5 min):
// uma TV recém-pareada não espera, e uma revogada sai em até 5 min.
export async function identifyTv(
  d: AparecaTvDeps, slug: string, secret: string | null,
): Promise<TvIdentity | { status: 401 | 404 }> {
  const head = await d.getHead(slug);
  if (!head) return { status: 404 };
  timezones.set(head.id, head.timezone || DEFAULT_TZ);
  if (typeof secret !== "string" || !HEX64.test(secret)) return { status: 401 };
  const t = nowMs(d);
  const key = `${head.id}:${await sha256Hex(secret)}`;
  let hit = ids.get(key);
  if (!hit || t - hit.at >= TV_ID_MS || t < hit.at) {
    ids.delete(key);
    const m = await matchTvSecret(d.db, head.id, secret);
    if (!m.ok || !m.tv) return { status: 401 };
    hit = { tvId: m.tv.id, Id: m.tv.Id, at: t };
    ids.set(key, hit);
    if (Number.isFinite(hit.Id)) rowIds.set(hit.tvId, hit.Id);
  }
  return { tvId: hit.tvId, restaurantId: head.id, zone: zoneOf(head.config, "tv", hit.tvId) };
}

// ---------- Sinal de vida ----------

// Grava last_seen_at (o mesmo "visto há" do painel da Comunidade) no máximo 1x a cada 60 s por TV.
// A vez é marcada antes de gravar (duas consultas juntas não gravam duas vezes) e devolvida se falhar.
export async function heartbeat(d: AparecaTvDeps, tv: TvIdentity): Promise<void> {
  const t = nowMs(d);
  const last = seenAt.get(tv.tvId);
  if (last !== undefined && t - last < HEARTBEAT_MS && t >= last) return;
  seenAt.set(tv.tvId, t);
  try {
    const Id = rowIds.get(tv.tvId);
    if (Id !== undefined) await d.db.updateRows("community_tvs", [{ Id, last_seen_at: iso(t) }]);
    else await d.db.update("community_tvs", { uid: tv.tvId, restaurant_id: tv.restaurantId }, { last_seen_at: iso(t) });
  } catch (e) {
    if (seenAt.get(tv.tvId) === t) {
      if (last === undefined) seenAt.delete(tv.tvId);
      else seenAt.set(tv.tvId, last);
    }
    throw e;
  }
}

// ---------- "Tocou" ----------

type PlayBody = { video: string; play: string; kind: "client" | "house" };
function parsePlay(body: unknown): PlayBody | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.video !== "string" || !UUID.test(b.video) || typeof b.play !== "string" || !UUID.test(b.play)) return null;
  if (b.kind !== undefined && b.kind !== "client" && b.kind !== "house") return null;
  return { video: b.video, play: b.play, kind: b.kind === "house" ? "house" : "client" };
}

function rememberPlay(play: string, t: number): boolean {
  for (const [k, until] of plays) if (until <= t) plays.delete(k);
  const until = plays.get(play);
  if (until !== undefined && t < until) return false;
  plays.set(play, t + PLAY_MEMORY_MS);
  return true;
}

// Corpo { video, play, kind? }: play é o uuid daquela exibição (a TV gera um por vez que toca).
// Cliente: só vídeo approved do restaurante da TV. A linha é relida antes de gravar (o NocoDB não
// tem gravação condicional); duas TVs ao mesmo tempo podem gravar o mesmo número e o vídeo tocar
// uma vez a mais, nunca menos. plays passa do alvo sem problema: programFor já tira o vídeo.
// first_shown_at só na primeira vez. Institucional (kind "house"): só soma a duração no uso do mês.
export async function reportPlay(d: AparecaTvDeps, tv: TvIdentity, body: unknown): Promise<{ ok: boolean }> {
  const b = parsePlay(body);
  if (!b) return { ok: false };
  const t = nowMs(d);
  if (!rememberPlay(b.play, t)) return { ok: true }; // nova tentativa de rede da mesma exibição
  try {
    const ok = b.kind === "house" ? await housePlay(d, tv, b.video, t) : await clientPlay(d, tv, b.video, t);
    if (!ok) plays.delete(b.play);
    return { ok };
  } catch (e) {
    plays.delete(b.play);
    throw e;
  }
}

async function clientPlay(d: AparecaTvDeps, tv: TvIdentity, video: string, t: number): Promise<boolean> {
  const rows = await d.db.list<VideoRow>("apareca_videos", { uid: video, restaurant_id: tv.restaurantId });
  const v = rows.find((r) => r.id === video && r.restaurant_id === tv.restaurantId);
  if (!v || v.status !== "approved") return false;
  const patch: Record<string, unknown> = { plays: (Number.isFinite(v.plays) ? v.plays : 0) + 1 };
  if (!v.first_shown_at) patch.first_shown_at = iso(t);
  await d.db.updateRows("apareca_videos", [{ Id: v.Id, ...patch }]);
  d.forget?.(tv.restaurantId);
  return true;
}

function localDay(tz: string, t: number): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
  }
}

async function housePlay(d: AparecaTvDeps, tv: TvIdentity, video: string, t: number): Promise<boolean> {
  if (!d.getHouse) return false;
  const h = (await d.getHouse(tv.restaurantId)).find(
    (x) => x.id === video && x.restaurant_id === tv.restaurantId && x.active === true && x.status === "ready",
  );
  const s = (h?.duration_ms ?? 0) / 1000;
  if (!h || !(s > 0)) return false;

  const day = localDay(timezones.get(tv.restaurantId) ?? DEFAULT_TZ, t);
  const rid = tv.restaurantId;
  let p = housePending.get(rid);
  // Virou o dia: o que estava acumulado vai para o dia em que tocou.
  if (p && p.day !== day) {
    await flushHouse(d, rid, p);
    p = undefined;
  }
  if (!p) {
    p = { since: t, day, month: day.slice(0, 7), s: 0 };
    housePending.set(rid, p);
  }
  p.s += s;
  if (t - p.since >= HOUSE_FLUSH_MS) await flushHouse(d, rid, p);
  return true;
}

// Uma linha de tally com played_s (entrega do Mux, mesma conta do house_min). Falhou: a soma volta
// para a memória e entra na próxima gravação.
async function flushHouse(d: AparecaTvDeps, rid: string, p: { since: number; day: string; month: string; s: number }) {
  if (housePending.get(rid) === p) housePending.delete(rid);
  try {
    await d.db.insert("apareca_tally", [{
      restaurant_id: rid, day: p.day, month: p.month, counts: { played_s: Math.round(p.s) }, hours: Array(24).fill(0),
    }]);
  } catch (e) {
    const now = housePending.get(rid);
    if (now && now.day === p.day) now.s += p.s;
    else if (!now) housePending.set(rid, p);
    throw e;
  }
}
