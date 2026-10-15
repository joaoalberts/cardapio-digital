// Pedidos: criar (pelo celular do cliente), listar (cliente e cozinha) e mudar o status.
// O banco vem de fora (deps.db): no app é o NocoDB; nos testes, um banco em memória.
import { openStatus } from "@/lib/menu/hours";
import type { PublicMenu } from "@/lib/menu/types";
import { MAX_LINES, priceCart, type CartLineInput, type LineError, type PricedLine } from "./pricing";

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
};
export type PublicOrder = Pick<OrderRow, "id" | "status" | "total_cents" | "lines" | "created_at" | "table_label">;

type Where = Record<string, string | number | boolean | null>;
type OrderTable = "orders" | "dining_tables";
export type OrdersDb = {
  list<T>(table: OrderTable, where: Where, opts?: { sort?: string; limit?: number }): Promise<T[]>;
  first<T>(table: OrderTable, where: Where): Promise<T | null>;
  insertOne<T extends Record<string, unknown>>(table: "orders", row: T): Promise<T & { id: string }>;
  update(table: "orders", where: Where, patch: Record<string, unknown>): Promise<number>;
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

const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

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
    if (!isUuid(l.item) || typeof l.qty !== "number") return null;
    if (option !== null && (typeof option !== "string" || option.length > 40)) return null;
    if (half !== null && !isUuid(half)) return null;
    if (note !== null && (typeof note !== "string" || note.length > 1000)) return null;
    lines.push({ item: l.item, option, half, qty: l.qty, note });
  }
  return { mesa: b.mesa, device: b.device, ref: b.ref, lines };
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

  const priced = priceCart(menu, input.lines, now);
  if (!priced.ok) return { ok: false, code: "lines", errors: priced.errors };

  const row = await deps.db.insertOne("orders", {
    restaurant_id: r.id,
    table_id: table.id,
    table_label: table.label,
    status: "new",
    open: true,
    lines: priced.lines,
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
    });
    return winner.device_id === input.device ? { ok: true, order: toPublic(winner) } : { ok: false, code: "invalid" };
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
