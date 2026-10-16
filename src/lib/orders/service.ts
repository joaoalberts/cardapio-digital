// Pedidos: criar (pelo celular do cliente), listar (cliente e cozinha) e mudar o status.
// O banco vem de fora (deps.db): no app é o NocoDB; nos testes, um banco em memória.
import type { Origin } from "@/lib/comunidade/types";
import { openStatus } from "@/lib/menu/hours";
import type { PublicMenu } from "@/lib/menu/types";
import { MAX_LINES, priceCart, type CartLineInput, type ClaimRef, type LineError, type PricedLine } from "./pricing";
import type { ClaimRow } from "./specials";

export type OrderStatus = "new" | "preparing" | "ready" | "delivered";
export const NEXT_STATUS: Record<OrderStatus, OrderStatus | null> = {
  new: "preparing",
  preparing: "ready",
  ready: "delivered",
  delivered: null,
};

export type OrderRow = {
  id: string;
  restaurant_id: string;
  table_id: string;
  table_label: string;
  status: OrderStatus;
  open: boolean;
  lines: PricedLine[];
  total_cents: number;
  device_id: string;
  client_ref: string;
  created_at: string;
  status_at: string | null;
  discarded?: boolean; // fechado num descarte (envio repetido ou oferta perdida): fora do placar
};
export type PublicOrder = Pick<OrderRow, "id" | "status" | "total_cents" | "lines" | "created_at" | "table_label">;

type Where = Record<string, string | number | boolean | null>;
type OrderTable = "orders" | "dining_tables" | "special_claims";
type OriginTable = "community_polls" | "community_posts";
export type OrdersDb = {
  list<T>(table: OrderTable, where: Where, opts?: { sort?: string; limit?: number }): Promise<T[]>;
  first<T>(table: OrderTable | OriginTable, where: Where): Promise<T | null>;
  insertOne<T extends Record<string, unknown>>(table: "orders", row: T): Promise<T & { id: string }>;
  update(table: "orders" | "special_claims", where: Where, patch: Record<string, unknown>): Promise<number>;
};
export type Deps = { db: OrdersDb; getMenu: (slug: string) => Promise<PublicMenu | null>; now?: () => Date };

export type CreateInput = { mesa: string; device: string; ref: string; lines: CartLineInput[] };
export type CreateResult =
  | { ok: true; order: PublicOrder }
  | { ok: false; code: "invalid" | "not_found" | "table" | "disabled" | "lines"; errors?: LineError[] }
  | { ok: false; code: "closed"; opensAt: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Mesmo formato do código do QR (mesa-tag.tsx): 6 letras e números sem os que se confundem.
const MESA = /^[A-Z2-9]{6}$/;
const RECENT_MS = 6 * 60 * 60 * 1000;
const CHANGED = "Esse pedido já mudou. Atualize a tela.";
// Origem da Comunidade: vale até 2 h depois do toque. O relógio do celular pode estar até
// 1 min adiantado; mais que isso no futuro, a origem cai.
export const ORIGIN_WINDOW_MS = 2 * 60 * 60 * 1000;
const ORIGIN_SKEW_MS = 60_000;
// Cada origem diferente custa uma consulta ao banco; um pedido forjado não pode gastar 30.
const ORIGIN_MAX_REFS = 10;
const ORIGIN_TABLE: Record<Origin["origin"], OriginTable> = { comunidade_palco: "community_polls", comunidade_mural: "community_posts" };

const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const isOrigin = (v: unknown): v is Origin["origin"] => typeof v === "string" && Object.hasOwn(ORIGIN_TABLE, v);

// Origem inválida cai em silêncio e a linha segue: a origem só mede, não pode recusar o pedido.
function parseOrigin(l: Record<string, unknown>): Origin | null {
  if (!isOrigin(l.origin) || !isUuid(l.origin_ref) || typeof l.origin_at !== "number" || !Number.isFinite(l.origin_at)) return null;
  return { origin: l.origin, origin_ref: l.origin_ref, origin_at: l.origin_at };
}

// Só o formato; preço, disponibilidade e limites ficam com priceCart.
export function parseCreateInput(body: unknown): CreateInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.mesa !== "string" || !MESA.test(b.mesa) || !isUuid(b.device) || !isUuid(b.ref)) return null;
  if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > MAX_LINES) return null;
  const lines: CartLineInput[] = [];
  for (const raw of b.lines) {
    if (!raw || typeof raw !== "object") return null;
    const l = raw as Record<string, unknown>;
    const option = l.option ?? null;
    const half = l.half ?? null;
    const note = l.note ?? null;
    const claim = l.claim ?? null;
    if (!isUuid(l.item) || typeof l.qty !== "number") return null;
    if (claim !== null && !isUuid(claim)) return null;
    if (option !== null && (typeof option !== "string" || option.length > 40)) return null;
    if (half !== null && !isUuid(half)) return null;
    if (note !== null && (typeof note !== "string" || note.length > 1000)) return null;
    const line: CartLineInput = claim ? { item: l.item, option, half, qty: l.qty, note, claim } : { item: l.item, option, half, qty: l.qty, note };
    lines.push({ ...line, ...parseOrigin(l) });
  }
  return { mesa: b.mesa, device: b.device, ref: b.ref, lines };
}

