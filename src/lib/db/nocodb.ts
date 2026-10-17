import "server-only";
import { countCall } from "./call-counter";

// Banco do app no NocoDB (base "Cardápio Digital", criada por scripts/nocodb/setup.mjs).
// Só o servidor fala com ele, com NOCODB_API_TOKEN; o isolamento por restaurante fica
// no código (ver lib/auth).
//
// Cada linha tem "uid" (o id do app, um uuid) e o "Id" numérico do NocoDB. Ligações
// entre tabelas são colunas de texto com o uid do pai (restaurant_id, category_id...).

const API = process.env.NOCODB_URL ?? "https://app.nocodb.com";
const BASE = process.env.NOCODB_BASE_ID ?? "plh3ygo9orriee2";

export type Table =
  | "users"
  | "restaurants"
  | "members"
  | "categories"
  | "items"
  | "media"
  | "translations"
  | "dining_tables"
  | "orders"
  | "special_claims"
  | "support_requests"
  | "community_polls"
  | "community_votes"
  | "community_posts"
  | "community_tvs"
  | "community_tally"
  | "apareca_videos"
  | "apareca_house_videos"
  | "apareca_tally";

export type Row = Record<string, unknown>;
// Igualdade em todas as colunas; null = coluna vazia.
export type Where = Record<string, string | number | boolean | null>;

// Colunas JSON e Checkbox voltam em formatos diferentes conforme o banco do NocoDB.
const JSON_COLS = new Set([
  "languages", "opening_hours", "payment_methods", "price_options", "tags", "lines", "special_days", "special_times",
  "options", "counts", "tables_qr", "tables_open", "result", "apareca_config", "hours",
]);
const BOOL_COLS = new Set([
  "active", "featured", "hide_price", "auto", "show_hours", "show_payments", "half_half", "orders_enabled", "open", "special",
  "community_enabled", "community_tv_simple", "on_tv", "revoked", "discarded",
  "apareca_allowed", "apareca_ai_allowed", "apareca_enabled",
]);
const NUM_COLS = new Set([
  "menu_version", "position", "price_cents", "promo_price_cents", "serves", "total_cents",
  "special_every_h", "special_show_s", "special_limit", "unit_cents", "qty_max",
  "duration_ms", "plays", "plays_target", "downloads",
]);
const SYSTEM = new Set(["CreatedAt", "UpdatedAt", "nc_created_by", "nc_updated_by", "nc_order"]);

function token() {
  const t = process.env.NOCODB_API_TOKEN;
  if (!t) throw new Error("Falta NOCODB_API_TOKEN. Veja o README.");
  return t;
}

// O NocoDB na nuvem aceita 5 pedidos por segundo por token; passou disso, bloqueia por
// alguns segundos. Aqui cada instância do servidor manda no máximo 4 por segundo.
const PER_SECOND = 4;
const sent: number[] = [];
async function slot() {
  for (;;) {
    const now = Date.now();
    while (sent.length && now - sent[0] >= 1000) sent.shift();
    if (sent.length < PER_SECOND) {
      sent.push(now);
      return;
    }
    await new Promise((r) => setTimeout(r, 1000 - (now - sent[0]) + 5));
  }
}

