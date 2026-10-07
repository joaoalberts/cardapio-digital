"use server";

import { updateTag } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { menuTag } from "@/lib/menu/data";
import { TAG_IDS } from "@/lib/menu/tags";
import { suggestTranslation, translationEnabled, type Texts } from "@/lib/translate";
import { autoTranslate } from "@/lib/menu/auto-translate";
import { createUpload, deleteAsset, muxEnabled, videoState, type VideoState } from "@/lib/mux";
import { headers } from "next/headers";

type Result = { error?: string };
type Target = { categoryId: string } | { itemId: string };

const FAIL = "Não foi possível salvar. Tente de novo.";

// Depois de cada mudança, o cardápio público em cache é refeito na próxima visita.
async function refreshMenu(supabase: SupabaseClient, restaurantId: string) {
  const { data } = await supabase.from("restaurants").select("slug").eq("id", restaurantId).maybeSingle();
  if (data) updateTag(menuTag(data.slug));
}

const clean = (s: unknown, max: number) => String(s ?? "").trim().slice(0, max);

// ---------- Categorias ----------

export async function createCategory(restaurantId: string, name: string): Promise<Result & { id?: string }> {
  const n = clean(name, 60);
  if (!n) return { error: "Dê um nome para a categoria." };
  const supabase = await createClient();
  const { count } = await supabase
    .from("categories")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId);
  const { data, error } = await supabase
    .from("categories")
    .insert({ restaurant_id: restaurantId, name: n, position: count ?? 0 })
    .select("id")
    .single();
  if (error) return { error: FAIL };
  await autoTranslate(supabase, restaurantId, { categoryId: data.id }, { name: n, description: "" });
  await refreshMenu(supabase, restaurantId);
  return { id: data.id };
}

export async function updateCategory(
  restaurantId: string,
  id: string,
  input: { name: string; active: boolean },
): Promise<Result> {
  const n = clean(input.name, 60);
  if (!n) return { error: "Dê um nome para a categoria." };
  const supabase = await createClient();
  const { data: before } = await supabase.from("categories").select("name").eq("id", id).maybeSingle();
  const { error } = await supabase.from("categories").update({ name: n, active: input.active }).eq("id", id);
  if (error) return { error: FAIL };
  if (before?.name !== n) await autoTranslate(supabase, restaurantId, { categoryId: id }, { name: n, description: "" });
  await refreshMenu(supabase, restaurantId);
  return {};
}

export async function deleteCategory(restaurantId: string, id: string): Promise<Result> {
  const supabase = await createClient();
  const files = await mediaFilesOf(supabase, { categoryId: id });
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) return { error: "Não foi possível excluir a categoria." };
  await removeMedia(supabase, files);
  await refreshMenu(supabase, restaurantId);
  return {};
}

export async function reorder(restaurantId: string, table: "categories" | "items", ids: string[]): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_positions", { p_table: table, p_ids: ids });
  if (error) return { error: "Não foi possível mudar a ordem." };
  await refreshMenu(supabase, restaurantId);
  return {};
}

// ---------- Pratos ----------

export type ItemInput = {
  id?: string;
  categoryId: string;
  name: string;
  description: string;
  priceCents: number;
  promoCents: number | null;
  tags: string[];
  active: boolean;
  // undefined = não mexe na mídia; null = remove; objeto = foto ou vídeo novo já enviado
  media?: MediaInput | null;
};

// Foto: arquivo e miniatura no Storage. Vídeo: capa no Storage e o arquivo no Mux
// (uploadId) ou, sem Mux, no próprio Storage (path).
export type MediaInput =
  | { kind: "photo"; path: string; thumb: string }
  | { kind: "video"; poster: string; uploadId?: string; path?: string };

async function mediaFilesOf(supabase: SupabaseClient, of: { itemId: string } | { categoryId: string }) {
  let q = supabase.from("media").select("storage_path, poster_path, mux_asset_id, items!inner(category_id)");
  q = "itemId" in of ? q.eq("item_id", of.itemId) : q.eq("items.category_id", of.categoryId);
  const { data } = await q;
  const files = (data ?? [])
    .flatMap((m) => [m.storage_path, m.poster_path])
    .filter((p): p is string => !!p && !p.startsWith("/") && !/^https?:/.test(p));
  const assets = (data ?? []).map((m) => m.mux_asset_id).filter((a): a is string => !!a);
  return Object.assign(files, { assets });
}

