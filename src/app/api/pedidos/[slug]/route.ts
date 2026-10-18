import { NextResponse, type NextRequest } from "next/server";
import { parseJson, readBodyCapped } from "@/lib/http";
import * as db from "@/lib/db/nocodb";
import { getPublicMenu } from "@/lib/menu/data";
import { isValidSlug } from "@/lib/slug";
import { createOrder, listDeviceOrders, type Deps } from "@/lib/orders/service";

// Pedido do celular do cliente. O cardápio em português é a base: a cozinha lê os nomes nele.
// O corpo é lido em fluxo e cortado em 20.000 bytes:
// 413 acima disso, 400 com content-length malformado ou texto que não é UTF-8.
const deps: Deps = { db, getMenu: (slug) => getPublicMenu(slug, "pt-BR") };
const STATUS = { invalid: 400, not_found: 404, table: 403, disabled: 403, closed: 409, lines: 409 } as const;
const NO_STORE = { "cache-control": "no-store" };
const MAX_BODY = 20_000;

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const slug = (await params).slug.toLowerCase();
  if (!isValidSlug(slug)) return NextResponse.json({ ok: false, code: "not_found" }, { status: 404, headers: NO_STORE });
  const read = await readBodyCapped(request, MAX_BODY);
  if (!read.ok) return NextResponse.json({ ok: false, code: "invalid" }, { status: read.status, headers: NO_STORE });
  try {
    const r = await createOrder(deps, slug, parseJson(read.text));
    return NextResponse.json(r, { status: r.ok ? 201 : STATUS[r.code], headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, code: "error" }, { status: 503, headers: NO_STORE });
  }
}

export async function GET(request: NextRequest, { params }: Ctx) {
  const slug = (await params).slug.toLowerCase();
  const device = request.nextUrl.searchParams.get("device") ?? "";
  if (!isValidSlug(slug)) return NextResponse.json({ orders: [] }, { status: 404, headers: NO_STORE });
  const orders = await listDeviceOrders(deps, slug, device).catch(() => []);
  return NextResponse.json({ orders }, { headers: NO_STORE });
}
