"use server";

import { updateTag } from "next/cache";
import { isOwner } from "@/lib/auth";
import * as db from "@/lib/db/nocodb";
import { isFontTheme } from "@/lib/menu/font-themes";
import { menuTag } from "@/lib/menu/data";

export async function publishFontTheme(restaurantId: string, theme: string): Promise<{ error?: string }> {
  if (!isFontTheme(theme)) return { error: "Fonte inválida." };
  const denied = { error: "Não foi possível publicar. Só o dono do restaurante pode mudar a fonte." };
  if (!(await isOwner(restaurantId))) return denied;
  const r = await db.first<{ Id: number; slug: string }>("restaurants", { uid: restaurantId });
  if (!r) return denied;
  try {
    await db.updateRows("restaurants", [{ Id: r.Id, font_theme: theme }]);
  } catch {
    return { error: "Não foi possível publicar. Tente de novo." };
  }
  updateTag(menuTag(r.slug));
  return {};
}
