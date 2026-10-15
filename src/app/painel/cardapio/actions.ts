"use server";

import { currentUserId, isMember } from "@/lib/auth";
import * as db from "@/lib/db/nocodb";
import { refreshMenu } from "@/lib/restaurants";
import { TAG_IDS } from "@/lib/menu/tags";
import { suggestTranslation, translationEnabled, type Texts } from "@/lib/translate";
import { autoTranslate } from "@/lib/menu/auto-translate";
import { createUpload, deleteAsset, muxEnabled, videoState, type VideoState } from "@/lib/mux";
import { mediaFilesOf, muxPending, muxRow, removeMedia, replaceMedia, validMedia, type MediaInput } from "@/lib/media-store";

export type { MediaInput };
import { headers } from "next/headers";

type Result = { error?: string };
type Target = { categoryId: string } | { itemId: string };

const FAIL = "Não foi possível salvar. Tente de novo.";
const DENIED = "Entre de novo no painel.";

// Toda ação confere se quem chamou é membro do restaurante, e toda busca filtra por ele.
const UUIDS = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const okId = (id: unknown): id is string => typeof id === "string" && UUIDS.test(id);

const clean = (s: unknown, max: number) => String(s ?? "").trim().slice(0, max);


type CatRow = { Id: number; id: string; name: string; description: string | null };
type ItemRow = {
  Id: number;
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  promo_price_cents: number | null;
  tags: string[] | null;
  position: number | null;
  featured: boolean;
  hide_price: boolean;
  serves: number | null;
  country: string | null;
  price_options: unknown;
};

// ---------- Categorias ----------

export async function createCategory(restaurantId: string, name: string): Promise<Result & { id?: string }> {
  const n = clean(name, 60);
  if (!n) return { error: "Dê um nome para a categoria." };
  if (!(await isMember(restaurantId))) return { error: DENIED };
  try {
    const count = await db.count("categories", { restaurant_id: restaurantId });
    const row = await db.insertOne("categories", {
      restaurant_id: restaurantId,
      name: n,
      description: "",
      position: count,
      active: true,
    });
    await autoTranslate(restaurantId, { categoryId: row.id }, { name: n, description: "" });
    await refreshMenu(restaurantId);
    return { id: row.id };
  } catch {
    return { error: FAIL };
  }
}

