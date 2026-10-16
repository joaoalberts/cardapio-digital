import { after, NextResponse, type NextRequest } from "next/server";
import { sharedEventGate } from "@/lib/comunidade/event-gate";
import { parseFunnel, recordFunnel } from "@/lib/comunidade/funnel";
import { clientIp, parseJson, readBodyCapped } from "@/lib/comunidade/http";
import { isValidSlug } from "@/lib/slug";

// Funil da Comunidade: { mesa, device, e: { qr, balloon_seen, open, buy_tap, share, ref_story,
// ref_telao } }. Vem do sendBeacon, como text/plain, então o corpo é lido como texto (em
// fluxo, cortado em 2.000 bytes). Antes de somar, o portão em memória limita 60 lotes por
// minuto por IP, 1 lote a cada 10 s por device e 50 por dia por device e contador; o que
// passa disso é descartado em silêncio. Responde 204 na hora e soma depois, em after(): a
// cabeça, a mesa e a gravação em lote ficam fora do caminho do celular. O restaurante vem
// do slug; evento nunca invalida cache.
const NO_STORE = { "cache-control": "no-store" };
const MAX_BODY = 2_000;

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const slug = (await params).slug.toLowerCase();
  if (!isValidSlug(slug)) return NextResponse.json({ ok: false, code: "not_found" }, { status: 404, headers: NO_STORE });
  const read = await readBodyCapped(request, MAX_BODY);
  if (!read.ok) return NextResponse.json({ ok: false, code: "invalid" }, { status: read.status, headers: NO_STORE });
  const batch = parseFunnel(parseJson(read.text));
  if (!batch) return NextResponse.json({ ok: false, code: "invalid" }, { status: 400, headers: NO_STORE });

  const counts = sharedEventGate().admit(slug, batch.device, clientIp(request.headers), batch.e);
  if (counts) after(() => recordFunnel(slug, { counts, mesa: batch.mesa }));
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}
