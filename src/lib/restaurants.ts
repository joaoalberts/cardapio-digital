import "server-only";
import { updateTag } from "next/cache";
import * as db from "@/lib/db/nocodb";
import { menuTag } from "@/lib/menu/data";

export async function slugTaken(slug: string) {
  return (await db.first("restaurants", { slug })) !== null;
}

// Cria o restaurante (14 dias de teste) e torna o usuário o dono dele.
export async function createRestaurantFor(userId: string, name: string, slug: string) {
  const r = await db.insertOne("restaurants", {
    name: name.trim().slice(0, 80),
    slug,
    languages: ["pt-BR"],
    menu_version: 1,
    plan: "trial",
    subscription_status: "trial",
    trial_ends_at: new Date(Date.now() + 14 * 86400_000).toISOString(),
    font_theme: "moderno",
    timezone: "America/Sao_Paulo",
    opening_hours: null,
    description: "",
    payment_methods: [],
    show_hours: true,
    show_payments: false,
  });
  await db.insertOne("members", { restaurant_id: r.id, user_id: userId, role: "owner" });
  return r;
}

type RestaurantRow = { Id: number; id: string; slug: string; menu_version: number | null };

// Depois de cada mudança: sobe a versão do cardápio e o público em cache é refeito na
// próxima visita.
export async function refreshMenu(restaurantId: string) {
  const r = await db.first<RestaurantRow>("restaurants", { uid: restaurantId });
  if (!r) return;
  await db.updateRows("restaurants", [{ Id: r.Id, menu_version: (r.menu_version ?? 0) + 1 }]);
  updateTag(menuTag(r.slug));
}
