// Retenção diária da Comunidade (cron em /api/cron/comunidade, 06h em São Paulo).
// - votos com mais de 30 dias;
// - tally (funil) com mais de 90 dias;
// - fotos da casa ocultadas há mais de 7 dias (arquivo e linha); post approved nunca sai;
// - TVs pendentes (sem paired_at) com o código vencido.
// O plano é puro e testado; a varredura recebe o banco e o armazenamento de fora.
// Data vazia ou ilegível nunca conta como vencida: na dúvida, a linha fica.
import { createHash, timingSafeEqual } from "node:crypto";
import type { PostRow, TallyRow, TvRow, VoteRow } from "./types";

const DAY_MS = 24 * 60 * 60_000;
export const VOTE_RETENTION_MS = 30 * DAY_MS;
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

export type RetentionInput = { votes: VoteRow[]; tallies: TallyRow[]; posts: PostRow[]; tvs: TvRow[]; now: Date };
export type RetentionPlan = { votes: string[]; tallies: string[]; posts: PostRow[]; tvs: string[] };

// Os ids (uid) a apagar. "Mais de N dias" é estrito: com exatamente N dias, ainda fica.
// TV pendente revogada fica: a marca de revogada é o que recusa aquele segredo de novo.
export function retentionPlan(i: RetentionInput): RetentionPlan {
  const now = i.now.getTime();
  const olderThan = (v: unknown, max: number) => now - ms(v) > max;
  return {
    votes: i.votes.filter((v) => olderThan(v.created_at, VOTE_RETENTION_MS)).map((v) => v.id),
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
  list<T>(t: RetentionTable | "restaurants", w: Where): Promise<T[]>;
  removeIds(t: RetentionTable, ids: number[]): Promise<void>;
};
export type RetentionDeps = {
  db: RetentionDb;
  removeFiles: (paths: string[]) => Promise<void>;
  ownsFile: (restaurantId: string, path: string) => boolean;
  now?: () => Date;
};
export type RetentionReport = {
  restaurants: number;
  failed: number;
  deleted: { votes: number; tallies: number; posts: number; tvs: number };
};

type Raw = Record<string, unknown> & { Id: number; id: string };

// Linhas do restaurante, conferidas de novo aqui além do filtro do banco, com o Id do
// NocoDB (é por ele que se apaga).
async function rowsOf<T>(d: RetentionDeps, t: RetentionTable, w: Where & { restaurant_id: string }): Promise<(T & Raw)[]> {
  const rows = await d.db.list<Record<string, unknown>>(t, w);
  return rows.filter(
    (r): r is T & Raw =>
      r.restaurant_id === w.restaurant_id && typeof r.id === "string" && !!r.id && typeof r.Id === "number" && Number.isInteger(r.Id),
  );
}

const idsOf = (rows: Raw[], uids: string[]) => {
  const gone = new Set(uids);
  return rows.filter((r) => gone.has(r.id)).map((r) => r.Id);
};

async function sweepRestaurant(d: RetentionDeps, rid: string, now: Date): Promise<RetentionReport["deleted"]> {
  const mine = { restaurant_id: rid };
  const votes = await rowsOf<VoteRow>(d, "community_votes", mine);
  const tallies = await rowsOf<TallyRow>(d, "community_tally", mine);
  const posts = await rowsOf<PostRow>(d, "community_posts", { ...mine, status: "hidden" });
  const tvs = await rowsOf<TvRow>(d, "community_tvs", mine);
  const plan = retentionPlan({ votes, tallies, posts, tvs, now });

  // Fotos primeiro: se o NocoDB falhar depois, a linha oculta fica e a próxima rodada tenta
  // de novo; ao contrário, sobraria um arquivo que ninguém mais acha. Só arquivo da pasta
  // do restaurante vai para o removeFiles.
  const files = plan.posts
    .flatMap((p) => [p.photo_path, p.thumb_path])
    .filter((p): p is string => typeof p === "string" && !!p && d.ownsFile(rid, p));
  if (files.length) await d.removeFiles(files);

  const postIds = idsOf(posts, plan.posts.map((p) => p.id));
  const voteIds = idsOf(votes, plan.votes);
  const tallyIds = idsOf(tallies, plan.tallies);
  const tvIds = idsOf(tvs, plan.tvs);
  if (postIds.length) await d.db.removeIds("community_posts", postIds);
  if (voteIds.length) await d.db.removeIds("community_votes", voteIds);
  if (tallyIds.length) await d.db.removeIds("community_tally", tallyIds);
  if (tvIds.length) await d.db.removeIds("community_tvs", tvIds);
  return { votes: voteIds.length, tallies: tallyIds.length, posts: postIds.length, tvs: tvIds.length };
}

// Percorre os restaurantes com a Comunidade ligada, um de cada vez (o NocoDB aceita poucos
// pedidos por segundo). Um restaurante que falha não para os outros e conta em failed.
// Nada aqui invalida cache: post oculto, TV pendente e votos antigos não estão na leitura
// pública.
export async function runRetention(d: RetentionDeps): Promise<RetentionReport> {
  const now = d.now?.() ?? new Date();
  const rests = await d.db.list<Record<string, unknown>>("restaurants", { community_enabled: true });
  const report: RetentionReport = { restaurants: 0, failed: 0, deleted: { votes: 0, tallies: 0, posts: 0, tvs: 0 } };
  for (const r of rests) {
    const rid = r.id;
    if (typeof rid !== "string" || !UUID.test(rid)) continue;
    report.restaurants++;
    try {
      const n = await sweepRestaurant(d, rid, now);
      report.deleted.votes += n.votes;
      report.deleted.tallies += n.tallies;
      report.deleted.posts += n.posts;
      report.deleted.tvs += n.tvs;
    } catch (e) {
      report.failed++;
      console.error(`retenção da Comunidade: restaurante ${rid}:`, e instanceof Error ? e.message : e);
    }
  }
  return report;
}