// A origem fica só se o toque foi há no máximo 2 h e se a enquete ou o post é deste
// restaurante (uma consulta por origem distinta). Fora disso, a linha vai sem origem.
async function checkOrigins(db: OrdersDb, restaurantId: string, input: CartLineInput[], priced: PricedLine[], now: Date) {
  const t = now.getTime();
  const tag = (l: CartLineInput) => `${l.origin}:${l.origin_ref}`;
  const inWindow = (l: CartLineInput) =>
    !!l.origin && !!l.origin_ref && typeof l.origin_at === "number" && l.origin_at <= t + ORIGIN_SKEW_MS && t - l.origin_at <= ORIGIN_WINDOW_MS;
  const candidates = [...new Map(input.filter(inWindow).map((l) => [tag(l), l])).values()].slice(0, ORIGIN_MAX_REFS);
  const valid = new Set<string>();
  for (const l of candidates) {
    const row = await db.first(ORIGIN_TABLE[l.origin!], { uid: l.origin_ref!, restaurant_id: restaurantId });
    if (row) valid.add(tag(l));
  }
  // priceCart só devolve ok com uma linha por entrada, na mesma ordem.
  return priced.map((p, i) => {
    const { origin, origin_ref, ...rest } = p;
    const l = input[i];
    return origin && origin_ref && inWindow(l) && valid.has(tag(l)) ? { ...rest, origin, origin_ref } : rest;
  });
}

const toPublic = (o: OrderRow): PublicOrder => ({
  id: o.id,
  status: o.status,
  total_cents: o.total_cents,
  lines: o.lines,
  created_at: o.created_at,
  table_label: o.table_label,
});

