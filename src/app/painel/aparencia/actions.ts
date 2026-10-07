"use server";

import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isFontTheme } from "@/lib/menu/font-themes";
import { menuTag } from "@/lib/menu/data";

export async function publishFontTheme(restaurantId: string, theme: string): Promise<{ error?: string }> {
  if (!isFontTheme(theme)) return { error: "Fonte inválida." };

  const supabase = await createClient();
  // As regras do banco só deixam o dono mudar; para os outros a linha não volta.
  const { data, error } = await supabase
    .from("restaurants")
    .update({ font_theme: theme })
    .eq("id", restaurantId)
    .select("slug")
    .maybeSingle();
  if (error || !data) return { error: "Não foi possível publicar. Só o dono do restaurante pode mudar a fonte." };

  updateTag(menuTag(data.slug));
  return {};
}
