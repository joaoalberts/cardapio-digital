import { NextResponse, type NextRequest } from "next/server";
import * as db from "@/lib/db/nocodb";
import { communityOff } from "@/lib/comunidade/off";
import { getCommunityContent, getCommunityHead } from "@/lib/comunidade/server";
import { PUBLIC_CACHE_NOT_FOUND, answerPublicRead, type VoteDeps } from "@/lib/comunidade/votes";
import { isValidSlug } from "@/lib/slug";

// Leitura pública agregada da Comunidade: uma resposta única por restaurante, igual para
// todo mundo (sem mesa nem device na URL), para a CDN servir celulares e telão sem chamar
// a função. Só porcentagem; nunca contagem, device, mesa nem post oculto. ?antes= pagina o
// Mural e só vale com o created_at de um post dele; erro do banco fica 5 s na CDN.
const deps: VoteDeps = { db, getHead: getCommunityHead, getContent: getCommunityContent, off: communityOff };

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  const slug = (await params).slug.toLowerCase();
  if (!isValidSlug(slug)) {
    return NextResponse.json({ ok: false, code: "not_found" }, { status: 404, headers: { "cache-control": PUBLIC_CACHE_NOT_FOUND } });
  }
  const r = await answerPublicRead(deps, slug, request.nextUrl.searchParams.get("antes"));
  return NextResponse.json(r.body, { status: r.status, headers: { "cache-control": r.cache } });
}
