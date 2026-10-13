import "server-only";

import * as db from "@/lib/db/nocodb";
import { deleteAsset, videoState, type VideoState } from "@/lib/mux";
import { ownsFile, removeFiles } from "@/lib/storage";

// Fotos e vídeos de pratos, categorias e do banner da capa: mesma tabela "media".

// Foto: arquivo e miniatura no Blob. Vídeo: capa no Blob e o arquivo no Mux (uploadId)
// ou, sem Mux, um arquivo (path).
export type MediaInput =
  | { kind: "photo"; path: string; thumb: string }
  | { kind: "video"; poster: string; uploadId?: string; path?: string };

type Result = { error?: string };

type Owner = { itemId: string } | { categoryId: string } | { banner: string };

type MediaRow = {
  Id: number;
  item_id: string | null;
  category_id: string | null;
  storage_path: string | null;
  poster_path: string | null;
  mux_asset_id: string | null;
};

export function validMedia(restaurantId: string, m: MediaInput) {
  const paths = m.kind === "photo" ? [m.path, m.thumb] : [m.poster, ...(m.path ? [m.path] : [])];
  return (
    paths.every((p) => typeof p === "string" && ownsFile(restaurantId, p)) &&
    (m.kind === "photo" || !!m.uploadId || !!m.path)
  );
}

// Linhas de mídia de um dono; "anyInCategory" junta a categoria e os pratos dela.
async function rowsOf(restaurantId: string, of: Owner | { anyInCategory: string }): Promise<MediaRow[]> {
  if ("itemId" in of) return db.list<MediaRow>("media", { restaurant_id: restaurantId, item_id: of.itemId });
  if ("categoryId" in of) return db.list<MediaRow>("media", { restaurant_id: restaurantId, category_id: of.categoryId });
  if ("banner" in of) return db.list<MediaRow>("media", { restaurant_id: restaurantId, item_id: null, category_id: null });
  const items = await db.list<{ id: string }>("items", { restaurant_id: restaurantId, category_id: of.anyInCategory });
  const ids = new Set(items.map((i) => i.id));
  const all = await db.list<MediaRow>("media", { restaurant_id: restaurantId });
  return all.filter((m) => m.category_id === of.anyInCategory || (m.item_id && ids.has(m.item_id)));
}

export type MediaFiles = { ids: number[]; files: string[]; assets: string[] };

// Arquivos (Blob) e vídeos (Mux) de um dono, para apagar depois.
export async function mediaFilesOf(restaurantId: string, of: Owner | { anyInCategory: string }): Promise<MediaFiles> {
  const rows = await rowsOf(restaurantId, of);
  return {
    ids: rows.map((m) => m.Id),
    files: rows
      .flatMap((m) => [m.storage_path, m.poster_path])
      .filter((p): p is string => !!p && !p.startsWith("/")),
    assets: rows.map((m) => m.mux_asset_id).filter((a): a is string => !!a),
  };
}

// Apaga as linhas de mídia que sobraram e os arquivos delas.
export async function removeMedia(old: MediaFiles) {
  await db.removeIds("media", old.ids).catch(() => undefined);
  await removeFiles(old.files);
  await Promise.all(old.assets.map((a) => deleteAsset(a).catch(() => undefined)));
}

// Troca a foto/vídeo de um prato, categoria ou banner: grava a nova e apaga a antiga.
export async function replaceMedia(restaurantId: string, owner: Owner, m: MediaInput | null): Promise<Result> {
  const old = await mediaFilesOf(restaurantId, owner);
  if (m) {
    const row =
      m.kind === "photo"
        ? { kind: "photo", storage_path: m.path, poster_path: m.thumb, status: "ready" }
        : m.uploadId
          ? { kind: "video", mux_upload_id: m.uploadId, poster_path: m.poster, ...(await muxRow(m.uploadId)) }
          : { kind: "video", storage_path: m.path, poster_path: m.poster, status: "ready" };
    const ownerCols =
      "itemId" in owner
        ? { item_id: owner.itemId }
        : "categoryId" in owner
          ? { category_id: owner.categoryId }
          : {};
    try {
      await db.insertOne("media", { restaurant_id: restaurantId, ...ownerCols, position: 0, ...row });
    } catch {
      return { error: "Os dados foram salvos, mas a foto ou o vídeo não. Tente enviar de novo." };
    }
  }
  await removeMedia(old);
  return {};
}

// Vídeos do Mux que ainda pedem conferência: em preparo, ou prontos sem saber do MP4 leve.
export function muxPending(m: { status: string | null; mux_mp4: string | null; mux_upload_id: string | null }) {
  return !!m.mux_upload_id && (m.status === "processing" || (m.status === "ready" && m.mux_mp4 == null));
}

export async function muxRow(uploadId: string) {
  const st = await videoState(uploadId).catch((): VideoState => ({ status: "processing" }));
  if (st.status === "ready")
    return { status: "ready", mux_asset_id: st.assetId, mux_playback_id: st.playbackId, mux_mp4: st.mp4 };
  if (st.status === "failed") return { status: "failed" };
  return { status: "processing", mux_asset_id: st.assetId ?? null };
}
