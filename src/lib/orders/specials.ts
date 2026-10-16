// Oferta relâmpago: o toque em "Pedir agora" grava um registro com o preço garantido.
// O pedido só aceita o preço de oferta com esse registro (service.ts confere no envio).
// O banco vem de fora (deps.db), como em service.ts.
import { openStatus } from "@/lib/menu/hours";
import { isSpecialOpen } from "@/lib/menu/special-schedule";
import type { PublicMenu } from "@/lib/menu/types";

export type ClaimRow = {
  id: string;
  restaurant_id: string;
  table_id: string;
  device_id: string;
  item_id: string;
  item_name: string;
  unit_cents: number;
  qty_max: number;
  expires_at: string;
  order_id: string | null;
  created_at: string;
};

export const CLAIM_TTL_MS = 6 * 60 * 60 * 1000; // mesmo prazo do carrinho guardado
export const TABLE_MAX_PER_WINDOW = 3;

type Where = Record<string, string | number | boolean | null>;
export type ClaimsDb = {
  list<T>(table: "special_claims" | "dining_tables", where: Where, opts?: { sort?: string; limit?: number }): Promise<T[]>;
  first<T>(table: "special_claims" | "dining_tables", where: Where): Promise<T | null>;
  insertOne<T extends Record<string, unknown>>(table: "special_claims", row: T): Promise<T & { id: string }>;
};
export type ClaimDeps = { db: ClaimsDb; getMenu: (slug: string) => Promise<PublicMenu | null>; now?: () => Date };

export type ClaimResult =
  | { ok: true; claim: string; unit_cents: number; qty_max: number; expires_at: string; name: string }
  | { ok: false; code: "invalid" | "not_found" | "disabled" | "table" | "closed" | "unavailable" | "too_soon" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MESA = /^[A-Z2-9]{6}$/;
const HOUR_MS = 3_600_000;

function parse(body: unknown): { mesa: string; device: string; item: string } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.mesa !== "string" || !MESA.test(b.mesa)) return null;
  if (typeof b.device !== "string" || !UUID.test(b.device) || typeof b.item !== "string" || !UUID.test(b.item)) return null;
  return { mesa: b.mesa, device: b.device, item: b.item };
}

export async function claimSpecial(deps: ClaimDeps, slug: string, body: unknown): Promise<ClaimResult> {
  const input = parse(body);
  if (!input) return { ok: false, code: "invalid" };
  const now = deps.now?.() ?? new Date();
  const menu = await deps.getMenu(slug);
  if (!menu) return { ok: false, code: "not_found" };
  const r = menu.restaurant;
  if (!r.orders_enabled) return { ok: false, code: "disabled" };

  const table = await deps.db.first<{ id: string; active: boolean }>("dining_tables", { restaurant_id: r.id, code: input.mesa });
  if (!table?.active) return { ok: false, code: "table" };
  if (r.opening_hours && !openStatus(r.opening_hours, r.timezone, now).open) return { ok: false, code: "closed" };

  // Só especial ligado (menu.specials já vem só com os ativos) e dentro do dia e horário agora.
  const item = menu.specials?.items.find((i) => i.id === input.item);
  if (!item?.special || item.promo_price_cents == null || !isSpecialOpen(item, r.timezone, now)) {
    return { ok: false, code: "unavailable" };
  }

  // Contra abuso: o mesmo celular espera o intervalo; a mesa pega no máximo 3 vezes nele.
  const since = now.getTime() - item.special.every_h * HOUR_MS;
  const recent = (rows: ClaimRow[]) => rows.filter((c) => Date.parse(c.created_at) > since);
  const mine = recent(await deps.db.list<ClaimRow>("special_claims", { restaurant_id: r.id, item_id: item.id, device_id: input.device }));
  if (mine.length) return { ok: false, code: "too_soon" };
  const atTable = recent(await deps.db.list<ClaimRow>("special_claims", { restaurant_id: r.id, item_id: item.id, table_id: table.id }));
  if (atTable.length >= TABLE_MAX_PER_WINDOW) return { ok: false, code: "too_soon" };

  const expires_at = new Date(now.getTime() + CLAIM_TTL_MS).toISOString();
  const row = await deps.db.insertOne("special_claims", {
    restaurant_id: r.id,
    table_id: table.id,
    device_id: input.device,
    item_id: item.id,
    item_name: item.name,
    unit_cents: item.promo_price_cents,
    qty_max: item.special.limit,
    expires_at,
    order_id: null,
  });
  return { ok: true, claim: row.id, unit_cents: item.promo_price_cents, qty_max: item.special.limit, expires_at, name: item.name };
}
