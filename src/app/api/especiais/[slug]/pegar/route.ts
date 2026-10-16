import { NextResponse, type NextRequest } from "next/server";
import * as db from "@/lib/db/nocodb";
import { getPublicMenu } from "@/lib/menu/data";
import { isValidSlug } from "@/lib/slug";
import { claimSpecial, type ClaimDeps } from "@/lib/orders/specials";

// Toque em "Pedir agora" na oferta relâmpago: grava o registro com o preço garantido.
// Nome do cardápio em português, que é o que a cozinha lê.
const deps: ClaimDeps = { db, getMenu: (slug) => getPublicMenu(slug, "pt-BR") };
const STATUS = { invalid: 400, not_found: 404, table: 403, disabled: 403, closed: 409, unavailable: 409, too_soon: 409 } as const;
const NO_STORE = { "cache-control": "no-store" };
const MAX_BODY = 2_000;

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const slug = (await params).slug.toLowerCase();
  if (!isValidSlug(slug)) return NextResponse.json({ ok: false, code: "not_found" }, { status: 404, headers: NO_STORE });
  const text = await request.text();
  if (text.length > MAX_BODY) return NextResponse.json({ ok: false, code: "invalid" }, { status: 413, headers: NO_STORE });
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  try {
    const r = await claimSpecial(deps, slug, body);
    return NextResponse.json(r, { status: r.ok ? 201 : STATUS[r.code], headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, code: "error" }, { status: 503, headers: NO_STORE });
  }
}
