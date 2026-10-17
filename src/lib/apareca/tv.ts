// Apareça na TV, lado da TV: quem é a TV, sinal de vida e "tocou".
// A TV é a mesma do telão da Comunidade: manda o segredo no cabeçalho x-telao e o banco só
// guarda o hash (community_tvs). A conferência do segredo é a mesma da Comunidade
// (matchTvSecret): hash, revogação e restaurante. Só TV pareada entra no Apareça.
// Funções puras, com banco, cabeça e relógio vindos de fora; memória por instância.
import { matchTvSecret, sha256Hex } from "@/lib/comunidade/tv";
import { featureState } from "./config";
import { zoneOf } from "./schedule";
import type { AparecaHead, HouseVideoRow, VideoRow } from "./types";

// Identidade guardada por hash. 60 s (decisão do controlador na correção 1, acima dos 5 min do brief):
// uma TV desconectada em outra instância sai em até 1 min; na mesma instância, na hora (forgetTv).
export const TV_ID_MS = 60_000;
export const HEARTBEAT_MS = 60_000; // last_seen_at no máx. 1x por minuto por TV (spec)
// Institucionais exibidos: a duração soma em memória e vira uma linha de apareca_tally
// (só counts.house_played_s, sem dado pessoal) a cada 10 min por restaurante. Minha escolha: uma linha
// por "tocou" encheria o tally (um institucional de 30 s são 120 linhas por hora por TV).
export const HOUSE_FLUSH_MS = 10 * 60_000;
const PLAY_MEMORY_MS = 60 * 60_000; // um "play" repetido dentro de 1 h conta uma vez
// Teto de tempo por TV: a TV avisa no INÍCIO de cada clipe, então o que ela já tocou antes deste
// clipe (clientes + institucionais, numa janela de 10 min) não passa do tempo de relógio desde o
// primeiro "tocou" aceito na janela + 30 s de folga. O clipe novo soma depois, com a duração do
// banco (ou no máximo 60 s sem ela): o pior abuso fica em relógio + 30 s + um clipe limitado.
// Uma TV (ou um segredo vazado) não infla plays nem o uso do mês mais rápido do que o tempo passa.
export const AIR_WINDOW_MS = 10 * 60_000;
export const AIR_SLACK_S = 30;
const CLIP_S = 6; // duração do vídeo do cliente quando o Mux ainda não informou (CLIP_MS)
const BODY_DURATION_MAX_S = 3_600;
// Institucional sem duração no banco (o Mux ainda não informou): a do corpo vale até 60 s.
const HOUSE_BODY_MAX_S = 60;
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
  off?: () => boolean; // aparecaOff (chave geral); padrão: desligada
};

const nowMs = (d: AparecaTvDeps) => (d.now?.() ?? new Date()).getTime();
const iso = (t: number) => new Date(t).toISOString();

// ---------- Memória da instância ----------

const ids = new Map<string, { tvId: string; Id: number; at: number }>(); // `${rid}:${hash do segredo}` -> TV
const rowIds = new Map<string, number>(); // tvId -> Id numérico em community_tvs
const seenAt = new Map<string, number>(); // tvId -> último last_seen_at gravado
const plays = new Map<string, number>(); // play -> até quando lembrar
const timezones = new Map<string, string>(); // rid -> fuso (para o dia do tally)
type Pending = { since: number; day: string; month: string; s: number };
const housePending = new Map<string, Pending>(); // rid -> segundos de institucional ainda não gravados
const zoneIds = new Map<string, Set<string>>(); // rid -> zonas que existem na config (da última identificação)
const onAir = new Map<string, { at: number; s: number }[]>(); // tvId -> "tocou" aceitos na janela

/** Só para os testes: esquece tudo o que a instância guardou. */
export function resetTvMemory(): void {
  for (const m of [ids, rowIds, seenAt, plays, timezones, housePending, zoneIds, onAir]) m.clear();
}

/** TV desconectada no painel: esquece a identidade dela nesta instância (a próxima chamada vai ao banco). */
export function forgetTv(tvId: string): void {
  for (const [k, v] of ids) if (v.tvId === tvId) ids.delete(k);
}

// ---------- Quem é a TV ----------

