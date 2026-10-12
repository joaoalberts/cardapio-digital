import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseEnv } from "@/lib/supabase/env";
import type { PublicMenu } from "./types";

export function menuTag(slug: string) {
  return `menu:${slug}`;
}

// Cardápio público em cache; a etapa de tempo real invalida pela tag ao salvar no painel.
// Nome da mesa pelo código do QR. Sem cache: é uma busca pequena, feita só por quem lê o
// QR de uma mesa. Qualquer falha só deixa de mostrar a mesa; o cardápio continua.
export async function getTableLabel(slug: string, code: string): Promise<string | null> {
  const { url, key } = requireSupabaseEnv();
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase.rpc("get_table_label", { p_slug: slug, p_code: code });
  if (error) return null;
  return (data as string | null) ?? null;
}

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
