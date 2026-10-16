import { NextResponse, type NextRequest } from "next/server";
import { publicHead } from "@/lib/apareca/submit";
import { routeDeps } from "@/lib/apareca/submit-server";
import { isValidSlug } from "@/lib/slug";

// Convite "Apareça na TV!" no cardápio: { enabled, open, why }. Igual para todo mundo (sem
// mesa nem device), então a CDN guarda 60 s. Slug inexistente: 404 também em cache.
const CACHE = "public, max-age=0, s-maxage=60";
const CACHE_ERROR = "public, max-age=0, s-maxage=5";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  const slug = (await params).slug.toLowerCase();
  if (!isValidSlug(slug)) return NextResponse.json({ ok: false, code: "not_found" }, { status: 404, headers: { "cache-control": CACHE } });
  try {
    const r = await publicHead(routeDeps(request), slug);
    if (!r) return NextResponse.json({ ok: false, code: "not_found" }, { status: 404, headers: { "cache-control": CACHE } });
    return NextResponse.json(r, { headers: { "cache-control": CACHE } });
  } catch {
    return NextResponse.json({ ok: false, code: "error" }, { status: 503, headers: { "cache-control": CACHE_ERROR } });
  }
}
