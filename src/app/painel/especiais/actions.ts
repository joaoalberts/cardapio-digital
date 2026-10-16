"use server";

import { isMember } from "@/lib/auth";
import * as db from "@/lib/db/nocodb";
import { refreshMenu } from "@/lib/restaurants";
import { autoTranslate } from "@/lib/menu/auto-translate";
import { mediaFilesOf, removeMedia, replaceMedia, validMedia, type MediaInput } from "@/lib/media-store";
import { validateSpecial, type SpecialInput } from "./validate";

// Produtos especiais (oferta relâmpago). Ficam numa categoria escondida por restaurante
// (categories.special), que o cardápio e o "Adicionar/Editar" nunca mostram.
// Toda ação confere se quem chamou é membro do restaurante, e toda busca filtra por ele.

type Result = { error?: string };
const FAIL = "Não foi possível salvar. Tente de novo.";
const DENIED = "Entre de novo no painel.";
const UUIDS = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const okId = (id: unknown): id is string => typeof id === "string" && UUIDS.test(id);

// Id da categoria escondida; cria na primeira vez.
export async function ensureSpecialCategory(restaurantId: string): Promise<string> {
  if (!(await isMember(restaurantId))) throw new Error(DENIED);
  const found = await db.first<{ id: string }>("categories", { restaurant_id: restaurantId, special: true });
  if (found) return found.id;
  const row = await db.insertOne("categories", {
    restaurant_id: restaurantId,
    name: "Produtos especiais",
    description: "",
    position: 9999,
    active: true,
    half_half: false,
    special: true,
  });
  return row.id;
}

async function specialItem(restaurantId: string, id: string) {
  const catId = await ensureSpecialCategory(restaurantId);
  const it = await db.first<{ Id: number; id: string; name: string; description: string | null }>("items", {
    uid: id,
    restaurant_id: restaurantId,
    category_id: catId,
  });
  return it ? { it, catId } : null;
}

export async function saveSpecial(
  restaurantId: string,
  input: SpecialInput & { media?: MediaInput | null },
): Promise<Result & { id?: string }> {
  const v = validateSpecial(input);
  if (!v.ok) return { error: v.error };
  if ((input.id !== undefined && !okId(input.id)) || !(await isMember(restaurantId))) return { error: DENIED };
  const m = input.media;
  if (m && !validMedia(restaurantId, m)) return { error: "Arquivo inválido." };

  let id = input.id;
  let textsChanged = true;
  try {
    const catId = await ensureSpecialCategory(restaurantId);
    if (id) {
      const found = await specialItem(restaurantId, id);
      if (!found) return { error: FAIL };
      textsChanged = found.it.name !== v.row.name || (found.it.description ?? "") !== v.row.description;
      await db.updateRows("items", [{ Id: found.it.Id, ...v.row }]);
    } else {
      const count = await db.count("items", { restaurant_id: restaurantId, category_id: catId });
      id = (await db.insertOne("items", { ...v.row, restaurant_id: restaurantId, category_id: catId, position: count, tags: [] })).id;
    }
  } catch {
    return { error: FAIL };
  }

  if (m !== undefined) {
    const res = await replaceMedia(restaurantId, { itemId: id }, m);
    if (res.error) return { ...res, id };
  }
  if (textsChanged) {
    await autoTranslate(restaurantId, { itemId: id }, { name: String(v.row.name), description: String(v.row.description) });
  }
  await refreshMenu(restaurantId);
  return { id };
}

export async function setSpecialActive(restaurantId: string, id: string, active: boolean): Promise<Result> {
  if (!okId(id) || !(await isMember(restaurantId))) return { error: DENIED };
  try {
    const found = await specialItem(restaurantId, id);
    if (!found) return { error: FAIL };
    await db.updateRows("items", [{ Id: found.it.Id, active: !!active }]);
  } catch {
    return { error: FAIL };
  }
  await refreshMenu(restaurantId);
  return {};
}

export async function deleteSpecial(restaurantId: string, id: string): Promise<Result> {
  if (!okId(id) || !(await isMember(restaurantId))) return { error: DENIED };
  try {
    if (!(await specialItem(restaurantId, id))) return { error: FAIL };
    const files = await mediaFilesOf(restaurantId, { itemId: id });
    await db.remove("translations", { restaurant_id: restaurantId, item_id: id });
    await db.remove("items", { restaurant_id: restaurantId, uid: id });
    await removeMedia(files);
  } catch {
    return { error: "Não foi possível excluir o produto especial." };
  }
  await refreshMenu(restaurantId);
  return {};
}
