"use server";

import { isMember } from "@/lib/auth";
import * as db from "@/lib/db/nocodb";
import { refreshMenu } from "@/lib/restaurants";
import { listOpenOrders, setOrderStatus, type OrderRow, type OrdersDb } from "@/lib/orders/service";

const orders = db as unknown as OrdersDb;
const FAIL = "Não foi possível atualizar. Confira a internet.";

export type KitchenOrder = Pick<OrderRow, "id" | "status" | "table_label" | "lines" | "created_at" | "total_cents">;

export async function fetchOpenOrders(restaurantId: string): Promise<{ orders?: KitchenOrder[]; error?: string }> {
  if (!(await isMember(restaurantId))) return { error: "Entre de novo no painel." };
  try {
    const rows = await listOpenOrders({ db: orders }, restaurantId);
    return { orders: rows.map(({ id, status, table_label, lines, created_at, total_cents }) => ({ id, status, table_label, lines, created_at, total_cents })) };
  } catch {
    return { error: FAIL };
  }
}

export async function advanceOrder(restaurantId: string, id: string, status: string) {
  try {
    return await setOrderStatus({ db: orders, isMember }, restaurantId, id, status);
  } catch {
    return { error: FAIL };
  }
}

// Liga ou desliga os pedidos pelo cardápio; o cardápio do cliente se atualiza na hora.
export async function setOrdersEnabled(restaurantId: string, on: boolean): Promise<{ error?: string }> {
  if (!(await isMember(restaurantId))) return { error: "Entre de novo no painel." };
  try {
    await db.update("restaurants", { uid: restaurantId }, { orders_enabled: !!on });
    await refreshMenu(restaurantId);
    return {};
  } catch {
    return { error: FAIL };
  }
}
