// Telão da Comunidade: pareamento sem token trafegando.
// 1. A TV gera um segredo de 32 bytes (64 hex), guarda no localStorage e manda só o
//    SHA-256 dele ao pedir o código (requestPairCode). O hash é do texto hex do segredo.
// 2. O membro digita o código no painel; a Server Action confere a sessão e chama
//    confirmPair com o restaurante dela.
// 3. A TV prova que é ela mandando o segredo no cabeçalho x-telao (checkTv): o servidor
//    calcula o hash e procura a linha daquele restaurante.
// O banco só guarda o hash. O segredo nunca vira cookie e nenhuma rota do painel o aceita.
// Funções puras, com o banco, a cabeça e o relógio vindos de fora (molde de votes.ts);
// sem nada server-only, para a página do telão poder usar sha256Hex.
import type { CommunityHead } from "./types";
import { communityOff } from "./off";

// O código vale 10 min. Cada IP pede no máximo 5 por hora em cada restaurante (limitador
// em memória na rota) e cada restaurante tem no máximo 20 códigos vivos ao mesmo tempo
// (conferido aqui, no banco, antes e depois de gravar).
export const PAIR_CODE_TTL_MS = 10 * 60_000;
export const PAIR_CODES_PER_HOUR = 5;
export const PAIR_CODES_LIVE_MAX = 20;
const LABEL_MAX = 40;

const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODE = /^[A-Z2-9]{6}$/;
// Sem I nem O, que na TV se confundem com 1 e 0. São 32 símbolos: um byte & 31 sorteia sem viés.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type Where = Record<string, string | number | boolean | null>;
export type TvDb = {
  list<T>(t: "community_tvs", w: Where): Promise<T[]>;
  first<T>(t: "community_tvs", w: Where): Promise<T | null>;
  insertOne<T extends Record<string, unknown>>(t: "community_tvs", r: T): Promise<T & { id: string }>;
  update(t: "community_tvs", w: Where, p: Record<string, unknown>): Promise<number>;
  remove(t: "community_tvs", w: Where): Promise<number>;
};
export type TvDeps = {
  db: TvDb;
  getHead: (slug: string) => Promise<CommunityHead | null>;
  now?: () => Date;
  code?: () => string;
  off?: () => boolean; // chave geral (COMMUNITY_OFF=1); padrão: lê o ambiente
};

// created: true = gravou um código novo agora; false = devolveu o código vivo desta TV
// (pedido repetido, recarga). A rota só gasta o limite por IP quando created é true.
export type PairCodeResult =
  | { ok: true; code: string; expires_at: string; created: boolean }
  | { ok: false; code: "invalid" | "not_found" | "disabled" | "too_many" };
export type ConfirmResult = { ok: true } | { ok: false; error: string };
// simple: o modo simples do painel, só para a TV já pareada.
export type CheckResult = { ok: true; paired: true; simple: boolean } | { ok: true; paired: false } | { ok: false; status: 401 | 404 };

// Mensagens do painel (quem lê é o membro da casa).
const ERR_OFF = "A Comunidade está desligada no momento.";
const ERR_CODE = "Código não encontrado. Confira os 6 caracteres que aparecem na TV.";
const ERR_EXPIRED = "Esse código venceu. Use o código novo que aparece na TV.";

// SHA-256 em hex minúsculo, pelo WebCrypto (Node e navegador).
export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Código curto que a TV mostra: 6 caracteres de [A-Z2-9], sorteados com getRandomValues.
export function randomPairCode(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_ALPHABET[b & 31]).join("");
}

// ---------- Linhas do NocoDB ----------

type Raw = Record<string, unknown>;
type TvLine = {
  Id: number; // Id numérico do NocoDB (ordem de gravação); NaN se não veio
  id: string;
  restaurant_id: string;
  pair_code: string | null;
  expires: number; // NaN = sem prazo
  secret_hash: string;
  paired: number; // NaN = ainda não pareada
  revoked: boolean;
};

// O NocoDB devolve "AAAA-MM-DD HH:MM:SS+00:00"; o T no lugar do espaço vale em qualquer motor.
const ms = (v: unknown) => (typeof v === "string" && v.trim() ? Date.parse(v.trim().replace(" ", "T")) : NaN);
const iso = (t: number) => new Date(t).toISOString();

