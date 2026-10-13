import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { currentUserId } from "@/lib/auth";
import * as db from "@/lib/db/nocodb";

// Restaurante que o painel está editando: o primeiro de que o usuário é membro.
// "columns" fica por compatibilidade: a linha inteira do restaurante já vem.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function currentRestaurant<T extends string>(columns?: T) {
  await connection();
  const userId = await currentUserId();
  if (!userId) redirect("/entrar");

  const memberships = await db.list<{ restaurant_id: string; role: string }>("members", { user_id: userId });
  const rows = (
    await Promise.all(memberships.map((m) => db.first<{ Id: number; id: string }>("restaurants", { uid: m.restaurant_id })))
  ).filter((r): r is NonNullable<typeof r> => !!r);
  const row = rows.sort((a, b) => a.Id - b.Id)[0];
  if (!row) redirect("/painel");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = row as any;
  return {
    restaurant: r as { id: string; name: string; slug: string } & Record<string, unknown>,
    isOwner: memberships.some((m) => m.restaurant_id === r.id && m.role === "owner"),
  };
}
