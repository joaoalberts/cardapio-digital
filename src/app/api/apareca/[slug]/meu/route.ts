import { NextResponse, type NextRequest } from "next/server";
import { parseJson, readBodyCapped } from "@/lib/comunidade/http";
import { myStatus } from "@/lib/apareca/submit";
import { routeDeps } from "@/lib/apareca/submit-server";
import { isValidSlug } from "@/lib/slug";

// "Meu vídeo": { id, device } → estado, posição, tempo estimado e link de download. Só responde
// a quem manda o device dono da linha; outro device ou id inexistente dão o mesmo 404.
// O vencido responde "gone" e é apagado depois da resposta (after()).
const STATUS = { invalid: 400, not_found: 404 } as const;
const NO_STORE = { "cache-control": "no-store" };
const MAX_BODY = 2_000;

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const slug = (await params).slug.toLowerCase();
  if (!isValidSlug(slug)) return NextResponse.json({ ok: false, code: "not_found" }, { status: 404, headers: NO_STORE });
  const read = await readBodyCapped(request, MAX_BODY);
  if (!read.ok) return NextResponse.json({ ok: false, code: "invalid" }, { status: read.status, headers: NO_STORE });
  try {
    const r = await myStatus(routeDeps(request), slug, parseJson(read.text));
    if ("error" in r) return NextResponse.json({ ok: false, code: r.error }, { status: STATUS[r.error], headers: NO_STORE });
    return NextResponse.json(r, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, code: "error" }, { status: 503, headers: NO_STORE });
  }
}
