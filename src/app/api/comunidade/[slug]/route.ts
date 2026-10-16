import { NextResponse, type NextRequest } from "next/server";
import * as db from "@/lib/db/nocodb";
import { communityOff } from "@/lib/comunidade/off";
import { getCommunityContent, getCommunityHead } from "@/lib/comunidade/server";
import { PUBLIC_CACHE_NOT_FOUND, answerPublicRead, parsePublicQuery, type VoteDeps } from "@/lib/comunidade/votes";
import { isValidSlug } from "@/lib/slug";

// Leitura pública agregada da Comunidade: uma resposta única por restaurante, igual para
// todo mundo (sem mesa nem device na URL), para a CDN servir celulares e telão sem chamar
// a função. Só porcentagem; nunca contagem, device, mesa nem post oculto. ?antes= pagina o
// Mural e só vale com o created_at de um post dele; qualquer outro parâmetro é 400 (cada URL
// nova furaria a CDN). Erro do banco fica 5 s na CDN.
const deps: VoteDeps = { db, getHead: getCommunityHead, getContent: getCommunityContent, off: communityOff };

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  const slug = (await params).slug.toLowerCase();
  if (!isValidSlug(slug)) {
    return NextResponse.json({ ok: false, code: "not_found" }, { status: 404, headers: { "cache-control": PUBLIC_CACHE_NOT_FOUND } });
  }
  const q = parsePublicQuery(request.nextUrl.searchParams);
  if (!q) return NextResponse.json({ ok: false, code: "invalid" }, { status: 400, headers: { "cache-control": "no-store" } });
  const r = await answerPublicRead(deps, slug, q.antes);
  return NextResponse.json(r.body, { status: r.status, headers: { "cache-control": r.cache } });
}
