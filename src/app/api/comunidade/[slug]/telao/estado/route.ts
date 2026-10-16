import { NextResponse, type NextRequest } from "next/server";
import * as db from "@/lib/db/nocodb";
import { getCommunityHead } from "@/lib/comunidade/server";
import { checkTv, type TvDeps } from "@/lib/comunidade/tv";
import { communityOff } from "@/lib/comunidade/votes";
import { isValidSlug } from "@/lib/slug";

// Estado do telão: o segredo vem no cabeçalho x-telao (nunca em cookie nem na URL) e só
// vale no restaurante do slug. 200 { paired } (pareada atualiza o "visto há"), 401 se o
// segredo não é de uma TV deste restaurante ou foi revogado (a TV volta ao código) e 404
// com a Comunidade desligada. Sem corpo.
const deps: TvDeps = { db, getHead: getCommunityHead, off: communityOff };
const NO_STORE = { "cache-control": "no-store" };
const MAX_BODY = 500;

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const slug = (await params).slug.toLowerCase();
  if (!isValidSlug(slug)) return NextResponse.json({ ok: false, code: "not_found" }, { status: 404, headers: NO_STORE });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) {
    return NextResponse.json({ ok: false, code: "invalid" }, { status: 413, headers: NO_STORE });
  }
  try {
    const r = await checkTv(deps, slug, request.headers.get("x-telao"));
    if (r.ok) return NextResponse.json(r, { status: 200, headers: NO_STORE });
    const code = r.status === 401 ? "unauthorized" : "not_found";
    return NextResponse.json({ ok: false, code }, { status: r.status, headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, code: "error" }, { status: 503, headers: NO_STORE });
  }
}
