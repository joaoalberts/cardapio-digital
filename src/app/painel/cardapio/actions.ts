"use server";

import { updateTag } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { menuTag } from "@/lib/menu/data";
import { TAG_IDS } from "@/lib/menu/tags";
import { suggestTranslation, translationEnabled, type Texts } from "@/lib/translate";
import { autoTranslate } from "@/lib/menu/auto-translate";

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
  if (files.length) await supabase.storage.from("media").remove(files);
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
  // undefined = não mexe na foto; null = remove; objeto = foto nova já enviada ao Storage
  photo?: { path: string; thumb: string } | null;
};

async function mediaFilesOf(supabase: SupabaseClient, of: { itemId: string } | { categoryId: string }) {
  let q = supabase.from("media").select("storage_path, poster_path, items!inner(category_id)");
  q = "itemId" in of ? q.eq("item_id", of.itemId) : q.eq("items.category_id", of.categoryId);
  const { data } = await q;
  return (data ?? [])
    .flatMap((m) => [m.storage_path, m.poster_path])
    .filter((p): p is string => !!p && !p.startsWith("/") && !/^https?:/.test(p));
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
  if (input.photo && ![input.photo.path, input.photo.thumb].every((p) => p.startsWith(`${restaurantId}/`))) {
    return { error: "Foto inválida." };
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

  if (input.photo !== undefined) {
    const old = await mediaFilesOf(supabase, { itemId: id });
    await supabase.from("media").delete().eq("item_id", id).eq("kind", "photo");
    if (input.photo) {
      const { error } = await supabase.from("media").insert({
        restaurant_id: restaurantId,
        item_id: id,
        kind: "photo",
        storage_path: input.photo.path,
        poster_path: input.photo.thumb,
        status: "ready",
      });
      if (error) return { error: "O prato foi salvo, mas a foto não. Tente enviar de novo.", id };
    }
    if (old.length) await supabase.storage.from("media").remove(old);
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
  if (files.length) await supabase.storage.from("media").remove(files);
  await refreshMenu(supabase, restaurantId);
  return {};
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
