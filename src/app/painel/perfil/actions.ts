"use server";

import { updateTag } from "next/cache";
import { isOwner } from "@/lib/auth";
import { tvTags } from "@/lib/tv/tags";
import * as db from "@/lib/db/nocodb";
import { menuTag } from "@/lib/menu/data";
import type { OpeningHours } from "@/lib/menu/types";
import { backfillTranslations } from "@/lib/menu/auto-translate";
import { replaceMedia, validMedia, type MediaInput } from "@/lib/media-store";
import { ownsFile, removeFiles } from "@/lib/storage";
import { PAYMENT_IDS } from "@/lib/menu/payments";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DENIED = "Não foi possível salvar. Só o dono do restaurante pode mudar o perfil.";

type Restaurant = { Id: number; slug: string; logo_path: string | null; languages: string[] | null };

// Só o dono muda o restaurante (antes, regra do banco). Grava e devolve a linha de antes.
async function updateRestaurant(restaurantId: string, patch: Record<string, unknown>): Promise<Restaurant | null> {
  if (!(await isOwner(restaurantId))) return null;
  const before = await db.first<Restaurant>("restaurants", { uid: restaurantId });
  if (!before) return null;
  try {
    await db.updateRows("restaurants", [{ Id: before.Id, ...patch }]);
  } catch {
    return null;
  }
  return before;
}

// Cardápio e cabeça do telão (nome, logo, cor, horário e Instagram aparecem no telão, com
// cache de 5 min): a mudança vale na hora.
function refreshBoth(slug: string) {
  updateTag(menuTag(slug));
  updateTag(tvTags.slug(slug));
}

// Guarda a logo já enviada ao Storage e apaga a anterior da pasta do restaurante.
export async function setLogo(restaurantId: string, path: string | null): Promise<{ error?: string }> {
  if (path !== null && !(typeof path === "string" && ownsFile(restaurantId, path))) return { error: "Arquivo inválido." };
  const before = await updateRestaurant(restaurantId, { logo_path: path });
  if (!before) return { error: DENIED };
  if (before.logo_path && before.logo_path !== path) await removeFiles([before.logo_path]);
  refreshBoth(before.slug);
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

  const clean = hours.map((day) => day.map(({ open, close }) => ({ open, close })));
  const data = await updateRestaurant(restaurantId, { opening_hours: clean });
  if (!data) return { error: DENIED };
  refreshBoth(data.slug);
  return {};
}

const MENU_LANGS = ["en", "es", "fr", "it", "de"];

// Idiomas do cardápio (português sempre). Ligar um idioma já sugere a tradução de tudo.
export async function saveLanguages(restaurantId: string, langs: string[]): Promise<{ error?: string; translated?: number }> {
  const chosen = MENU_LANGS.filter((l) => langs.includes(l));
  const data = await updateRestaurant(restaurantId, { languages: ["pt-BR", ...chosen] });
  if (!data) return { error: DENIED };
  const added = chosen.filter((l) => !(data.languages ?? []).includes(l));
  const translated = added.length ? await backfillTranslations(restaurantId) : 0;
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
  const data = await updateRestaurant(restaurantId, {
      brand_color: input.brandColor.toLowerCase(),
      wifi_name: opt(input.wifiName, 60),
      wifi_password: opt(input.wifiPassword, 60),
    });
  if (!data) return { error: DENIED };
  refreshBoth(data.slug);
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

// "Salvar Edição" do Perfil: tudo de uma vez.
export async function saveProfile(restaurantId: string, input: ProfileInput): Promise<{ error?: string }> {
  const name = String(input.name ?? "").trim().slice(0, 80);
  if (!name) return { error: "Informe o nome do restaurante." };
  if (!HEX.test(input.brandColor)) return { error: "Escolha uma cor válida." };
  const instagram = String(input.instagram ?? "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/.*$/, "");
  if (instagram && !/^[A-Za-z0-9._]{1,30}$/.test(instagram)) return { error: "Confira o Instagram: só letras, números, ponto e _." };
  const facebook = String(input.facebook ?? "").trim().replace(/^https?:\/\/(www\.)?facebook\.com\//, "").slice(0, 80);
  if (!validHours(input.hours)) return { error: "Confira os horários: use HH:MM e abertura diferente do fechamento." };
  if (input.banner && !validMedia(restaurantId, input.banner)) return { error: "Arquivo inválido." };

  const data = await updateRestaurant(restaurantId, {
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
    });
  if (!data) return { error: DENIED };
  if (input.banner !== undefined) {
    const res = await replaceMedia(restaurantId, { banner: restaurantId }, input.banner);
    if (res.error) return res;
  }
  refreshBoth(data.slug);
  return {};
}
