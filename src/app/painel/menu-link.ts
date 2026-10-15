import "server-only";
import * as db from "@/lib/db/nocodb";

// Link do cardápio para o dono abrir de dentro do painel: entra pela primeira mesa ativa,
// para ver o cardápio como o cliente do QR, com "Pedir", carrinho e envio. Pedido feito
// ali vai para a cozinha dessa mesa. Sem mesa ativa, abre o cardápio só para ver.
// O link para divulgar (copiar, QR, impressão) continua sem mesa: é outro.
export async function ownerMenuHref(restaurantId: string, slug: string) {
  const mesa = await db.first<{ code: string }>("dining_tables", { restaurant_id: restaurantId, active: true }, { sort: "Id" }).catch(() => null);
  return `/${slug}${mesa?.code ? `?mesa=${encodeURIComponent(mesa.code)}` : ""}`;
}