export type CategoryInput = {
  name: string;
  active: boolean;
  description?: string;
  // "HH:MM"; os dois vazios = a categoria aparece o dia todo.
  availableFrom?: string | null;
  availableTo?: string | null;
  // Pizza meio a meio: o cliente escolhe 2 sabores desta categoria (preço = média).
  halfHalf?: boolean;
  // undefined = não mexe; null = remove; objeto = foto ou vídeo novo já enviado
  media?: MediaInput | null;
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function updateCategory(restaurantId: string, id: string, input: CategoryInput): Promise<Result> {
  const n = clean(input.name, 60);
  if (!n) return { error: "Dê um nome para a categoria." };
  const from = input.availableFrom || null;
  const to = input.availableTo || null;
  if ((from == null) !== (to == null) || (from && (!TIME.test(from) || !TIME.test(to!) || from === to))) {
    return { error: "Confira o horário da categoria: início e fim diferentes, no formato HH:MM." };
  }
  if (input.media && !validMedia(restaurantId, input.media)) return { error: "Arquivo inválido." };
  if (!okId(id) || !(await isMember(restaurantId))) return { error: DENIED };
  const before = await db.first<CatRow>("categories", { uid: id, restaurant_id: restaurantId });
  if (!before) return { error: FAIL };
  const row: Record<string, unknown> = { name: n, active: !!input.active };
  if (input.halfHalf !== undefined) row.half_half = !!input.halfHalf;
  const description = input.description === undefined ? undefined : clean(input.description, 300);
  if (description !== undefined) {
    Object.assign(row, {
      description,
      available_from: from ? `${from}:00` : null,
      available_to: to ? `${to}:00` : null,
    });
  }
  try {
    await db.updateRows("categories", [{ Id: before.Id, ...row }]);
  } catch {
    return { error: FAIL };
  }
  if (input.media !== undefined) {
    const res = await replaceMedia(restaurantId, { categoryId: id }, input.media);
    if (res.error) return res;
  }
  const desc = description ?? before.description ?? "";
  if (before.name !== n || (before.description ?? "") !== desc) {
    await autoTranslate(restaurantId, { categoryId: id }, { name: n, description: desc });
  }
  await refreshMenu(restaurantId);
  return {};
}

export async function deleteCategory(restaurantId: string, id: string): Promise<Result> {
  if (!okId(id) || !(await isMember(restaurantId))) return { error: DENIED };
  try {
    const files = await mediaFilesOf(restaurantId, { anyInCategory: id });
    const items = await db.list<{ id: string }>("items", { restaurant_id: restaurantId, category_id: id });
    // Sem "on delete cascade" no NocoDB: apaga pratos e traduções junto.
    const trs = await db.list<{ Id: number; category_id: string | null; item_id: string | null }>("translations", {
      restaurant_id: restaurantId,
    });
    const itemIds = new Set(items.map((i) => i.id));
    await db.removeIds(
      "translations",
      trs.filter((t) => t.category_id === id || (t.item_id && itemIds.has(t.item_id))).map((t) => t.Id),
    );
    await db.remove("items", { restaurant_id: restaurantId, category_id: id });
    await db.remove("categories", { restaurant_id: restaurantId, uid: id });
    await removeMedia(files);
  } catch {
    return { error: "Não foi possível excluir a categoria." };
  }
  await refreshMenu(restaurantId);
  return {};
}

export async function reorder(restaurantId: string, table: "categories" | "items", ids: string[]): Promise<Result> {
  if (table !== "categories" && table !== "items") return { error: "Não foi possível mudar a ordem." };
  if (!Array.isArray(ids) || !ids.every(okId) || !(await isMember(restaurantId))) return { error: DENIED };
  try {
    const rows = await db.list<{ Id: number; id: string }>(table, { restaurant_id: restaurantId });
    const pos = new Map(ids.map((id, i) => [id, i]));
    await db.updateRows(
      table,
      rows.filter((r) => pos.has(r.id)).map((r) => ({ Id: r.Id, position: pos.get(r.id)! })),
    );
  } catch {
    return { error: "Não foi possível mudar a ordem." };
  }
  await refreshMenu(restaurantId);
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
  featured?: boolean;
  hidePrice?: boolean;
  serves?: number | null;
  country?: string | null;
  // Múltiplos preços (P, M, G…): substituem o preço único quando há 2 ou mais.
  priceOptions?: { label: string; priceCents: number }[] | null;
  // undefined = não mexe na mídia; null = remove; objeto = foto ou vídeo novo já enviado
  media?: MediaInput | null;
};

export async function saveItem(restaurantId: string, input: ItemInput): Promise<Result & { id?: string }> {
  const name = clean(input.name, 80);
  const description = clean(input.description, 500);
  const price = Math.round(Number(input.priceCents));
  const promo = input.promoCents == null ? null : Math.round(Number(input.promoCents));
  if (!name) return { error: "Dê um nome para o prato." };
  if (!input.priceOptions && (!Number.isFinite(price) || price < 0)) return { error: "Confira o preço." };
  if (!input.priceOptions && promo != null && !(promo >= 0 && promo < price)) {
    return { error: "O preço promocional precisa ser menor que o preço normal." };
  }
  const tags = (input.tags ?? []).filter((t) => (TAG_IDS as string[]).includes(t));
  const m = input.media;
  if (m && !validMedia(restaurantId, m)) return { error: "Arquivo inválido." };
  const options = (input.priceOptions ?? [])
    .map((o) => ({ label: clean(o.label, 30), price_cents: Math.round(Number(o.priceCents)) }))
    .filter((o) => o.label || Number.isFinite(o.price_cents));
  if (input.priceOptions && (options.length < 2 || options.length > 8)) {
    return { error: "Em múltiplos preços, informe de 2 a 8 opções." };
  }
  if (options.some((o) => !o.label || !Number.isFinite(o.price_cents) || o.price_cents < 0)) {
    return { error: "Cada opção de preço precisa de nome e valor." };
  }
  const serves = input.serves == null ? null : Math.round(Number(input.serves));
  if (serves != null && !(serves >= 1 && serves <= 20)) return { error: "Quantidade de pessoas inválida." };
  if (!okId(input.categoryId) || (input.id !== undefined && !okId(input.id)) || !(await isMember(restaurantId))) {
    return { error: DENIED };
  }
  // A categoria precisa ser deste restaurante (antes, a chave estrangeira garantia).
  if (!(await db.first("categories", { uid: input.categoryId, restaurant_id: restaurantId }))) return { error: FAIL };

  const row = {
    category_id: input.categoryId,
    name,
    description,
    price_cents: input.priceOptions ? Math.min(...options.map((o) => o.price_cents)) : price,
    promo_price_cents: input.priceOptions ? null : promo,
    tags,
    active: !!input.active,
    featured: !!input.featured,
    hide_price: !!input.hidePrice,
    serves,
    country: clean(input.country, 40) || null,
    price_options: input.priceOptions ? options : null,
  };

  let id = input.id;
  let textsChanged = true;
  try {
    if (id) {
      const before = await db.first<ItemRow>("items", { uid: id, restaurant_id: restaurantId });
      if (!before) return { error: FAIL };
      textsChanged = before.name !== name || (before.description ?? "") !== description;
      await db.updateRows("items", [{ Id: before.Id, ...row }]);
    } else {
      const count = await db.count("items", { restaurant_id: restaurantId, category_id: input.categoryId });
      id = (await db.insertOne("items", { ...row, restaurant_id: restaurantId, position: count })).id;
    }
  } catch {
    return { error: FAIL };
  }

  if (m !== undefined) {
    const res = await replaceMedia(restaurantId, { itemId: id }, m);
    if (res.error) return { ...res, id };
  }

  if (textsChanged) await autoTranslate(restaurantId, { itemId: id }, { name, description });
  await refreshMenu(restaurantId);
  return { id };
}

export async function deleteItem(restaurantId: string, id: string): Promise<Result> {
  if (!okId(id) || !(await isMember(restaurantId))) return { error: DENIED };
  try {
    const files = await mediaFilesOf(restaurantId, { itemId: id });
    await db.remove("translations", { restaurant_id: restaurantId, item_id: id });
    await db.remove("items", { restaurant_id: restaurantId, uid: id });
    await removeMedia(files);
  } catch {
    return { error: "Não foi possível excluir o prato." };
  }
  await refreshMenu(restaurantId);
  return {};
}

// ---------- Vídeos ----------

// Endereço para o painel mandar o vídeo direto ao Mux, sem passar pelo nosso servidor.
export async function startVideoUpload(
  restaurantId: string,
): Promise<{ error?: string; mux?: boolean; uploadId?: string; url?: string }> {
  if (!(await isMember(restaurantId))) return { error: DENIED };
  if (!muxEnabled()) return { mux: false };
  const origin = (await headers()).get("origin") ?? "*";
  try {
    const up = await createUpload(origin, restaurantId);
    return { mux: true, uploadId: up.id, url: up.url };
  } catch (e) {
    // Aparece nos logs da Vercel: mostra se é chave errada (401/403) ou limite da conta.
    console.error("mux upload", String(e).slice(0, 300));
    return { error: "Não foi possível preparar o envio do vídeo. Tente de novo." };
  }
}

// Vídeo enviado e não salvo: apaga no Mux para não ocupar a conta.
export async function discardVideo(uploadId: string) {
  if (!muxEnabled()) return;
  if (!(await currentUserId())) return;
  for (let k = 0; k < 4; k++) {
    const st = await videoState(uploadId).catch((): VideoState => ({ status: "failed" }));
    if ("assetId" in st && st.assetId) return deleteAsset(st.assetId);
    if (st.status === "failed") return;
    await new Promise((r) => setTimeout(r, 2500));
  }
}

type PendingRow = { Id: number; status: string | null; mux_upload_id: string | null; mux_mp4: string | null };

// Confere no Mux os vídeos ainda em preparo; os prontos passam a aparecer no cardápio.
export async function syncVideos(restaurantId: string): Promise<{ pending: number }> {
  if (!muxEnabled() || !(await isMember(restaurantId))) return { pending: 0 };
  const rows = (await db.list<PendingRow>("media", { restaurant_id: restaurantId })).filter(muxPending);
  let pending = 0;
  let changed = false;
  for (const m of rows) {
    const row = await muxRow(m.mux_upload_id!);
    if (row.status === "processing" || (row.status === "ready" && row.mux_mp4 == null)) pending++;
    if (row.status !== m.status || ("mux_mp4" in row && row.mux_mp4 !== m.mux_mp4)) {
      changed = true;
      await db.updateRows("media", [{ Id: m.Id, ...row }]);
    }
  }
  if (changed) await refreshMenu(restaurantId);
  return { pending };
}

// Cópia sem foto (o arquivo é do prato original) e escondida, para o dono ajustar antes.
export async function duplicateItem(restaurantId: string, id: string): Promise<Result & { id?: string }> {
  if (!okId(id) || !(await isMember(restaurantId))) return { error: DENIED };
  try {
    const it = await db.first<ItemRow>("items", { uid: id, restaurant_id: restaurantId });
    if (!it) return { error: FAIL };
    const copy = await db.insertOne("items", {
      restaurant_id: restaurantId,
      category_id: it.category_id,
      name: `${it.name} (cópia)`.slice(0, 80),
      description: it.description ?? "",
      price_cents: it.price_cents,
      promo_price_cents: it.promo_price_cents,
      tags: it.tags ?? [],
      position: (it.position ?? 0) + 1,
      active: false,
      featured: it.featured,
      hide_price: it.hide_price,
      serves: it.serves,
      country: it.country,
      price_options: it.price_options ?? null,
    });
    const tr = await db.list<{ language: string; name: string; description: string | null; auto: boolean }>(
      "translations",
      { restaurant_id: restaurantId, item_id: id },
    );
    await db.insert(
      "translations",
      tr.map((t) => ({
        restaurant_id: restaurantId,
        item_id: copy.id,
        language: t.language,
        name: t.name,
        description: t.description ?? "",
        auto: t.auto,
      })),
    );
    await refreshMenu(restaurantId);
    return { id: copy.id };
  } catch {
    return { error: FAIL };
  }
}

// ---------- Traduções ----------

export type TranslationRow = { language: string; name: string; description: string };

const LANG = /^[a-z]{2}(-[A-Z]{2})?$/;

// Salva o que o dono revisou: vira tradução aprovada (auto = false). Nome vazio apaga.
export async function saveTranslations(restaurantId: string, target: Target, rows: TranslationRow[]): Promise<Result> {
  const col = "itemId" in target ? "item_id" : "category_id";
  const id = "itemId" in target ? target.itemId : target.categoryId;
  if (!okId(id) || !(await isMember(restaurantId))) return { error: DENIED };
  try {
    const parent = await db.first(col === "item_id" ? "items" : "categories", { uid: id, restaurant_id: restaurantId });
    if (!parent) return { error: FAIL };
    const existing = await db.list<{ Id: number; language: string }>("translations", {
      restaurant_id: restaurantId,
      [col]: id,
    });
    const del: number[] = [];
    const upd: { Id: number; name: string; description: string; auto: boolean }[] = [];
    const ins: Record<string, unknown>[] = [];
    for (const r of rows) {
      if (!LANG.test(String(r.language))) continue;
      const name = clean(r.name, 80);
      const description = clean(r.description, 500);
      const row = existing.find((e) => e.language === r.language);
      if (!name) {
        if (row) del.push(row.Id);
      } else if (row) upd.push({ Id: row.Id, name, description, auto: false });
      else ins.push({ restaurant_id: restaurantId, [col]: id, language: r.language, name, description, auto: false });
    }
    await db.removeIds("translations", del);
    await db.updateRows("translations", upd);
    await db.insert("translations", ins);
  } catch {
    return { error: "Não foi possível salvar as traduções." };
  }
  await refreshMenu(restaurantId);
  return {};
}

export async function suggestTranslations(
  texts: Texts,
  languages: string[],
): Promise<{ error?: string; suggestions?: Record<string, Texts> }> {
  if (!translationEnabled()) return { error: "A sugestão automática ainda não está ligada neste sistema." };
  // Só quem está logado no painel usa o serviço de tradução (ele tem custo).
  if (!(await currentUserId())) return { error: "Entre de novo no painel." };
  const pairs = await Promise.all(
    languages.filter((l) => l !== "pt-BR").map(async (l) => [l, await suggestTranslation(texts, l).catch(() => null)] as const),
  );
  const suggestions = Object.fromEntries(pairs.filter(([, v]) => v)) as Record<string, Texts>;
  if (!Object.keys(suggestions).length) return { error: "Não foi possível sugerir agora. Tente de novo." };
  return { suggestions };
}
