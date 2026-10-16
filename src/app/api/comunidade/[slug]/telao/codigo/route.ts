import { NextResponse, type NextRequest } from "next/server";
import * as db from "@/lib/db/nocodb";
import { clientIp, parseJson, readBodyCapped } from "@/lib/comunidade/http";
import { sharedLimiter } from "@/lib/comunidade/limiter";
import { communityOff } from "@/lib/comunidade/off";
import { getCommunityHead } from "@/lib/comunidade/server";
import { PAIR_CODES_PER_HOUR, requestPairCode, type TvDeps } from "@/lib/comunidade/tv";
import { isValidSlug } from "@/lib/slug";

// Código de pareamento do telão: { hash } com o SHA-256 do segredo que a própria TV gerou.
// O segredo nunca passa por aqui. O restaurante vem do slug. Limites: 5 pedidos por hora
// por IP em cada restaurante (em memória, por instância) e 20 códigos vivos por
// restaurante (no banco, em requestPairCode). Corpo lido em fluxo, cortado em 500 bytes.
const deps: TvDeps = { db, getHead: getCommunityHead, off: communityOff };
const STATUS = { invalid: 400, not_found: 404, disabled: 403, too_many: 429 } as const;
const NO_STORE = { "cache-control": "no-store" };
const MAX_BODY = 500;
const HOUR_MS = 60 * 60_000;

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const slug = (await params).slug.toLowerCase();
  if (!isValidSlug(slug)) return NextResponse.json({ ok: false, code: "not_found" }, { status: 404, headers: NO_STORE });
  const read = await readBodyCapped(request, MAX_BODY);
  if (!read.ok) return NextResponse.json({ ok: false, code: "invalid" }, { status: read.status, headers: NO_STORE });

  const perIp = sharedLimiter("telao-codigo", { max: PAIR_CODES_PER_HOUR, windowMs: HOUR_MS });
  if (!perIp.hit(`${clientIp(request.headers)}|${slug}`)) {
    return NextResponse.json({ ok: false, code: "too_many" }, { status: 429, headers: NO_STORE });
  }
  try {
    const r = await requestPairCode(deps, slug, parseJson(read.text));
    return NextResponse.json(r, { status: r.ok ? 200 : STATUS[r.code], headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, code: "error" }, { status: 503, headers: NO_STORE });
  }
}
