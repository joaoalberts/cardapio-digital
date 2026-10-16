import { after, NextResponse, type NextRequest } from "next/server";
import { parseFunnel, recordFunnel } from "@/lib/comunidade/funnel";
import { isValidSlug } from "@/lib/slug";

// Funil da Comunidade: { mesa, device, e: { qr, balloon_seen, open, buy_tap, share, ref_story,
// ref_telao } }. Vem do sendBeacon, como text/plain, então o corpo é lido como texto. Responde
// 204 na hora e soma depois, em after(): a cabeça, a mesa e a gravação em lote ficam fora do
// caminho do celular. O restaurante vem do slug; evento nunca invalida cache.
const NO_STORE = { "cache-control": "no-store" };
const MAX_BODY = 2_000;

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
  const batch = parseFunnel(body);
  if (!batch) return NextResponse.json({ ok: false, code: "invalid" }, { status: 400, headers: NO_STORE });

  if (Object.keys(batch.e).length) after(() => recordFunnel(slug, { counts: batch.e, mesa: batch.mesa }));
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}