// table: só rótulo do contador de teste (NOCODB_COUNT=1, call-counter.ts).
async function call<T>(path: string, init: { method?: string; body?: unknown; table?: string } = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await slot();
    countCall(init.method ?? "GET", init.table ?? "?");
    const res = await fetch(API + path, {
      method: init.method ?? "GET",
      headers: { "xc-token": token(), "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (res.status === 429 && attempt < 4) {
      const wait = Number(res.headers.get("retry-after")) || 1;
      await new Promise((r) => setTimeout(r, wait * 1000 + 100));
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`nocodb ${init.method ?? "GET"} ${path.split("?")[0]}: ${res.status} ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : null) as T;
  }
}

let tableIds: Promise<Map<string, string>> | null = null;

async function tableId(table: Table) {
  tableIds ??= call<{ list: { id: string; title: string; table_name: string }[] }>(
    `/api/v2/meta/bases/${BASE}/tables`,
    { table: "meta" },
  ).then((r) => new Map(r.list.flatMap((t) => [[t.title, t.id], [t.table_name, t.id]] as [string, string][])));
  const ids = await tableIds.catch((e) => {
    tableIds = null;
    throw e;
  });
  const id = ids.get(table);
  if (!id) throw new Error(`nocodb: tabela ${table} não existe; rode scripts/nocodb/setup.mjs`);
  return id;
}

// "id" no app é sempre o uid.
function normalize(row: Row): Row {
  const out: Row = "uid" in row ? { id: row.uid } : {};
  for (const [k, v] of Object.entries(row)) {
    if (SYSTEM.has(k)) continue;
    if (JSON_COLS.has(k) && typeof v === "string") {
      try {
        out[k] = JSON.parse(v);
      } catch {
        out[k] = null;
      }
    } else if (BOOL_COLS.has(k)) out[k] = v === true || v === 1 || v === "1" || v === "true";
    else if (NUM_COLS.has(k) && typeof v === "string") out[k] = Number(v);
    else out[k] = v;
  }
  return out;
}

function encode(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined || k === "id") continue;
    out[k] = JSON_COLS.has(k) && v !== null ? JSON.stringify(v) : v;
  }
  return out;
}

// Valores vêm do próprio app (uids, slugs, códigos); vírgula e parênteses quebrariam o filtro.
function whereParam(where: Where) {
  const parts = Object.entries(where).map(([k, v]) => {
    if (v === null) return `(${k},blank)`;
    if (typeof v === "boolean") return `(${k},${v ? "checked" : "notchecked"})`;
    const s = String(v);
    if (/[,()~]/.test(s)) throw new Error(`nocodb: valor inválido no filtro ${k}`);
    return `(${k},eq,${s})`;
  });
  return parts.join("~and");
}

type ListOpts = { sort?: string; limit?: number };

// Todas as linhas que batem com o filtro (de 1000 em 1000). Sem "sort", na ordem de criação.
export async function list<T = Row>(table: Table, where: Where = {}, opts: ListOpts = {}): Promise<T[]> {
  const id = await tableId(table);
  const out: Row[] = [];
  const pageSize = Math.min(opts.limit ?? 1000, 1000);
  for (let offset = 0; ; offset += pageSize) {
    const q = new URLSearchParams({ limit: String(pageSize), offset: String(offset), sort: opts.sort ?? "Id" });
    const w = whereParam(where);
    if (w) q.set("where", w);
    const page = await call<{ list: Row[]; pageInfo?: { isLastPage?: boolean } }>(`/api/v2/tables/${id}/records?${q}`, { table });
    out.push(...page.list.map(normalize));
    if (page.pageInfo?.isLastPage !== false || page.list.length < pageSize) break;
    if (opts.limit && out.length >= opts.limit) break;
  }
  return (opts.limit ? out.slice(0, opts.limit) : out) as T[];
}

export async function first<T = Row>(table: Table, where: Where, opts: Omit<ListOpts, "limit"> = {}) {
  const [row] = await list<T>(table, where, { ...opts, limit: 1 });
  return row ?? null;
}

export async function count(table: Table, where: Where) {
  const id = await tableId(table);
  const q = new URLSearchParams();
  const w = whereParam(where);
  if (w) q.set("where", w);
  const r = await call<{ count: number }>(`/api/v2/tables/${id}/records/count?${q}`, { table });
  return Number(r.count);
}

// Cria linhas com uid e created_at; devolve as linhas como foram gravadas.
export async function insert<T extends Row>(table: Table, rows: T[]): Promise<(T & { uid: string; id: string })[]> {
  if (!rows.length) return [];
  const id = await tableId(table);
  const now = new Date().toISOString();
  const full = rows.map((r) => ({
    ...(table === "members" ? {} : { uid: crypto.randomUUID() }),
    created_at: now,
    ...r,
  })) as Row[];
  if (table === "translations") full.forEach((r) => delete r.created_at);
  for (let k = 0; k < full.length; k += 100) {
    await call(`/api/v2/tables/${id}/records`, { method: "POST", body: full.slice(k, k + 100).map(encode), table });
  }
  return full.map((r) => ({ ...r, id: r.uid })) as (T & { uid: string; id: string })[];
}

export async function insertOne<T extends Row>(table: Table, row: T) {
  const [r] = await insert(table, [row]);
  return r;
}

// Atualiza as linhas do filtro; devolve quantas mudaram.
export async function update(table: Table, where: Where, patch: Row) {
  const rows = await list<{ Id: number }>(table, where);
  if (!rows.length) return 0;
  const id = await tableId(table);
  const body = encode(patch);
  for (let k = 0; k < rows.length; k += 100) {
    await call(`/api/v2/tables/${id}/records`, {
      method: "PATCH",
      body: rows.slice(k, k + 100).map((r) => ({ ...body, Id: r.Id })),
      table,
    });
  }
  return rows.length;
}

// Atualizações diferentes por linha, num pedido só: [{ Id, ...colunas }].
export async function updateRows(table: Table, rows: ({ Id: number } & Row)[]) {
  if (!rows.length) return;
  const id = await tableId(table);
  for (let k = 0; k < rows.length; k += 100) {
    await call(`/api/v2/tables/${id}/records`, { method: "PATCH", body: rows.slice(k, k + 100).map(encode), table });
  }
}

export async function remove(table: Table, where: Where) {
  const rows = await list<{ Id: number }>(table, where);
  await removeIds(table, rows.map((r) => r.Id));
  return rows.length;
}

export async function removeIds(table: Table, ids: number[]) {
  if (!ids.length) return;
  const id = await tableId(table);
  for (let k = 0; k < ids.length; k += 100) {
    await call(`/api/v2/tables/${id}/records`, { method: "DELETE", body: ids.slice(k, k + 100).map((Id) => ({ Id })), table });
  }
}
