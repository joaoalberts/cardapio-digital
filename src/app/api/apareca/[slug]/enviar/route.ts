import { NextResponse, type NextRequest } from "next/server";
import { parseJson, readBodyCapped } from "@/lib/comunidade/http";
import { startSubmission } from "@/lib/apareca/submit";
import { routeDeps } from "@/lib/apareca/submit-server";
import { isValidSlug } from "@/lib/slug";

// Começa um envio: { mesa, device, name, consent: true, consent_at } → { id, upload_url, expires_at }.
// O celular manda o vídeo direto ao Mux pela upload_url. O restaurante vem do slug; a mesa é
// conferida no banco. Corpo lido em fluxo e cortado em 2.000 bytes.
const STATUS = {
  invalid: 400, not_found: 404, off: 403, table: 403, closed: 409, paused: 503, too_many: 429, name: 422, consent: 422, mux: 502,
} as const;
const NO_STORE = { "cache-control": "no-store" };
const MAX_BODY = 2_000;

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const slug = (await params).slug.toLowerCase();
  if (!isValidSlug(slug)) return NextResponse.json({ ok: false, code: "not_found" }, { status: 404, headers: NO_STORE });
  const read = await readBodyCapped(request, MAX_BODY);
  if (!read.ok) return NextResponse.json({ ok: false, code: "invalid" }, { status: read.status, headers: NO_STORE });
  try {
    const r = await startSubmission(routeDeps(request), slug, parseJson(read.text));
    return NextResponse.json(r, { status: r.ok ? 200 : STATUS[r.code], headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, code: "error" }, { status: 503, headers: NO_STORE });
  }
}
