import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteAsset, videoState, type VideoState } from "@/lib/mux";

// Fotos e vídeos de pratos, categorias e do banner da capa: mesma tabela "media".

// Foto: arquivo e miniatura no Storage. Vídeo: capa no Storage e o arquivo no Mux
// (uploadId) ou, sem Mux, no próprio Storage (path).
export type MediaInput =
  | { kind: "photo"; path: string; thumb: string }
  | { kind: "video"; poster: string; uploadId?: string; path?: string };

type Result = { error?: string };

type Owner = { itemId: string } | { categoryId: string } | { banner: string };

export function validMedia(restaurantId: string, m: MediaInput) {
  const paths = m.kind === "photo" ? [m.path, m.thumb] : [m.poster, ...(m.path ? [m.path] : [])];
  return paths.every((p) => p.startsWith(`${restaurantId}/`)) && (m.kind === "photo" || !!m.uploadId || !!m.path);
}

// Arquivos (Storage) e vídeos (Mux) de um dono; "anyInCategory" junta a categoria e os pratos dela.
export async function mediaFilesOf(supabase: SupabaseClient, of: Owner | { anyInCategory: string }) {
  const q = supabase.from("media").select("storage_path, poster_path, mux_asset_id");
  const { data } =
    "itemId" in of
      ? await q.eq("item_id", of.itemId)
      : "categoryId" in of
        ? await q.eq("category_id", of.categoryId)
        : "banner" in of
          ? await q.eq("restaurant_id", of.banner).is("item_id", null).is("category_id", null)
          : await (async () => {
              const { data: its } = await supabase.from("items").select("id").eq("category_id", of.anyInCategory);
              const ids = (its ?? []).map((i) => i.id as string);
              return q.or(
                [`category_id.eq.${of.anyInCategory}`, ...(ids.length ? [`item_id.in.(${ids.join(",")})`] : [])].join(","),
              );
            })();
  const files = (data ?? [])
    .flatMap((m) => [m.storage_path, m.poster_path])
    .filter((p): p is string => !!p && !p.startsWith("/") && !/^https?:/.test(p));
  const assets = (data ?? []).map((m) => m.mux_asset_id).filter((a): a is string => !!a);
  return Object.assign(files, { assets });
}

export async function removeMedia(supabase: SupabaseClient, old: Awaited<ReturnType<typeof mediaFilesOf>>) {
  if (old.length) await supabase.storage.from("media").remove(old);
  await Promise.all(old.assets.map(deleteAsset));
}

// Troca a foto/vídeo de um prato, categoria ou banner: grava a nova e apaga a antiga.
export async function replaceMedia(
  supabase: SupabaseClient,
  restaurantId: string,
  owner: Owner,
  m: MediaInput | null,
): Promise<Result> {
  const old = await mediaFilesOf(supabase, owner);
  const del = supabase.from("media").delete();
  if ("itemId" in owner) await del.eq("item_id", owner.itemId);
  else if ("categoryId" in owner) await del.eq("category_id", owner.categoryId);
  else await del.eq("restaurant_id", restaurantId).is("item_id", null).is("category_id", null);
  if (m) {
    const row =
      m.kind === "photo"
        ? { kind: "photo", storage_path: m.path, poster_path: m.thumb, status: "ready" }
        : m.uploadId
          ? { kind: "video", mux_upload_id: m.uploadId, poster_path: m.poster, ...(await muxRow(m.uploadId)) }
          : { kind: "video", storage_path: m.path, poster_path: m.poster, status: "ready" };
    const ownerCols =
      "itemId" in owner ? { item_id: owner.itemId } : "categoryId" in owner ? { category_id: owner.categoryId } : {};
    const { error } = await supabase.from("media").insert({ restaurant_id: restaurantId, ...ownerCols, ...row });
    if (error) return { error: "Os dados foram salvos, mas a foto ou o vídeo não. Tente enviar de novo." };
  }
  await removeMedia(supabase, old);
  return {};
}

// Vídeos do Mux que ainda pedem conferência: em preparo, ou prontos sem saber do MP4 leve.
export const MUX_PENDING = "status.eq.processing,and(status.eq.ready,mux_mp4.is.null)";

export async function muxRow(uploadId: string) {
  const st = await videoState(uploadId).catch((): VideoState => ({ status: "processing" }));
  if (st.status === "ready")
    return { status: "ready", mux_asset_id: st.assetId, mux_playback_id: st.playbackId, mux_mp4: st.mp4 };
  if (st.status === "failed") return { status: "failed" };
  return { status: "processing", mux_asset_id: st.assetId ?? null };
}

