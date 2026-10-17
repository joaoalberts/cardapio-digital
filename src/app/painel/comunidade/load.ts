import "server-only";
import { getPublicMenu } from "@/lib/menu/data";
import { thumbSrc } from "@/lib/menu/media";
import type { MenuItem } from "@/lib/menu/types";
import type { HousePhotoData } from "./house-photo";
import type { PollMakerData } from "./poll-maker";

// Pratos do cardápio público (o mesmo que o cliente vê) para o seletor de "Nova enquete" e da
// foto da casa, sem os itens especiais. Usado pela Comunidade e pela tela "Agora". Sem a
// leitura de enquetes, fotos, TVs e pedidos: isso fica com quem precisa.

export async function loadDishes(slug: string): Promise<{ categories: PollMakerData["categories"]; items: Map<string, MenuItem> }> {
  const menu = await getPublicMenu(slug);
  const items = new Map<string, MenuItem>();
  const categories = (menu?.categories ?? []).map((c) => ({
    name: c.name,
    items: c.items.filter((i) => !i.special).map((i) => {
      items.set(i.id, i);
      return { id: i.id, name: i.name, thumb: thumbSrc(i) };
    }),
  })).filter((c) => c.items.length);
  return { categories, items };
}

// O que "Nova enquete" e "Foto de prato" precisam para funcionar fora do editor da Comunidade.
export async function loadMakerData(r: { id: string; slug: string }): Promise<PollMakerData & HousePhotoData> {
  const { categories } = await loadDishes(r.slug);
  return { restaurantId: r.id, categories };
}
