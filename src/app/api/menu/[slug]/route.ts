import { NextResponse, type NextRequest } from "next/server";
import { getPublicMenu } from "@/lib/menu/data";
import { isValidSlug } from "@/lib/slug";

const LANG = /^[a-z]{2}(-[A-Z]{2})?$/;

// Cardápio em outro idioma, pedido pelo celular do cliente ao trocar a bandeira.
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug.toLowerCase();
  const lang = request.nextUrl.searchParams.get("lang") ?? "pt-BR";
  if (!isValidSlug(slug) || !LANG.test(lang)) return NextResponse.json(null, { status: 404 });
  const menu = await getPublicMenu(slug, lang).catch(() => null);
  if (!menu) return NextResponse.json(null, { status: 404 });
  return NextResponse.json(menu);
}