function toLine(r: Raw): TvLine | null {
  if (typeof r.id !== "string" || !r.id || typeof r.restaurant_id !== "string" || !r.restaurant_id) return null;
  return {
    Id: typeof r.Id === "number" && Number.isFinite(r.Id) ? r.Id : NaN,
    id: r.id,
    restaurant_id: r.restaurant_id,
    pair_code: typeof r.pair_code === "string" && r.pair_code ? r.pair_code : null,
    expires: ms(r.pair_expires_at),
    secret_hash: typeof r.secret_hash === "string" ? r.secret_hash : "",
    paired: ms(r.paired_at),
    revoked: r.revoked === true,
  };
}

// Só as linhas do restaurante pedido, conferido de novo aqui além do filtro do banco.
async function lines(db: Pick<TvDb, "list">, w: Where & { restaurant_id: string }): Promise<TvLine[]> {
  const rows = await db.list<Raw>("community_tvs", w);
  return rows.map(toLine).filter((l): l is TvLine => !!l && l.restaurant_id === w.restaurant_id);
}

const isPaired = (l: TvLine) => Number.isFinite(l.paired);
// Código ocupando lugar no teto: com código, no prazo e ainda não pareada (revogada ou não).
const holdsCode = (l: TvLine, now: number) => !!l.pair_code && !isPaired(l) && l.expires > now;
// Pendente com código no prazo e não revogada: a única que o painel pode parear.
const isLive = (l: TvLine, now: number) => holdsCode(l, now) && !l.revoked;
// Ordem de gravação pelo Id do NocoDB; sem Id vai para o fim, e o uid desempata.
const byId = (a: TvLine, b: TvLine) =>
  (Number.isFinite(a.Id) ? a.Id : Infinity) - (Number.isFinite(b.Id) ? b.Id : Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const isOff = (d: TvDeps) => (d.off ?? communityOff)();
const nowMs = (d: TvDeps) => (d.now?.() ?? new Date()).getTime();

// ---------- Código para a TV ----------

function parseHash(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const hash = (body as Raw).hash;
  return typeof hash === "string" && HEX64.test(hash) ? hash : null;
}

// Corpo { hash }: o SHA-256 do segredo da TV. Grava uma linha pendente no restaurante do
// slug. A mesma TV pedindo de novo com o código ainda no prazo (recarregou a página)
// recebe o mesmo código, sem gravar nem gastar o teto. Hash de uma linha revogada deste
// restaurante é recusado (invalid): a TV tem de gerar um segredo novo.
// Teto: 20 códigos vivos por restaurante. Sem transação no NocoDB, a conta é refeita
// depois de gravar: se a corrida passou do teto, ficam as 20 linhas de menor Id e esta
// apaga a própria linha.
export async function requestPairCode(d: TvDeps, slug: string, body: unknown): Promise<PairCodeResult> {
  const hash = parseHash(body);
  if (!hash) return { ok: false, code: "invalid" };
  if (isOff(d)) return { ok: false, code: "disabled" };
  const head = await d.getHead(slug);
  if (!head) return { ok: false, code: "not_found" };
  if (!head.enabled) return { ok: false, code: "disabled" };

  const now = nowMs(d);
  const all = await lines(d.db, { restaurant_id: head.id });
  if (all.some((l) => l.secret_hash === hash && l.revoked)) return { ok: false, code: "invalid" };
  const live = all.filter((l) => isLive(l, now));
  const mine = live.filter((l) => l.secret_hash === hash).sort((a, b) => b.expires - a.expires)[0];
  if (mine?.pair_code) return { ok: true, code: mine.pair_code, expires_at: iso(mine.expires), created: false };

  if (all.filter((l) => holdsCode(l, now)).length >= PAIR_CODES_LIVE_MAX) return { ok: false, code: "too_many" };

  // Um código que ainda vale em outra TV do restaurante não se repete.
  const taken = new Set(live.map((l) => l.pair_code));
  const gen = d.code ?? randomPairCode;
  let code = gen();
  for (let i = 0; i < 5 && taken.has(code); i++) code = gen();
  if (!CODE.test(code) || taken.has(code)) throw new Error("telão: não saiu um código livre");

  // Em segundos inteiros, que é o que o NocoDB guarda: a TV recebe o mesmo prazo de novo.
  const expires_at = iso(Math.floor((now + PAIR_CODE_TTL_MS) / 1000) * 1000);
  const row = await d.db.insertOne("community_tvs", {
    restaurant_id: head.id,
    secret_hash: hash,
    pair_code: code,
    pair_expires_at: expires_at,
    revoked: false,
    created_at: iso(now),
  });

  // Recontagem: entre a leitura e a gravação, outras TVs podem ter gravado também.
  const held = (await lines(d.db, { restaurant_id: head.id })).filter((l) => holdsCode(l, now)).sort(byId);
  const rank = held.findIndex((l) => l.id === row.id);
  if (rank < 0 || rank >= PAIR_CODES_LIVE_MAX) {
    await d.db.remove("community_tvs", { uid: row.id, restaurant_id: head.id });
    return { ok: false, code: "too_many" };
  }
  return { ok: true, code, expires_at, created: true };
}

// ---------- Pareamento pelo painel ----------

// Nome da TV no painel: uma linha, até 40 caracteres; vazio fica sem nome.
function cleanLabel(label: unknown): string | null {
  if (typeof label !== "string") return null;
  const one = label.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
  return Array.from(one).slice(0, LABEL_MAX).join("").trim() || null;
}

// Chamada pela Server Action do painel, que já conferiu que a sessão é membro de
// restaurantId. O código só vale no restaurante dele, no prazo, uma vez só.
export async function confirmPair(d: TvDeps, restaurantId: string, code: string, label: string): Promise<ConfirmResult> {
  if (isOff(d)) return { ok: false, error: ERR_OFF };
  const c = typeof code === "string" ? code.replace(/\s+/g, "").toUpperCase() : "";
  if (!CODE.test(c) || typeof restaurantId !== "string" || !UUID.test(restaurantId)) return { ok: false, error: ERR_CODE };

  const now = nowMs(d);
  const found = (await lines(d.db, { restaurant_id: restaurantId, pair_code: c })).filter((l) => l.pair_code === c);
  const live = found.filter((l) => isLive(l, now));
  // Dois pendentes com o mesmo código (corrida rara): recusa em vez de parear a TV errada.
  if (live.length !== 1) {
    const expired = !live.length && found.some((l) => !l.revoked && !isPaired(l) && !(l.expires > now));
    return { ok: false, error: expired ? ERR_EXPIRED : ERR_CODE };
  }

  // O código no filtro: dois "Parear" ao mesmo tempo, o segundo não acha mais a linha.
  const n = await d.db.update(
    "community_tvs",
    { uid: live[0].id, restaurant_id: restaurantId, pair_code: c },
    { paired_at: iso(now), label: cleanLabel(label), pair_code: null },
  );
  return n ? { ok: true } : { ok: false, error: ERR_CODE };
}

// ---------- Estado da TV ----------

// Segredo do cabeçalho x-telao → linha daquele restaurante pelo hash. Sem linha, ou com
// qualquer linha do segredo revogada, 401 (a TV apaga o segredo e volta ao código).
// Comunidade desligada ou slug inexistente, 404: a TV não perde o segredo por isso.
// Pareada: atualiza last_seen_at (é o que acende o selo "no telão").
export async function checkTv(d: TvDeps, slug: string, secret: string | null): Promise<CheckResult> {
  if (isOff(d)) return { ok: false, status: 404 };
  const head = await d.getHead(slug);
  if (!head?.enabled) return { ok: false, status: 404 };
  const m = await matchTvSecret(d.db, head.id, secret);
  if (!m.ok) return { ok: false, status: 401 };
  if (!m.tv) return { ok: true, paired: false };
  await d.db.update("community_tvs", { uid: m.tv.id, restaurant_id: head.id }, { last_seen_at: iso(nowMs(d)) });
  return { ok: true, paired: true, simple: head.tv_simple === true };
}

// A conferência do segredo, comum ao telão da Comunidade (checkTv) e ao Apareça na TV
// (identifyTv): segredo fora do formato, sem linha daquele restaurante ou com qualquer linha
// do segredo revogada → { ok: false } (401). Sem pareamento ainda → tv: null. Pareada → a
// linha pareada mais recente (uid e o Id numérico do NocoDB, para gravar sem reler).
export type TvSecretMatch = { ok: false } | { ok: true; tv: { id: string; Id: number } | null };
export async function matchTvSecret(db: Pick<TvDb, "list">, restaurantId: string, secret: string | null): Promise<TvSecretMatch> {
  if (typeof secret !== "string" || !HEX64.test(secret)) return { ok: false };
  const hash = await sha256Hex(secret);
  const mine = (await lines(db, { restaurant_id: restaurantId, secret_hash: hash })).filter((l) => l.secret_hash === hash);
  if (!mine.length || mine.some((l) => l.revoked)) return { ok: false };
  const tv = mine.filter(isPaired).sort((a, b) => b.paired - a.paired)[0];
  return { ok: true, tv: tv ? { id: tv.id, Id: tv.Id } : null };
}