// 404: slug sem restaurante. 401: segredo torto, de outro restaurante, revogado, o hash no lugar
// do segredo ou TV ainda não pareada. A zona sai da config de agora (tv_zones), mesmo com a
// identidade em memória; zona apagada vale "todas as zonas". Só o sucesso fica guardado (60 s):
// uma TV recém-pareada não espera, e uma revogada sai na hora nesta instância (forgetTv) e em até
// 60 s nas outras. Não exige o Apareça ligado: quem decide é a rota (featureState), para a TV
// receber { enabled: false } e voltar à tela ociosa em vez de um erro que a faria insistir.
export async function identifyTv(
  d: AparecaTvDeps, slug: string, secret: string | null,
): Promise<TvIdentity | { status: 401 | 404 }> {
  const head = await d.getHead(slug);
  if (!head) return { status: 404 };
  timezones.set(head.id, head.timezone || DEFAULT_TZ);
  zoneIds.set(head.id, new Set(head.config.zones.map((z) => z.id)));
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

// A mesma regra da programação: o Apareça precisa estar no ar (a pausa do teto só para os envios).
export function tvFeatureOn(d: AparecaTvDeps, head: AparecaHead | null): boolean {
  return featureState(head, { now: new Date(nowMs(d)), off: d.off?.() ?? false, paused: false }).on;
}

// A rota "tocou" inteira, sem o HTTP: TV identificada, Apareça no ar e só então reportPlay.
// Fora do ar: 404 { ok: false, enabled: false } e nada gravado.
export async function playFromTv(
  d: AparecaTvDeps, slug: string, secret: string | null, body: unknown,
): Promise<{ status: 200 | 401 | 404; body: Record<string, unknown> }> {
  const tv = await identifyTv(d, slug, secret);
  if ("status" in tv) return { status: tv.status, body: { ok: false, code: tv.status === 401 ? "unauthorized" : "not_found" } };
  if (!tvFeatureOn(d, await d.getHead(slug))) return { status: 404, body: { ok: false, enabled: false } };
  return { status: 200, body: await reportPlay(d, tv, body) };
}

type PlayBody = { video: string; play: string; kind: "client" | "house"; duration_s: number | null };
function parsePlay(body: unknown): PlayBody | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.video !== "string" || !UUID.test(b.video) || typeof b.play !== "string" || !UUID.test(b.play)) return null;
  if (b.kind !== undefined && b.kind !== "client" && b.kind !== "house") return null;
  const dur = b.duration_s;
  if (dur !== undefined && !(typeof dur === "number" && Number.isFinite(dur) && dur > 0 && dur <= BODY_DURATION_MAX_S)) return null;
  return { video: b.video, play: b.play, kind: b.kind === "house" ? "house" : "client", duration_s: dur ?? null };
}

function rememberPlay(play: string, t: number): boolean {
  for (const [k, until] of plays) if (until <= t) plays.delete(k);
  const until = plays.get(play);
  if (until !== undefined && t < until) return false;
  plays.set(play, t + PLAY_MEMORY_MS);
  return true;
}

// Reserva s segundos no ar desta TV. Síncrono (sem await entre conferir e marcar): pedidos
// simultâneos não furam a conta. Devolve como desfazer, ou null se passou do teto.
function reserveAir(tvId: string, s: number, t: number): (() => void) | null {
  const list = (onAir.get(tvId) ?? []).filter((e) => e.at > t - AIR_WINDOW_MS && e.at <= t);
  const start = list.length ? list[0].at : t;
  const used = list.reduce((n, e) => n + e.s, 0);
  if (used > (t - start) / 1000 + AIR_SLACK_S) {
    onAir.set(tvId, list);
    return null;
  }
  const entry = { at: t, s };
  list.push(entry);
  onAir.set(tvId, list);
  return () => {
    const cur = onAir.get(tvId);
    if (cur) onAir.set(tvId, cur.filter((e) => e !== entry));
  };
}

