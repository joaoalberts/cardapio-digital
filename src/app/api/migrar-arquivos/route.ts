import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/auth";
import * as db from "@/lib/db/nocodb";
import { refreshMenu } from "@/lib/restaurants";
import { putFile, storageEnabled } from "@/lib/storage";

// Uso único, na troca do Supabase: copia para o Vercel Blob as fotos, capas e logos dos
// restaurantes do usuário logado que ainda apontam para o Supabase Storage, e grava as
// URLs novas no NocoDB. Pode rodar de novo: só copia o que falta.

const legacy = (p: unknown): p is string => typeof p === "string" && !!p && !p.startsWith("/") && !/^https?:/.test(p);

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Entre no painel primeiro." }, { status: 401 });
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base || !storageEnabled()) {
    return NextResponse.json({ error: "Faltam NEXT_PUBLIC_SUPABASE_URL ou BLOB_READ_WRITE_TOKEN." }, { status: 503 });
  }

  const copied = new Map<string, string>();
  const failed: string[] = [];
  const copy = async (path: string) => {
    if (copied.has(path)) return copied.get(path)!;
    const res = await fetch(`${base}/storage/v1/object/public/media/${path.split("/").map(encodeURIComponent).join("/")}`);
    if (!res.ok) throw new Error(`${res.status}`);
    const url = await putFile(path, await res.arrayBuffer(), res.headers.get("content-type") ?? "application/octet-stream");
    copied.set(path, url);
    return url;
  };

  const owned = await db.list<{ restaurant_id: string; role: string }>("members", { user_id: userId });
  for (const { restaurant_id: rid } of owned.filter((m) => m.role === "owner")) {
    const r = await db.first<{ Id: number; logo_path: string | null }>("restaurants", { uid: rid });
    if (r && legacy(r.logo_path)) {
      try {
        await db.updateRows("restaurants", [{ Id: r.Id, logo_path: await copy(r.logo_path) }]);
      } catch {
        failed.push(r.logo_path);
      }
    }
    const media = await db.list<{ Id: number; storage_path: string | null; poster_path: string | null }>("media", {
      restaurant_id: rid,
    });
    for (const m of media) {
      const patch: Record<string, string> = {};
      for (const col of ["storage_path", "poster_path"] as const) {
        const p = m[col];
        if (!legacy(p)) continue;
        try {
          patch[col] = await copy(p);
        } catch {
          failed.push(p);
        }
      }
      if (Object.keys(patch).length) await db.updateRows("media", [{ Id: m.Id, ...patch }]);
    }
    await refreshMenu(rid);
  }
  return NextResponse.json({ copied: copied.size, failed });
}
