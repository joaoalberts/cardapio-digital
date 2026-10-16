import { NextResponse, type NextRequest } from "next/server";
import * as db from "@/lib/db/nocodb";
import { cacheControl } from "@/lib/comunidade/public-state";
import { getCommunityContent, getCommunityHead } from "@/lib/comunidade/server";
import { communityOff, parseBefore, readPublicState, type VoteDeps } from "@/lib/comunidade/votes";
import { isValidSlug } from "@/lib/slug";

// Leitura pública agregada da Comunidade: uma resposta única por restaurante, igual para
// todo mundo (sem mesa nem device na URL), para a CDN servir celulares e telão sem chamar
// a função. Só porcentagem; nunca contagem, device, mesa nem post oculto.
const deps: VoteDeps = { db, getHead: getCommunityHead, getContent: getCommunityContent, off: communityOff };
const CACHE_OFF = "public, max-age=0, s-maxage=60";
const NO_STORE = "no-store";

type Ctx = { params: Promise<{ slug: string }> };

const json = (body: unknown, status: number, cache: string) =>
  NextResponse.json(body, { status, headers: { "cache-control": cache } });

export async function GET(request: NextRequest, { params }: Ctx) {
  const slug = (await params).slug.toLowerCase();
  if (!isValidSlug(slug)) return json({ ok: false, code: "not_found" }, 404, CACHE_OFF);

  // ?antes= pagina o Mural pelo created_at do último post visto.
  const raw = request.nextUrl.searchParams.get("antes");
  const before = raw === null ? undefined : parseBefore(raw);
  if (before === null) return json({ ok: false, code: "invalid" }, 400, NO_STORE);

  try {
    const state = await readPublicState(deps, slug, before);
    if (!state) return json({ ok: false, code: "not_found" }, 404, CACHE_OFF);
    return json(state, 200, cacheControl(state));
  } catch {
    return json({ ok: false, code: "error" }, 503, NO_STORE);
  }
}
