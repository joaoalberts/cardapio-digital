// Servidor da Comunidade, em funções puras com o banco e o relógio vindos de fora
// (molde de lib/orders/specials.ts): o voto, a leitura agregada e a conversão das linhas
// do NocoDB. O restaurante vem sempre do slug resolvido aqui, nunca do corpo do pedido.
// Voto e leitura nunca invalidam cache.
import { openStatus } from "@/lib/menu/hours";
import type { OpeningHours } from "@/lib/menu/types";
import { DAY_START_DEFAULT, currentPoll, pollPhase } from "./clock";
import { communityOff } from "./off";
import { buildPublicState, cacheControl, disabledState, parseResult } from "./public-state";
import { VOTE_CAP_PER_RESTAURANT, VOTE_CAP_PER_TABLE, effectiveVotes } from "./tally";
import type { CommunityHead, OptionId, PollOption, PollRow, PollTemplate, PostRow, PublicState, TvRow, VoteRow } from "./types";

type Where = Record<string, string | number | boolean | null>;
export type CommunityDb = {
  list<T>(
    t: "community_votes" | "community_polls" | "community_posts" | "community_tvs" | "dining_tables",
    w: Where,
    o?: { sort?: string; limit?: number },
  ): Promise<T[]>;
  first<T>(t: "dining_tables" | "community_polls" | "community_votes", w: Where): Promise<T | null>;
  insertOne<T extends Record<string, unknown>>(t: "community_votes", row: T): Promise<T & { id: string }>;
};
export type VoteDeps = {
  db: CommunityDb;
  getHead: (slug: string) => Promise<CommunityHead | null>;
  getContent: (rid: string) => Promise<{ polls: PollRow[]; posts: PostRow[]; tvs: TvRow[] }>;
  now?: () => Date;
  off?: () => boolean;
};
export type VoteResult =
  | { ok: true; option: OptionId }
  | { ok: false; code: "invalid" | "not_found" | "disabled" | "table" | "closed" | "poll" | "too_many" };
// not_found = slug inexistente; invalid = ?antes= que não é o created_at de um post do Mural.
export type PublicRead = { ok: true; state: PublicState } | { ok: false; code: "not_found" | "invalid" };
export type PublicAnswer = { status: 200 | 400 | 404 | 503; body: unknown; cache: string };

// Cache da GET agregada fora do estado: slug inexistente fica 60 s na CDN; erro do banco,
// 5 s (nunca no-store: numa queda do NocoDB, o polling de todo mundo bateria na função).
export const PUBLIC_CACHE_NOT_FOUND = "public, max-age=0, s-maxage=60";
export const PUBLIC_CACHE_ERROR = "public, max-age=0, s-maxage=5";
const NO_STORE = "no-store";

// A agenda em cache guarda as enquetes que terminaram nas últimas 24 h e as futuras.
export const POLL_WINDOW_MS = 24 * 60 * 60_000;
const DEFAULT_TZ = "America/Sao_Paulo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MESA = /^[A-Z2-9]{6}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const OPTION_IDS: readonly OptionId[] = ["a", "b", "c"];
const TEMPLATES: readonly PollTemplate[] = ["dessert", "drink", "music", "custom"];
// "AAAA-MM-DDTHH:MM[:SS[.mmm]]" com fuso; o NocoDB devolve "AAAA-MM-DD HH:MM:SS+00:00".
const ISO_DATE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/;

const isOff = (deps: VoteDeps) => (deps.off ?? communityOff)();

// Sem horário cadastrado (ou escondido), o restaurante conta como aberto, como no pedido.
function isOpen(head: CommunityHead, now: Date): boolean {
  return !head.opening_hours || openStatus(head.opening_hours, head.timezone, now).open;
}

// ---------- Linhas do NocoDB ----------

type Raw = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

