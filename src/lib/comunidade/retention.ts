// Retenção diária da Comunidade (cron em /api/cron/comunidade, 06h em São Paulo).
// - votos: 1 dia só, renova toda manhã (Decisão do João, 16/10). Sai todo voto criado antes
//   do início do dia da Comunidade atual (day_start no fuso do restaurante, padrão 05:00).
//   Antes, o resultado final da enquete encerrada vai para community_polls.result, que o
//   estado público e o story passam a usar. Voto de enquete ainda aberta fica até ela encerrar;
// - tally (funil) com mais de 90 dias;
// - fotos da casa ocultadas há mais de 7 dias (arquivo e linha); post approved nunca sai;
// - TVs pendentes (sem paired_at) com o código vencido.
// Vale para todo restaurante, com a Comunidade ligada ou não (ver runRetention).
// O plano é puro e testado; a varredura recebe o banco e o armazenamento de fora.
// Data vazia ou ilegível nunca conta como vencida: na dúvida, a linha fica.
import { createHash, timingSafeEqual } from "node:crypto";
import { DAY_START_DEFAULT, communityDay, dayBounds, pollPhase } from "./clock";
import { pollResult } from "./public-state";
import type { PollResult, PollRow, PostRow, TallyRow, TvRow, VoteRow } from "./types";
import { toHead, toPoll } from "./votes";

const DAY_MS = 24 * 60 * 60_000;
const DEFAULT_TZ = "America/Sao_Paulo";
export const TALLY_RETENTION_MS = 90 * DAY_MS;
export const HIDDEN_POST_RETENTION_MS = 7 * DAY_MS;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// "AAAA-MM-DDTHH:MM[:SS[.mmm]]" com fuso; o NocoDB devolve "AAAA-MM-DD HH:MM:SS+00:00".
const ISO_DATE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/;

// Data do banco em ms; vazia ou ilegível = NaN (e NaN nunca passa nas comparações abaixo).
function ms(v: unknown): number {
  if (typeof v !== "string" || !ISO_DATE.test(v.trim())) return NaN;
  return Date.parse(v.trim().replace(" ", "T"));
}

// Relógio de cada restaurante (fuso e hora em que o dia da Comunidade vira).
export type RestaurantClock = { id: string; timezone: string; day_start: string };
export type RetentionInput = {
  votes: VoteRow[];
  tallies: TallyRow[];
  posts: PostRow[];
  tvs: TvRow[];
  now: Date;
  polls?: PollRow[];
  clocks?: RestaurantClock[];
};
export type RetentionPlan = {
  votes: string[];
  results: { poll_id: string; result: PollResult }[];
  tallies: string[];
  posts: PostRow[];
  tvs: string[];
};

// Início do dia da Comunidade atual de cada restaurante; sem relógio conhecido (restaurante
// apagado), 05:00 em São Paulo.
function dayStartOf(clocks: RestaurantClock[], now: Date): (rid: string) => number {
  const memo = new Map<string, number>();
  const byId = new Map(clocks.map((c) => [c.id, c]));
  return (rid) => {
    let from = memo.get(rid);
    if (from === undefined) {
      const c = byId.get(rid);
      const tz = c?.timezone || DEFAULT_TZ;
      const ds = c?.day_start || DAY_START_DEFAULT;
      try {
        from = dayBounds(communityDay(now, tz, ds), tz, ds).from.getTime();
      } catch {
        from = dayBounds(communityDay(now, DEFAULT_TZ, DAY_START_DEFAULT), DEFAULT_TZ, DAY_START_DEFAULT).from.getTime();
      }
      memo.set(rid, from);
    }
    return from;
  };
}

// Os ids (uid) a apagar e os resultados a gravar antes. "Mais de N dias" é estrito: com
// exatamente N dias, ainda fica. TV pendente revogada fica: a marca de revogada é o que
// recusa aquele segredo de novo.
// Votos: sai o criado antes da virada do dia do restaurante dele (na virada exata, fica).
// A enquete do voto (mesmo id e restaurante) decide: aberta ou agendada, o voto fica;
// encerrada sem result, grava o result contado com todos os votos dela (os de depois da
// virada também); apagada, o voto sai sem result.
export function retentionPlan(i: RetentionInput): RetentionPlan {
  const now = i.now.getTime();
  const olderThan = (v: unknown, max: number) => now - ms(v) > max;
  const dayFrom = dayStartOf(i.clocks ?? [], i.now);
  const polls = new Map((i.polls ?? []).map((p) => [p.id, p]));
  const pollOf = (v: VoteRow) => {
    const p = polls.get(v.poll_id);
    return p && p.restaurant_id === v.restaurant_id ? p : null;
  };

  const votes: string[] = [];
  const needResult = new Map<string, PollRow>();
  for (const v of i.votes) {
    if (!(ms(v.created_at) < dayFrom(v.restaurant_id))) continue;
    const p = pollOf(v);
    if (p && pollPhase(p, i.now) !== "closed") continue;
    if (p && !p.result) needResult.set(p.id, p);
    votes.push(v.id);
  }
  const results = [...needResult.values()].map((p) => ({
    poll_id: p.id,
    result: pollResult(p, i.votes.filter((v) => v.restaurant_id === p.restaurant_id)),
  }));

  return {
    votes,
    results,
    tallies: i.tallies.filter((t) => olderThan(t.created_at, TALLY_RETENTION_MS)).map((t) => t.id),
    posts: i.posts.filter((p) => p.status === "hidden" && olderThan(p.hidden_at, HIDDEN_POST_RETENTION_MS)),
    tvs: i.tvs
      .filter((t) => !t.paired_at && t.revoked !== true && ms(t.pair_expires_at) <= now)
      .map((t) => t.id),
  };
}