export async function createOrder(deps: Deps, slug: string, body: unknown): Promise<CreateResult> {
  const input = parseCreateInput(body);
  if (!input) return { ok: false, code: "invalid" };
  const now = deps.now?.() ?? new Date();
  const menu = await deps.getMenu(slug);
  if (!menu) return { ok: false, code: "not_found" };
  const r = menu.restaurant;

  // Nova tentativa de um pedido já gravado devolve o pedido, mesmo que o restaurante
  // tenha fechado ou desligado os pedidos no intervalo.
  const again = await deps.db.first<OrderRow>("orders", { restaurant_id: r.id, client_ref: input.ref });
  if (again) return again.device_id === input.device ? { ok: true, order: toPublic(again) } : { ok: false, code: "invalid" };

  if (!r.orders_enabled) return { ok: false, code: "disabled" };

  const table = await deps.db.first<{ id: string; label: string; active: boolean }>("dining_tables", {
    restaurant_id: r.id,
    code: input.mesa,
  });
  if (!table?.active) return { ok: false, code: "table" };

  // Sem horário cadastrado (ou escondido), o restaurante conta como aberto.
  if (r.opening_hours) {
    const st = openStatus(r.opening_hours, r.timezone, now);
    if (!st.open) return { ok: false, code: "closed", opensAt: st.opensAt };
  }

  // Oferta relâmpago: só vale o registro desta mesa e deste celular, não usado e no prazo.
  const claims = new Map<string, ClaimRef>();
  for (const id of new Set(input.lines.map((l) => l.claim).filter((c): c is string => !!c))) {
    const c = await deps.db.first<ClaimRow>("special_claims", { uid: id, restaurant_id: r.id });
    const valid = c && c.table_id === table.id && c.device_id === input.device && !c.order_id && Date.parse(c.expires_at) > now.getTime();
    if (valid) claims.set(id, { item_id: c.item_id, item_name: c.item_name, unit_cents: c.unit_cents, qty_max: c.qty_max });
  }

  const priced = priceCart(menu, input.lines, now, claims);
  if (!priced.ok) return { ok: false, code: "lines", errors: priced.errors };
  const lines = input.lines.some((l) => l.origin) ? await checkOrigins(deps.db, r.id, input.lines, priced.lines, now) : priced.lines;

  const row = await deps.db.insertOne("orders", {
    restaurant_id: r.id,
    table_id: table.id,
    table_label: table.label,
    status: "new",
    open: true,
    lines,
    total_cents: priced.total_cents,
    device_id: input.device,
    client_ref: input.ref,
    status_at: now.toISOString(),
  });
  const mine = row as unknown as OrderRow;

  // Procurar e gravar não é atômico: dois envios simultâneos com o mesmo ref gravam dois
  // pedidos. O primeiro da lista vence; o outro é fechado e some da cozinha.
  const same = await deps.db.list<OrderRow>("orders", { restaurant_id: r.id, client_ref: input.ref }, { sort: "Id" });
  const winner = same[0];
  if (winner && winner.id !== mine.id) {
    await deps.db.update("orders", { uid: mine.id, restaurant_id: r.id }, {
      open: false,
      status: "delivered",
      status_at: now.toISOString(),
      discarded: true,
    });
    return winner.device_id === input.device ? { ok: true, order: toPublic(winner) } : { ok: false, code: "invalid" };
  }
  // Oferta relâmpago: conferir e marcar o registro não é atômico. Dois pedidos ao mesmo
  // tempo com o mesmo registro: vence o primeiro pedido aberto (menor Id) que o usa; o outro
  // é fechado, como no ref repetido, e a linha volta como "special".
  if (claims.size) {
    const used = (o: OrderRow, id: string) => (o.lines ?? []).some((l) => l.claim === id);
    const mineRows = await deps.db.list<OrderRow>("orders", { restaurant_id: r.id, device_id: input.device, open: true }, { sort: "Id" });
    const lost = [...claims.keys()].filter((id) => {
      const first = mineRows.find((o) => used(o, id));
      return first && first.id !== mine.id;
    });
    if (lost.length) {
      await deps.db.update("orders", { uid: mine.id, restaurant_id: r.id }, { open: false, status: "delivered", status_at: now.toISOString(), discarded: true });
      const errors = input.lines.flatMap((l, index) => (l.claim && lost.includes(l.claim) ? [{ index, item: l.item, reason: "special" as const }] : []));
      return { ok: false, code: "lines", errors };
    }
    // O registro usado fica preso a este pedido: não vale em outro.
    for (const id of claims.keys()) await deps.db.update("special_claims", { uid: id, restaurant_id: r.id }, { order_id: mine.id });
  }
  return { ok: true, order: toPublic(mine) };
}

export async function listDeviceOrders(deps: Deps, slug: string, device: string): Promise<PublicOrder[]> {
  if (!isUuid(device)) return [];
  const menu = await deps.getMenu(slug);
  if (!menu) return [];
  const now = (deps.now?.() ?? new Date()).getTime();
  const rows = await deps.db.list<OrderRow>("orders", { restaurant_id: menu.restaurant.id, device_id: device }, { sort: "-Id", limit: 20 });
  // created_at ilegível não pode esconder o pedido do cliente.
  return rows
    .filter((o) => {
      const t = Date.parse(o.created_at);
      return Number.isNaN(t) || now - t < RECENT_MS;
    })
    .map(toPublic);
}

export async function listOpenOrders(deps: Pick<Deps, "db">, restaurantId: string): Promise<OrderRow[]> {
  return deps.db.list<OrderRow>("orders", { restaurant_id: restaurantId, open: true }, { sort: "Id" });
}

export async function setOrderStatus(
  deps: Pick<Deps, "db" | "now"> & { isMember: (rid: string) => Promise<boolean> },
  restaurantId: string,
  id: string,
  status: string,
): Promise<{ error?: string }> {
  if (!isUuid(id) || !(status in NEXT_STATUS)) return { error: CHANGED };
  if (!(await deps.isMember(restaurantId))) return { error: "Entre de novo no painel." };
  const row = await deps.db.first<OrderRow>("orders", { uid: id, restaurant_id: restaurantId });
  if (!row) return { error: CHANGED };
  if (row.status === status) return {};
  if (NEXT_STATUS[row.status] !== status) return { error: CHANGED };
  const now = deps.now?.() ?? new Date();
  await deps.db.update("orders", { uid: id, restaurant_id: restaurantId }, {
    status,
    status_at: now.toISOString(),
    open: status !== "delivered",
  });
  return {};
}