// Corpo { video, play, kind?, duration_s? }: play é o uuid daquela exibição (a TV gera um por vez que toca).
// Cliente: só vídeo approved do restaurante da TV e da zona dela (mesma regra do programFor). A linha
// é relida antes de gravar (o NocoDB não tem gravação condicional); duas TVs ao mesmo tempo podem
// gravar o mesmo número e o vídeo tocar uma vez a mais, nunca menos. plays passa do alvo sem problema:
// programFor já tira o vídeo. first_shown_at só na primeira vez. Institucional (kind "house"): só soma
// a duração no uso do mês. Acima do teto de tempo da TV: { ok: false } e nada somado.
export async function reportPlay(d: AparecaTvDeps, tv: TvIdentity, body: unknown): Promise<{ ok: boolean }> {
  const b = parsePlay(body);
  if (!b) return { ok: false };
  const t = nowMs(d);
  if (!rememberPlay(b.play, t)) return { ok: true }; // nova tentativa de rede da mesma exibição
  try {
    const ok = b.kind === "house" ? await housePlay(d, tv, b, t) : await clientPlay(d, tv, b.video, t);
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
  // Zona que não existe mais vale "sem zona" (Foco 3). Sem a config na memória, não confere.
  const zones = zoneIds.get(tv.restaurantId);
  const vz = v.zone_id && zones?.has(v.zone_id) ? v.zone_id : null;
  if (tv.zone !== null && vz !== null && vz !== tv.zone) return false;

  const dur = typeof v.duration_ms === "number" && v.duration_ms > 0 ? v.duration_ms / 1000 : CLIP_S;
  const undo = reserveAir(tv.tvId, dur, t);
  if (!undo) return false;
  try {
    const patch: Record<string, unknown> = { plays: (Number.isFinite(v.plays) ? v.plays : 0) + 1 };
    if (!v.first_shown_at) patch.first_shown_at = iso(t);
    await d.db.updateRows("apareca_videos", [{ Id: v.Id, ...patch }]);
  } catch (e) {
    undo();
    throw e;
  }
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

async function housePlay(d: AparecaTvDeps, tv: TvIdentity, b: PlayBody, t: number): Promise<boolean> {
  if (!d.getHouse) return false;
  const rid = tv.restaurantId;
  const h = (await d.getHouse(rid)).find(
    (x) => x.id === b.video && x.restaurant_id === rid && x.active === true && x.status === "ready",
  );
  if (!h) return false;
  // A duração do corpo, limitada à do banco quando o Mux já informou; sem ela, a no máximo 60 s.
  const db = (h.duration_ms ?? 0) / 1000;
  const s = db > 0 ? Math.min(b.duration_s ?? db, db) : Math.min(b.duration_s ?? 0, HOUSE_BODY_MAX_S);
  if (!(s > 0)) return false;
  if (!reserveAir(tv.tvId, s, t)) return false;

  const day = localDay(timezones.get(rid) ?? DEFAULT_TZ, t);
  let carry = 0;
  const old = housePending.get(rid);
  // Virou o dia: o que estava acumulado vai para o dia em que tocou (se a gravação falhar, entra no dia novo).
  if (old && old.day !== day && !(await flushPending(d, rid, old, false))) carry = old.s;
  let p = housePending.get(rid);
  if (!p) {
    p = { since: t, day, month: day.slice(0, 7), s: 0 };
    housePending.set(rid, p);
  }
  p.s += s + carry;
  if (t - p.since >= HOUSE_FLUSH_MS) await flushPending(d, rid, p, true);
  return true; // a exibição já está somada na memória: gravar é problema do próximo flush
}

// Grava o pendente do restaurante se ele tem 10 min ou mais (chamado depois da resposta da programação,
// para a soma não ficar parada na memória quando a TV para de mandar "tocou" de institucional).
export async function flushHouseIfDue(d: AparecaTvDeps, rid: string): Promise<void> {
  const p = housePending.get(rid);
  if (p && nowMs(d) - p.since >= HOUSE_FLUSH_MS) await flushPending(d, rid, p, true);
}

// Uma linha de tally com counts.house_played_s (sem dado pessoal; o uso do mês soma em house_min).
// Nunca lança. Falhou: com keep, a soma volta para a memória e entra na próxima gravação; sem keep,
// quem chamou leva a soma adiante.
async function flushPending(d: AparecaTvDeps, rid: string, p: Pending, keep: boolean): Promise<boolean> {
  if (housePending.get(rid) === p) housePending.delete(rid);
  try {
    await d.db.insert("apareca_tally", [{
      restaurant_id: rid, day: p.day, month: p.month, counts: { house_played_s: Math.round(p.s) }, hours: Array(24).fill(0),
    }]);
    return true;
  } catch {
    if (keep) {
      const cur = housePending.get(rid);
      if (cur && cur.day === p.day) cur.s += p.s;
      else if (!cur) housePending.set(rid, p);
    }
    return false;
  }
}
