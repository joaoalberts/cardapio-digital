import { NextResponse, type NextRequest } from "next/server";
import * as db from "@/lib/db/nocodb";
import { getPublicMenu } from "@/lib/menu/data";
import { isValidSlug } from "@/lib/slug";
import { createOrder, listDeviceOrders, type Deps } from "@/lib/orders/service";

// Pedido do celular do cliente. O cardápio em português é a base: a cozinha lê os nomes nele.
const deps: Deps = { db, getMenu: (slug) => getPublicMenu(slug, "pt-BR") };
const STATUS = { invalid: 400, not_found: 404, table: 403, disabled: 403, closed: 409, lines: 409 } as const;
const NO_STORE = { "cache-control": "no-store" };
const MAX_BODY = 20_000;

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
    const r = await createOrder(deps, slug, body);
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
