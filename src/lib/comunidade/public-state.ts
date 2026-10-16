// Estado público da Comunidade: a resposta única, igual para todo mundo, que a CDN serve
// ao celular e ao telão. Montado campo a campo, para nunca levar contagem de votos,
// device_id, table_id, post oculto nem dado do telão além do "tem telão".
import { communityDay, currentPoll, dayBounds, nextPoll, pollPhase } from "./clock";
import { effectiveVotes, percentages } from "./tally";
import type { CommunityHead, OptionId, PollOption, PollRow, PostRow, PublicPoll, PublicPost, PublicState, TvRow, VoteRow } from "./types";

export const MURAL_PAGE = 20;
// "No telão": há um telão pareado que consultou o estado há menos de 10 min.
export const TV_FRESH_MS = 10 * 60_000;

const CACHE_OPEN_POLL = "public, max-age=0, s-maxage=4, stale-while-revalidate=4";
const CACHE_IDLE = "public, max-age=0, s-maxage=30, stale-while-revalidate=30";
const CACHE_OFF = "public, max-age=0, s-maxage=60";

const OPTION_IDS: readonly OptionId[] = ["a", "b", "c"];
const ms = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);

// FNV-1a de 32 bits, em 8 dígitos hexadecimais.
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// O v é o hash do conteúdo sem now e sem o próprio v: muda quando algo visível muda.
function withV(s: Omit<PublicState, "v">): PublicState {
  const { now, ...content } = s;
  return { v: fnv1a(JSON.stringify(content)), ...content, now };
}

function emptyState(now: Date, enabled: boolean): PublicState {
  return withV({ enabled, open: false, now: now.toISOString(), poll: null, next: null, mural: [], has_tv: false, instagram: null });
}

export function disabledState(now: Date): PublicState {
  return emptyState(now, false);
}

// Opções válidas (a, b ou c, sem repetir), na ordem da casa. O JSON vem do banco.
function cleanOptions(p: PollRow): PollOption[] {
  const seen = new Set<OptionId>();
  const list = Array.isArray(p.options) ? p.options : [];
  return list.filter((o) => {
    if (!o || !OPTION_IDS.includes(o.id) || seen.has(o.id)) return false;
    seen.add(o.id);
    return true;
  });
}

// Exportada para o cartão do story (story.ts), que mostra a mesma porcentagem do Palco.
export function publicPoll(p: PollRow, votes: VoteRow[], now: Date): PublicPoll {
  const options = cleanOptions(p);
  const ids = options.map((o) => o.id);
  const valid = votes.filter((v) => v.poll_id === p.id && ids.includes(v.option_id));
  const counted = effectiveVotes(valid);
  const pct = percentages(counted, ids);
  const closed = pollPhase(p, now) === "closed";
  const has_votes = counted.length > 0;
  // Vence a maior contagem efetiva (nunca a porcentagem já arredondada: com 101 votos,
  // 50 e 51 dão 50% e 50%). No empate de contagem, a primeira opção. Sem votos não há
  // vencedora. Como o maior resto é monotônico, ela também tem a maior porcentagem.
  let winner: OptionId | null = null;
  if (closed && has_votes) {
    const counts = ids.map((id) => counted.filter((v) => v.option_id === id).length);
    let best = -1;
    for (let i = 0; i < ids.length; i++) {
      if (counts[i] > best) {
        best = counts[i];
        winner = ids[i];
      }
    }
  }
  return {
    id: p.id,
    template: p.template,
    question: p.question,
    options: options.map((o) => ({ id: o.id, label: o.label, item_id: o.item_id ?? null, pct: pct[o.id] })),
    starts_at: p.starts_at,
    ends_at: p.ends_at,
    closed,
    has_votes,
    winner,
  };
}

function publicPost(p: PostRow): PublicPost {
  return { id: p.id, item_id: p.item_id, thumb: p.thumb_path, photo: p.photo_path, on_tv: p.on_tv === true, created_at: p.created_at };
}

// Até 20 posts aprovados, do mais novo ao mais velho; com before, só os mais velhos que ele.
function mural(posts: PostRow[], before: string | undefined): PublicPost[] {
  const cut = ms(before);
  return posts
    .filter((p) => p.status === "approved" && Number.isFinite(ms(p.created_at)))
    .filter((p) => !Number.isFinite(cut) || ms(p.created_at) < cut)
    .sort((a, b) => ms(b.created_at) - ms(a.created_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .slice(0, MURAL_PAGE)
    .map(publicPost);
}

function hasTv(tvs: TvRow[], now: Date): boolean {
  const t = now.getTime();
  return tvs.some((tv) => !tv.revoked && !!tv.paired_at && t - ms(tv.last_seen_at) < TV_FRESH_MS);
}

export function buildPublicState(i: {
  head: CommunityHead;
  open: boolean;
  polls: PollRow[];
  votes: VoteRow[];
  posts: PostRow[];
  tvs: TvRow[];
  now: Date;
  before?: string;
}): PublicState {
  const { head, now } = i;
  if (!head.enabled) return disabledState(now);
  if (!i.open) return emptyState(now, true);

  // Isolamento: mesmo que o chamador erre o filtro, nada de outro restaurante entra.
  const mine = <T extends { restaurant_id: string }>(rows: T[]) => rows.filter((r) => r.restaurant_id === head.id);
  const polls = mine(i.polls);
  const cur = currentPoll(polls, now);
  const poll = cur ? publicPoll(cur, mine(i.votes), now) : null;

  // "Próxima enquete às 21h" só faz sentido no mesmo dia da Comunidade.
  const { to } = dayBounds(communityDay(now, head.timezone, head.day_start), head.timezone, head.day_start);
  const nx = nextPoll(polls.filter((p) => ms(p.starts_at) < to.getTime()), now);

  return withV({
    enabled: true,
    open: true,
    now: now.toISOString(),
    poll,
    next: nx ? { starts_at: nx.starts_at, template: nx.template, question: nx.question } : null,
    mural: mural(mine(i.posts), i.before),
    has_tv: hasTv(mine(i.tvs), now),
    instagram: head.instagram ?? null,
  });
}

// Com enquete aberta, 4 s de CDN; sem, 30 s; desligada ou fora do horário, 60 s.
export function cacheControl(s: PublicState): string {
  if (!s.enabled || !s.open) return CACHE_OFF;
  return s.poll && !s.poll.closed ? CACHE_OPEN_POLL : CACHE_IDLE;
}
