import { NextResponse, type NextRequest } from "next/server";
import * as db from "@/lib/db/nocodb";
import { getCommunityHead } from "@/lib/comunidade/server";
import { requestPairCode, type TvDeps } from "@/lib/comunidade/tv";
import { communityOff } from "@/lib/comunidade/votes";
import { isValidSlug } from "@/lib/slug";

// Código de pareamento do telão: { hash } com o SHA-256 do segredo que a própria TV gerou.
// O segredo nunca passa por aqui. O restaurante vem do slug; teto de 5 códigos por hora.
const deps: TvDeps = { db, getHead: getCommunityHead, off: communityOff };
const STATUS = { invalid: 400, not_found: 404, disabled: 403, too_many: 429 } as const;
const NO_STORE = { "cache-control": "no-store" };
const MAX_BODY = 500;

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const slug = (await params).slug.toLowerCase();
  if (!isValidSlug(slug)) return NextResponse.json({ ok: false, code: "not_found" }, { status: 404, headers: NO_STORE });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) {
    return NextResponse.json({ ok: false, code: "invalid" }, { status: 413, headers: NO_STORE });
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY) {
    return NextResponse.json({ ok: false, code: "invalid" }, { status: 413, headers: NO_STORE });
  }
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  try {
    const r = await requestPairCode(deps, slug, body);
    return NextResponse.json(r, { status: r.ok ? 200 : STATUS[r.code], headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, code: "error" }, { status: 503, headers: NO_STORE });
  }
}