// ---------- Senha do cron ----------

// A Vercel chama o cron com "authorization: Bearer <CRON_SECRET>". Sem a variável (ou
// vazia), a rota nunca roda aberta. Compara os SHA-256 em tempo constante.
export function cronAuth(header: string | null, secret: string | undefined): "ok" | "no_secret" | "denied" {
  if (!secret || !secret.trim()) return "no_secret";
  if (typeof header !== "string") return "denied";
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`)) ? "ok" : "denied";
}

// ---------- Varredura ----------

type Where = Record<string, string | number | boolean | null>;
type RetentionTable = "community_votes" | "community_tally" | "community_posts" | "community_tvs";
export type RetentionDb = {
  list<T>(t: RetentionTable | "community_polls" | "restaurants", w: Where): Promise<T[]>;
  removeIds(t: RetentionTable, ids: number[]): Promise<void>;
  updateRows(t: "community_polls", rows: ({ Id: number } & Record<string, unknown>)[]): Promise<void>;
};
export type RetentionDeps = {
  db: RetentionDb;
  // Tem de lançar quando o arquivo não saiu (a rota passa removeFilesStrict): é o que segura
  // a linha da foto para a próxima rodada.
  removeFiles: (paths: string[]) => Promise<void>;
  ownsFile: (restaurantId: string, path: string) => boolean;
  now?: () => Date;
  // Chamado para cada restaurante que ganhou result: o conteúdo em cache (agenda) passa a
  // trazer o result logo, e não só no fim do revalidate.
  revalidate?: (restaurantId: string) => void;
};
export type RetentionReport = {
  failed: number;
  deleted: { votes: number; tallies: number; posts: number; tvs: number };
};

type Raw = Record<string, unknown> & { Id: number; id: string };
const NONE = { votes: [], tallies: [], posts: [], tvs: [] };
type Raw0 = Record<string, unknown>;

// Linhas com o uid e o Id do NocoDB (é por ele que se apaga); o resto é descartado.
async function rowsOf<T>(d: RetentionDeps, t: RetentionTable | "community_polls", w: Where = {}): Promise<(T & Raw)[]> {
  const rows = await d.db.list<Record<string, unknown>>(t, w);
  return rows.filter(
    (r): r is T & Raw => typeof r.id === "string" && !!r.id && typeof r.Id === "number" && Number.isInteger(r.Id),
  );
}

const idsOf = (rows: Raw[], uids: string[]) => {
  const gone = new Set(uids);
  return rows.filter((r) => gone.has(r.id)).map((r) => r.Id);
};

// Votos, tally e TVs: uma consulta pela tabela inteira, o plano e um removeIds (que o
// nocodb.ts manda em lotes de 100).
async function sweep<T>(d: RetentionDeps, t: RetentionTable, pick: (rows: (T & Raw)[]) => string[]): Promise<number> {
  const rows = await rowsOf<T>(d, t);
  const ids = idsOf(rows, pick(rows));
  if (ids.length) await d.db.removeIds(t, ids);
  return ids.length;
}

// Votos: lê os votos; havendo algum, as enquetes (para o result) e os restaurantes (para a
// virada do dia de cada um). Grava os results num lote antes de apagar: se a gravação
// falhar, os votos dessas enquetes ficam para a próxima rodada e os outros saem.
async function sweepVotes(d: RetentionDeps, now: Date, fail: (what: string, e: unknown) => void): Promise<number> {
  const votes = await rowsOf<VoteRow>(d, "community_votes");
  if (!votes.length) return 0;
  const pollRows = await rowsOf<PollRow>(d, "community_polls");
  const restaurants = await d.db.list<Raw0>("restaurants", {});
  const polls = pollRows.flatMap((r) => {
    const p = toPoll(r);
    return p ? [{ ...p, Id: r.Id }] : [];
  });
  const clocks = restaurants.flatMap((r) => {
    const h = toHead(r);
    return h ? [{ id: h.id, timezone: h.timezone, day_start: h.day_start }] : [];
  });
  const plan = retentionPlan({ ...NONE, votes, polls, clocks, now });
  let gone = new Set(plan.votes);
  if (plan.results.length) {
    const byId = new Map(polls.map((p) => [p.id, p]));
    try {
      await d.db.updateRows(
        "community_polls",
        plan.results.map((r) => ({ Id: byId.get(r.poll_id)!.Id, result: r.result })),
      );
      for (const rid of new Set(plan.results.map((r) => byId.get(r.poll_id)!.restaurant_id))) d.revalidate?.(rid);
    } catch (e) {
      fail("resultado das enquetes", e);
      const held = new Set(plan.results.map((r) => r.poll_id));
      gone = new Set(votes.filter((v) => gone.has(v.id) && !held.has(v.poll_id)).map((v) => v.id));
    }
  }
  const ids = idsOf(votes, [...gone]);
  if (ids.length) await d.db.removeIds("community_votes", ids);
  return ids.length;
}

// Fotos da casa ocultas, agrupadas pelo restaurante da própria linha. Arquivo primeiro: se
// o NocoDB falhar depois, a linha oculta fica e a próxima rodada tenta de novo; ao
// contrário, sobraria um arquivo que ninguém mais acha. Só arquivo da pasta do restaurante
// da linha vai para o removeFiles; restaurant_id que não é uuid não remove arquivo nenhum
// (com id vazio, o ownsFile aceitaria qualquer caminho começado por "/"), mas a linha sai.
// Um restaurante cujo armazenamento falha não segura os outros.
async function sweepPosts(d: RetentionDeps, now: Date, fail: (what: string, e: unknown) => void): Promise<number> {
  const rows = await rowsOf<PostRow>(d, "community_posts", { status: "hidden" });
  const gone = new Set(retentionPlan({ ...NONE, posts: rows, now }).posts.map((p) => p.id));
  const byRestaurant = new Map<string, (PostRow & Raw)[]>();
  for (const p of rows) {
    if (!gone.has(p.id)) continue;
    const rid = typeof p.restaurant_id === "string" ? p.restaurant_id : "";
    byRestaurant.set(rid, [...(byRestaurant.get(rid) ?? []), p]);
  }
  let deleted = 0;
  for (const [rid, posts] of byRestaurant) {
    const valid = UUID.test(rid);
    try {
      const files = valid
        ? posts
            .flatMap((p) => [p.photo_path, p.thumb_path])
            .filter((p): p is string => typeof p === "string" && !!p && d.ownsFile(rid, p))
        : [];
      if (files.length) await d.removeFiles(files);
      await d.db.removeIds("community_posts", posts.map((p) => p.Id));
      deleted += posts.length;
    } catch (e) {
      fail(`fotos da casa do restaurante ${valid ? rid : "sem id válido"}`, e);
    }
  }
  return deleted;
}

// Varre cada tabela da Comunidade inteira, uma vez: o prazo vale para todo dado já
// coletado, inclusive de restaurante que desligou a Comunidade ou nem existe mais (spec,
// Privacidade: "o voto é anônimo e apagado toda manhã"). São 4 consultas, mais enquetes e
// restaurantes quando há voto (e as páginas de 1.000), qualquer que seja o número de
// restaurantes, o que cabe no limite de pedidos por segundo do NocoDB. Uma tabela que falha
// não para as outras e conta em failed. Só o result gravado invalida cache (revalidate):
// post oculto, TV pendente e votos não estão na leitura pública em cache.
export async function runRetention(d: RetentionDeps): Promise<RetentionReport> {
  const now = d.now?.() ?? new Date();
  const report: RetentionReport = { failed: 0, deleted: { votes: 0, tallies: 0, posts: 0, tvs: 0 } };
  const fail = (what: string, e: unknown) => {
    report.failed++;
    console.error(`retenção da Comunidade: ${what}:`, e instanceof Error ? e.message : e);
  };
  const step = async (what: string, key: keyof RetentionReport["deleted"], run: () => Promise<number>) => {
    try {
      report.deleted[key] = await run();
    } catch (e) {
      fail(what, e);
    }
  };
  await step("votos", "votes", () => sweepVotes(d, now, fail));
  await step("tally", "tallies", () =>
    sweep<TallyRow>(d, "community_tally", (tallies) => retentionPlan({ ...NONE, tallies, now }).tallies),
  );
  await step("fotos da casa", "posts", () => sweepPosts(d, now, fail));
  await step("telões pendentes", "tvs", () => sweep<TvRow>(d, "community_tvs", (tvs) => retentionPlan({ ...NONE, tvs, now }).tvs));
  return report;
}
