import { NextResponse, type NextRequest } from "next/server";
import { downloadTarget } from "@/lib/apareca/submit";
import { routeDeps } from "@/lib/apareca/submit-server";
import { isValidSlug } from "@/lib/slug";

// "Baixar meu vídeo": GET ?id=&device= → 302 para o MP4 do Mux, só para o dono de vídeo
// aprovado, vivo e com o MP4 pronto. Acima do limite de leituras por IP: 429. Qualquer outro caso: 404.
const NO_STORE = { "cache-control": "no-store" };

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  const slug = (await params).slug.toLowerCase();
  const notFound = () => NextResponse.json({ ok: false, code: "not_found" }, { status: 404, headers: NO_STORE });
  if (!isValidSlug(slug)) return notFound();
  const q = request.nextUrl.searchParams;
  try {
    const url = await downloadTarget(routeDeps(request), slug, q.get("id") ?? "", q.get("device") ?? "");
    if (url === "too_many") return NextResponse.json({ ok: false, code: "too_many" }, { status: 429, headers: NO_STORE });
    if (!url) return notFound();
    return NextResponse.redirect(url, { status: 302, headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, code: "error" }, { status: 503, headers: NO_STORE });
  }
}
