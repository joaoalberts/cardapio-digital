import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseEnv } from "@/lib/supabase/env";
import type { PublicMenu } from "./types";

export function menuTag(slug: string) {
  return `menu:${slug}`;
}

// Cardápio público em cache; a etapa de tempo real invalida pela tag ao salvar no painel.
export async function getPublicMenu(slug: string, lang = "pt-BR"): Promise<PublicMenu | null> {
  "use cache";
  cacheTag(menuTag(slug));
  cacheLife("minutes");

  const { url, key } = requireSupabaseEnv();
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase.rpc("get_public_menu", { p_slug: slug, p_lang: lang });
  if (error) throw error;
  return (data as PublicMenu | null) ?? null;
}
