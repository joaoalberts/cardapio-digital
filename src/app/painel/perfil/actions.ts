"use server";

import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { menuTag } from "@/lib/menu/data";
import type { OpeningHours } from "@/lib/menu/types";
import { backfillTranslations } from "@/lib/menu/auto-translate";
import { replaceMedia, validMedia, type MediaInput } from "@/lib/media-store";
import { PAYMENT_IDS } from "@/lib/menu/payments";

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

function validHours(hours: OpeningHours) {
  return (
    Array.isArray(hours) &&
    hours.length === 7 &&
    hours.every(
      (day) =>
        Array.isArray(day) &&
        day.length <= 3 &&
        day.every((r) => TIME.test(r?.open) && TIME.test(r?.close) && r.open !== r.close),
    )
  );
}

export async function saveHours(restaurantId: string, hours: OpeningHours): Promise<{ error?: string }> {
  const valid = validHours(hours);
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

const HEX = /^#[0-9a-f]{6}$/i;
const opt = (s: string | null | undefined, max: number) => String(s ?? "").trim().slice(0, max) || null;

// Configurações do cardápio: cor de destaque e Wi-Fi mostrado aos clientes.
export async function saveMenuSettings(
  restaurantId: string,
  input: { brandColor: string; wifiName: string; wifiPassword: string },
): Promise<{ error?: string }> {
  if (!HEX.test(input.brandColor)) return { error: "Escolha uma cor válida." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("restaurants")
    .update({
      brand_color: input.brandColor.toLowerCase(),
      wifi_name: opt(input.wifiName, 60),
      wifi_password: opt(input.wifiPassword, 60),
    })
    .eq("id", restaurantId)
    .select("slug")
    .maybeSingle();
  if (error || !data) return { error: DENIED };
  updateTag(menuTag(data.slug));
  return {};
}

export type ProfileInput = {
  name: string;
  phone: string;
  address: string;
  description: string;
  brandColor: string;
  instagram: string;
  facebook: string;
  wifiName: string;
  wifiPassword: string;
  showHours: boolean;
  hours: OpeningHours;
  showPayments: boolean;
  paymentMethods: string[];
  // undefined = não mexe; null = remove; objeto = foto ou vídeo novo já enviado
  banner?: MediaInput | null;
};

// "Salvar Edição" do Editar Perfil: tudo de uma vez.
export async function saveProfile(restaurantId: string, input: ProfileInput): Promise<{ error?: string }> {
  const name = String(input.name ?? "").trim().slice(0, 80);
  if (!name) return { error: "Informe o nome do restaurante." };
  if (!HEX.test(input.brandColor)) return { error: "Escolha uma cor válida." };
  const instagram = String(input.instagram ?? "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/.*$/, "");
  if (instagram && !/^[A-Za-z0-9._]{1,30}$/.test(instagram)) return { error: "Confira o Instagram: só letras, números, ponto e _." };
  const facebook = String(input.facebook ?? "").trim().replace(/^https?:\/\/(www\.)?facebook\.com\//, "").slice(0, 80);
  if (!validHours(input.hours)) return { error: "Confira os horários: use HH:MM e abertura diferente do fechamento." };
  if (input.banner && !validMedia(restaurantId, input.banner)) return { error: "Arquivo inválido." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("restaurants")
    .update({
      name,
      phone: opt(input.phone, 30),
      address: opt(input.address, 200),
      description: String(input.description ?? "").trim().slice(0, 300),
      brand_color: input.brandColor.toLowerCase(),
      instagram: instagram || null,
      facebook: facebook || null,
      wifi_name: opt(input.wifiName, 60),
      wifi_password: opt(input.wifiPassword, 60),
      show_hours: !!input.showHours,
      opening_hours: input.hours.map((day) => day.map(({ open, close }) => ({ open, close }))),
      show_payments: !!input.showPayments,
      payment_methods: PAYMENT_IDS.filter((p) => input.paymentMethods.includes(p)),
    })
    .eq("id", restaurantId)
    .select("slug")
    .maybeSingle();
  if (error || !data) return { error: DENIED };
  if (input.banner !== undefined) {
    const res = await replaceMedia(supabase, restaurantId, { banner: restaurantId }, input.banner);
    if (res.error) return res;
  }
  updateTag(menuTag(data.slug));
  return {};
}
