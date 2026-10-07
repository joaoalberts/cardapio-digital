"use server";

import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { menuTag } from "@/lib/menu/data";
import type { OpeningHours } from "@/lib/menu/types";
import { backfillTranslations } from "@/lib/menu/auto-translate";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DENIED = "Não foi possível salvar. Só o dono do restaurante pode mudar o perfil.";

// Guarda a logo já enviada ao Storage e apaga a anterior da pasta do restaurante.
export async function setLogo(restaurantId: string, path: string | null): Promise<{ error?: string }> {
  if (path !== null && !path.startsWith(`${restaurantId}/`)) return { error: "Arquivo inválido." };
  const supabase = await createClient();
  const { data: before } = await supabase.from("restaurants").select("logo_path").eq("id", restaurantId).maybeSingle();
  const { data, error } = await supabase
    .from("restaurants")
    .update({ logo_path: path })
    .eq("id", restaurantId)
    .select("slug")
    .maybeSingle();
  if (error || !data) return { error: DENIED };

  const old = before?.logo_path as string | null | undefined;
  if (old && old !== path && old.startsWith(`${restaurantId}/`)) {
    await supabase.storage.from("media").remove([old]);
  }
  updateTag(menuTag(data.slug));
  return {};
}

export async function saveHours(restaurantId: string, hours: OpeningHours): Promise<{ error?: string }> {
  const valid =
    Array.isArray(hours) &&
    hours.length === 7 &&
    hours.every(
      (day) =>
        Array.isArray(day) &&
        day.length <= 3 &&
        day.every((r) => TIME.test(r?.open) && TIME.test(r?.close) && r.open !== r.close),
    );
  if (!valid) return { error: "Confira os horários: use HH:MM e abertura diferente do fechamento." };

  const supabase = await createClient();
  const clean = hours.map((day) => day.map(({ open, close }) => ({ open, close })));
  const { data, error } = await supabase
    .from("restaurants")
    .update({ opening_hours: clean })
    .eq("id", restaurantId)
    .select("slug")
    .maybeSingle();
  if (error || !data) return { error: DENIED };
  updateTag(menuTag(data.slug));
  return {};
}

const MENU_LANGS = ["en", "es", "fr", "it", "de"];

// Idiomas do cardápio (português sempre). Ligar um idioma já sugere a tradução de tudo.
export async function saveLanguages(restaurantId: string, langs: string[]): Promise<{ error?: string; translated?: number }> {
  const chosen = MENU_LANGS.filter((l) => langs.includes(l));
  const supabase = await createClient();
  const { data: before } = await supabase.from("restaurants").select("languages").eq("id", restaurantId).maybeSingle();
  const { data, error } = await supabase
    .from("restaurants")
    .update({ languages: ["pt-BR", ...chosen] })
    .eq("id", restaurantId)
    .select("slug")
    .maybeSingle();
  if (error || !data) return { error: DENIED };
  const added = chosen.filter((l) => !((before?.languages as string[] | undefined) ?? []).includes(l));
  const translated = added.length ? await backfillTranslations(supabase, restaurantId) : 0;
  updateTag(menuTag(data.slug));
  return { translated };
}