async function removeMedia(supabase: SupabaseClient, old: Awaited<ReturnType<typeof mediaFilesOf>>) {
  if (old.length) await supabase.storage.from("media").remove(old);
  await Promise.all(old.assets.map(deleteAsset));
}

export async function saveItem(restaurantId: string, input: ItemInput): Promise<Result & { id?: string }> {
  const name = clean(input.name, 80);
  const description = clean(input.description, 500);
  const price = Math.round(Number(input.priceCents));
  const promo = input.promoCents == null ? null : Math.round(Number(input.promoCents));
  if (!name) return { error: "Dê um nome para o prato." };
  if (!Number.isFinite(price) || price < 0) return { error: "Confira o preço." };
  if (promo != null && !(promo >= 0 && promo < price)) {
    return { error: "O preço promocional precisa ser menor que o preço normal." };
  }
  const tags = input.tags.filter((t) => (TAG_IDS as string[]).includes(t));
  const m = input.media;
  const paths = !m ? [] : m.kind === "photo" ? [m.path, m.thumb] : [m.poster, ...(m.path ? [m.path] : [])];
  if (!paths.every((p) => p.startsWith(`${restaurantId}/`)) || (m?.kind === "video" && !m.uploadId && !m.path)) {
    return { error: "Arquivo inválido." };
  }

  const supabase = await createClient();
  const row = {
    category_id: input.categoryId,
    name,
    description,
    price_cents: price,
    promo_price_cents: promo,
    tags,
    active: input.active,
  };

  let id = input.id;
  let textsChanged = true;
  if (id) {
    const { data: before } = await supabase.from("items").select("name, description").eq("id", id).maybeSingle();
    textsChanged = before?.name !== name || before?.description !== description;
    const { error } = await supabase.from("items").update(row).eq("id", id);
    if (error) return { error: FAIL };
  } else {
    const { count } = await supabase
      .from("items")
      .select("id", { count: "exact", head: true })
      .eq("category_id", input.categoryId);
    const { data, error } = await supabase
      .from("items")
      .insert({ ...row, restaurant_id: restaurantId, position: count ?? 0 })
      .select("id")
      .single();
    if (error) return { error: FAIL };
    id = data.id as string;
  }

  if (m !== undefined) {
    const old = await mediaFilesOf(supabase, { itemId: id });
    await supabase.from("media").delete().eq("item_id", id);
    if (m) {
      const row =
        m.kind === "photo"
          ? { kind: "photo", storage_path: m.path, poster_path: m.thumb, status: "ready" }
          : m.uploadId
            ? { kind: "video", mux_upload_id: m.uploadId, poster_path: m.poster, ...(await muxRow(m.uploadId)) }
            : { kind: "video", storage_path: m.path, poster_path: m.poster, status: "ready" };
      const { error } = await supabase.from("media").insert({ restaurant_id: restaurantId, item_id: id, ...row });
      if (error) return { error: "O prato foi salvo, mas a foto ou o vídeo não. Tente enviar de novo.", id };
    }
    await removeMedia(supabase, old);
  }

  if (textsChanged) await autoTranslate(supabase, restaurantId, { itemId: id }, { name, description });
  await refreshMenu(supabase, restaurantId);
  return { id };
}

export async function deleteItem(restaurantId: string, id: string): Promise<Result> {
  const supabase = await createClient();
  const files = await mediaFilesOf(supabase, { itemId: id });
  const { error } = await supabase.from("items").delete().eq("id", id);
  if (error) return { error: "Não foi possível excluir o prato." };
  await removeMedia(supabase, files);
  await refreshMenu(supabase, restaurantId);
  return {};
}

// ---------- Vídeos ----------

async function muxRow(uploadId: string) {
  const st = await videoState(uploadId).catch((): VideoState => ({ status: "processing" }));
  if (st.status === "ready") return { status: "ready", mux_asset_id: st.assetId, mux_playback_id: st.playbackId };
  if (st.status === "failed") return { status: "failed" };
  return { status: "processing", mux_asset_id: st.assetId ?? null };
}

// Endereço para o painel mandar o vídeo direto ao Mux, sem passar pelo nosso servidor.
export async function startVideoUpload(
  restaurantId: string,
): Promise<{ error?: string; mux?: boolean; uploadId?: string; url?: string }> {
  const supabase = await createClient();
  const { data } = await supabase.from("restaurants").select("id").eq("id", restaurantId).maybeSingle();
  if (!data) return { error: "Entre de novo no painel." };
  if (!muxEnabled()) return { mux: false };
  const origin = (await headers()).get("origin") ?? "*";
  try {
    const up = await createUpload(origin, restaurantId);
    return { mux: true, uploadId: up.id, url: up.url };
  } catch {
    return { error: "Não foi possível preparar o envio do vídeo. Tente de novo." };
  }
}