// Data do banco em ISO (o Safari antigo não lê "AAAA-MM-DD HH:MM:SS+00:00"); inválida = null.
function isoDate(v: unknown): string | null {
  if (typeof v !== "string" || !ISO_DATE.test(v.trim())) return null;
  const t = Date.parse(v.trim());
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// ?antes= do Mural: só data ISO (ou no formato do NocoDB), devolvida em ISO; senão, null.
export function parseBefore(raw: string): string | null {
  if (raw.length > 40) return null;
  return isoDate(raw);
}

// Linha de restaurants → cabeça da Comunidade. Interruptor vazio = desligada; hora do dia
// vazia ou malformada = "05:00". O horário só vale se aparece no cardápio (show_hours).
export function toHead(r: Raw | null): CommunityHead | null {
  if (!r || !str(r.id) || !str(r.slug)) return null;
  const dayStart = str(r.community_day_start);
  return {
    id: r.id as string,
    slug: r.slug as string,
    name: str(r.name) ?? "",
    enabled: r.community_enabled === true,
    day_start: dayStart && HHMM.test(dayStart) ? dayStart : DAY_START_DEFAULT,
    timezone: str(r.timezone) ?? DEFAULT_TZ,
    opening_hours: r.show_hours === true && Array.isArray(r.opening_hours) ? (r.opening_hours as OpeningHours) : null,
    instagram: str(r.instagram),
    logo_path: str(r.logo_path),
    brand_color: str(r.brand_color),
    tv_simple: r.community_tv_simple === true,
  };
}

function toOptions(v: unknown): PollOption[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((o): o is Raw => !!o && typeof o === "object" && OPTION_IDS.includes((o as Raw).id as OptionId))
    .map((o) => ({ id: o.id as OptionId, label: typeof o.label === "string" ? o.label : "", item_id: str(o.item_id) }));
}

// Coluna JSON que veio em texto (o NocoDB às vezes devolve assim): tenta ler; senão, nada.
function jsonOf(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

// Exportada para a retenção (retention.ts), que grava o result antes de apagar os votos.
export function toPoll(r: Raw | null): PollRow | null {
  if (!r) return null;
  const id = str(r.id);
  const restaurant_id = str(r.restaurant_id);
  const starts_at = isoDate(r.starts_at);
  const ends_at = isoDate(r.ends_at);
  if (!id || !restaurant_id || !starts_at || !ends_at) return null;
  const options = toOptions(r.options);
  // Resultado final gravado pelo cron: só entra se bater com as opções.
  const result = parseResult(jsonOf(r.result), options.map((o) => o.id));
  return {
    id,
    restaurant_id,
    template: TEMPLATES.includes(r.template as PollTemplate) ? (r.template as PollTemplate) : "custom",
    question: typeof r.question === "string" ? r.question : "",
    options,
    starts_at,
    ends_at,
    closed_at: isoDate(r.closed_at),
    created_at: isoDate(r.created_at) ?? starts_at,
    ...(result ? { result } : {}),
  };
}

function toPost(r: Raw): PostRow | null {
  const id = str(r.id);
  const restaurant_id = str(r.restaurant_id);
  const item_id = str(r.item_id);
  const photo_path = str(r.photo_path);
  const thumb_path = str(r.thumb_path);
  const created_at = isoDate(r.created_at);
  if (!id || !restaurant_id || !item_id || !photo_path || !thumb_path || !created_at) return null;
  if (r.status !== "approved" && r.status !== "hidden") return null;
  return {
    id,
    restaurant_id,
    item_id,
    photo_path,
    thumb_path,
    source: "house",
    status: r.status,
    on_tv: r.on_tv === true,
    hidden_at: isoDate(r.hidden_at),
    created_at,
  };
}

// O estado público só precisa de paired_at, last_seen_at e revoked: o hash do segredo e o
// código de pareamento não ficam no cache.
function toTv(r: Raw): TvRow | null {
  const id = str(r.id);
  const restaurant_id = str(r.restaurant_id);
  if (!id || !restaurant_id) return null;
  return {
    id,
    restaurant_id,
    label: str(r.label),
    pair_code: null,
    pair_expires_at: isoDate(r.pair_expires_at),
    secret_hash: "",
    paired_at: isoDate(r.paired_at),
    last_seen_at: isoDate(r.last_seen_at),
    revoked: r.revoked === true,
    created_at: isoDate(r.created_at) ?? "",
  };
}

const keep = <T>(rows: Raw[], map: (r: Raw) => T | null): T[] => rows.map(map).filter((x): x is T => x !== null);

// Linhas do NocoDB → agenda (terminadas há ≤ 24 h ou futuras), posts aprovados e telões.
export function toContent(
  rows: { polls: Raw[]; posts: Raw[]; tvs: Raw[] },
  now: Date,
): { polls: PollRow[]; posts: PostRow[]; tvs: TvRow[] } {
  const since = now.getTime() - POLL_WINDOW_MS;
  return {
    polls: keep(rows.polls, toPoll).filter((p) => Date.parse(p.ends_at) >= since),
    posts: keep(rows.posts, toPost).filter((p) => p.status === "approved"),
    tvs: keep(rows.tvs, toTv),
  };
}

// ---------- Leitura agregada ----------

// Os votos são lidos sem cache, só quando há enquete no Palco (aberta ou encerrada há
// ≤ 15 min), em ordem de gravação. before (?antes= do Mural, já em ISO) só vale se for o
// created_at de um post aprovado deste restaurante no conteúdo em cache: um valor qualquer
// não chega à leitura dos votos. Desligada ou fechada não tem Mural, então before é invalid.
export async function readPublicState(deps: VoteDeps, slug: string, before?: string): Promise<PublicRead> {
  const now = deps.now?.() ?? new Date();
  const paging = before !== undefined;
  if (isOff(deps)) return paging ? { ok: false, code: "invalid" } : { ok: true, state: disabledState(now) };
  const head = await deps.getHead(slug);
  if (!head) return { ok: false, code: "not_found" };
  if (paging && (!head.enabled || !isOpen(head, now))) return { ok: false, code: "invalid" };
  if (!head.enabled) return { ok: true, state: disabledState(now) };
  if (!isOpen(head, now)) {
    return { ok: true, state: buildPublicState({ head, open: false, polls: [], votes: [], posts: [], tvs: [], now }) };
  }

  const { polls, posts, tvs } = await deps.getContent(head.id);
  if (paging) {
    const cut = Date.parse(before);
    const known = posts.some((p) => p.restaurant_id === head.id && p.status === "approved" && Date.parse(p.created_at) === cut);
    if (!known) return { ok: false, code: "invalid" };
  }
  const cur = currentPoll(polls.filter((p) => p.restaurant_id === head.id), now);
  // Com o result gravado (votos da enquete já apagados ou a apagar), nem lê os votos.
  const votes = cur && !cur.result
    ? await deps.db.list<VoteRow>("community_votes", { restaurant_id: head.id, poll_id: cur.id }, { sort: "Id" })
    : [];
  return { ok: true, state: buildPublicState({ head, open: true, polls, votes, posts, tvs, now, before }) };
}

// Resposta da GET agregada (a rota só confere o slug e copia status, corpo e cache).
// rawBefore = ?antes= como veio na URL (null se ausente).
export async function answerPublicRead(deps: VoteDeps, slug: string, rawBefore: string | null): Promise<PublicAnswer> {
  const invalid: PublicAnswer = { status: 400, body: { ok: false, code: "invalid" }, cache: NO_STORE };
  const before = rawBefore === null ? undefined : parseBefore(rawBefore);
  if (before === null) return invalid;
  try {
    const r = await readPublicState(deps, slug, before);
    if (r.ok) return { status: 200, body: r.state, cache: cacheControl(r.state) };
    if (r.code === "invalid") return invalid;
    return { status: 404, body: { ok: false, code: "not_found" }, cache: PUBLIC_CACHE_NOT_FOUND };
  } catch {
    return { status: 503, body: { ok: false, code: "error" }, cache: PUBLIC_CACHE_ERROR };
  }
}

// ---------- Voto ----------

function parseVote(body: unknown): { mesa: string; device: string; poll: string; option: OptionId } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Raw;
  if (typeof b.mesa !== "string" || !MESA.test(b.mesa)) return null;
  if (typeof b.device !== "string" || !UUID.test(b.device)) return null;
  if (typeof b.poll !== "string" || !UUID.test(b.poll)) return null;
  if (typeof b.option !== "string" || !OPTION_IDS.includes(b.option as OptionId)) return null;
  return { mesa: b.mesa, device: b.device, poll: b.poll, option: b.option as OptionId };
}

export async function castVote(deps: VoteDeps, slug: string, body: unknown): Promise<VoteResult> {
  const input = parseVote(body);
  if (!input) return { ok: false, code: "invalid" };
  const now = deps.now?.() ?? new Date();
  if (isOff(deps)) return { ok: false, code: "disabled" };
  const head = await deps.getHead(slug);
  if (!head) return { ok: false, code: "not_found" };
  if (!head.enabled) return { ok: false, code: "disabled" };

  // A mesa é deste restaurante e está ativa agora (mesmo lembrada no celular há horas).
  const table = await deps.db.first<{ id: string; active: boolean }>("dining_tables", { restaurant_id: head.id, code: input.mesa });
  if (!table?.active) return { ok: false, code: "table" };
  if (!isOpen(head, now)) return { ok: false, code: "closed" };

  // A enquete vem do banco, sem o cache da agenda: apagada ou encerrada pela casa há
  // pouco não recebe voto. Aberta só pelo relógio, e a opção tem de existir nela.
  const poll = toPoll(await deps.db.first<Raw>("community_polls", { uid: input.poll, restaurant_id: head.id }));
  if (!poll || pollPhase(poll, now) !== "open") return { ok: false, code: "poll" };
  if (!poll.options.some((o) => o.id === input.option)) return { ok: false, code: "poll" };

  // Uma consulta só: o voto que já vale deste celular e os tetos, na ordem de gravação.
  const votes = await deps.db.list<VoteRow>("community_votes", { restaurant_id: head.id, poll_id: poll.id }, { sort: "Id" });
  const mine = votes.find((v) => v.device_id === input.device);
  if (mine) return { ok: true, option: mine.option_id };

  const counted = effectiveVotes(votes);
  const atTable = counted.filter((v) => v.table_id === table.id).length;
  if (atTable >= VOTE_CAP_PER_TABLE || counted.length >= VOTE_CAP_PER_RESTAURANT) return { ok: false, code: "too_many" };

  await deps.db.insertOne("community_votes", {
    restaurant_id: head.id,
    poll_id: poll.id,
    option_id: input.option,
    device_id: input.device,
    table_id: table.id,
  });
  return { ok: true, option: input.option };
}
