// Retenção diária da Comunidade (cron em /api/cron/comunidade, 06h em São Paulo).
// - votos com mais de 30 dias;
// - tally (funil) com mais de 90 dias;
// - fotos da casa ocultadas há mais de 7 dias (arquivo e linha); post approved nunca sai;
// - TVs pendentes (sem paired_at) com o código vencido.
// Vale para todo restaurante, com a Comunidade ligada ou não (ver runRetention).
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
  list<T>(t: RetentionTable, w: Where): Promise<T[]>;
  removeIds(t: RetentionTable, ids: number[]): Promise<void>;
};
export type RetentionDeps = {
  db: RetentionDb;
  removeFiles: (paths: string[]) => Promise<void>;
  ownsFile: (restaurantId: string, path: string) => boolean;
  now?: () => Date;
};
export type RetentionReport = {
  failed: number;
  deleted: { votes: number; tallies: number; posts: number; tvs: number };
};

type Raw = Record<string, unknown> & { Id: number; id: string };
const NONE = { votes: [], tallies: [], posts: [], tvs: [] };

// Linhas com o uid e o Id do NocoDB (é por ele que se apaga); o resto é descartado.
async function rowsOf<T>(d: RetentionDeps, t: RetentionTable, w: Where = {}): Promise<(T & Raw)[]> {
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

// Varre cada tabela da Comunidade inteira, uma vez, sem passar pela lista de restaurantes:
// o prazo vale para todo dado já coletado, inclusive de restaurante que desligou a
// Comunidade ou nem existe mais (spec, Privacidade: "o voto é anônimo e apagado em 30
// dias"). São 4 consultas (mais as páginas de 1.000), qualquer que seja o número de
// restaurantes, o que cabe no limite de pedidos por segundo do NocoDB. Uma tabela que falha
// não para as outras e conta em failed. Nada aqui invalida cache: post oculto, TV pendente
// e votos antigos não estão na leitura pública.
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
  await step("votos", "votes", () => sweep<VoteRow>(d, "community_votes", (votes) => retentionPlan({ ...NONE, votes, now }).votes));
  await step("tally", "tallies", () =>
    sweep<TallyRow>(d, "community_tally", (tallies) => retentionPlan({ ...NONE, tallies, now }).tallies),
  );
  await step("fotos da casa", "posts", () => sweepPosts(d, now, fail));
  await step("telões pendentes", "tvs", () => sweep<TvRow>(d, "community_tvs", (tvs) => retentionPlan({ ...NONE, tvs, now }).tvs));
  return report;
}