// Vídeo enviado e não salvo: apaga no Mux para não ocupar a conta.
export async function discardVideo(uploadId: string) {
  if (!muxEnabled()) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  for (let k = 0; k < 4; k++) {
    const st = await videoState(uploadId).catch((): VideoState => ({ status: "failed" }));
    if ("assetId" in st && st.assetId) return deleteAsset(st.assetId);
    if (st.status === "failed") return;
    await new Promise((r) => setTimeout(r, 2500));
  }
}

// Confere no Mux os vídeos ainda em preparo; os prontos passam a aparecer no cardápio.
export async function syncVideos(restaurantId: string): Promise<{ pending: number }> {
  if (!muxEnabled()) return { pending: 0 };
  const supabase = await createClient();
  const { data } = await supabase
    .from("media")
    .select("id, mux_upload_id")
    .eq("restaurant_id", restaurantId)
    .eq("status", "processing")
    .not("mux_upload_id", "is", null);
  let pending = 0;
  let changed = false;
  for (const m of data ?? []) {
    const row = await muxRow(m.mux_upload_id!);
    if (row.status === "processing") pending++;
    else changed = true;
    await supabase.from("media").update(row).eq("id", m.id);
  }
  if (changed) await refreshMenu(supabase, restaurantId);
  return { pending };
}

// Cópia sem foto (o arquivo é do prato original) e escondida, para o dono ajustar antes.
export async function duplicateItem(restaurantId: string, id: string): Promise<Result & { id?: string }> {
  const supabase = await createClient();
  const { data: it } = await supabase
    .from("items")
    .select("category_id, name, description, price_cents, promo_price_cents, tags, position")
    .eq("id", id)
    .maybeSingle();
  if (!it) return { error: FAIL };
  const { data, error } = await supabase
    .from("items")
    .insert({ ...it, restaurant_id: restaurantId, name: `${it.name} (cópia)`.slice(0, 80), active: false, position: it.position + 1 })
    .select("id")
    .single();
  if (error) return { error: FAIL };
  const { data: tr } = await supabase.from("translations").select("language, name, description, auto").eq("item_id", id);
  if (tr?.length) {
    await supabase
      .from("translations")
      .insert(tr.map((t) => ({ ...t, restaurant_id: restaurantId, item_id: data.id })));
  }
  await refreshMenu(supabase, restaurantId);
  return { id: data.id };
}

// ---------- Traduções ----------

export type TranslationRow = { language: string; name: string; description: string };

// Salva o que o dono revisou: vira tradução aprovada (auto = false). Nome vazio apaga.
export async function saveTranslations(restaurantId: string, target: Target, rows: TranslationRow[]): Promise<Result> {
  const supabase = await createClient();
  const col = "itemId" in target ? "item_id" : "category_id";
  const id = "itemId" in target ? target.itemId : target.categoryId;
  const { data: existing } = await supabase.from("translations").select("id, language").eq(col, id);
  for (const r of rows) {
    const name = clean(r.name, 80);
    const description = clean(r.description, 500);
    const row = existing?.find((e) => e.language === r.language);
    const res = !name
      ? row
        ? await supabase.from("translations").delete().eq("id", row.id)
        : { error: null }
      : row
        ? await supabase.from("translations").update({ name, description, auto: false }).eq("id", row.id)
        : await supabase
            .from("translations")
            .insert({ restaurant_id: restaurantId, [col]: id, language: r.language, name, description, auto: false });
    if (res.error) return { error: "Não foi possível salvar as traduções." };
  }
  await refreshMenu(supabase, restaurantId);
  return {};
}

export async function suggestTranslations(
  texts: Texts,
  languages: string[],
): Promise<{ error?: string; suggestions?: Record<string, Texts> }> {
  if (!translationEnabled()) return { error: "A sugestão automática ainda não está ligada neste sistema." };
  // Só quem está logado no painel usa o serviço de tradução (ele tem custo).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Entre de novo no painel." };
  const pairs = await Promise.all(
    languages.filter((l) => l !== "pt-BR").map(async (l) => [l, await suggestTranslation(texts, l).catch(() => null)] as const),
  );
  const suggestions = Object.fromEntries(pairs.filter(([, v]) => v)) as Record<string, Texts>;
  if (!Object.keys(suggestions).length) return { error: "Não foi possível sugerir agora. Tente de novo." };
  return { suggestions };
}
