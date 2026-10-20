import { NextResponse, type NextRequest } from "next/server";
import { readBodyCapped, parseJson } from "@/lib/http";
import { countDownload } from "@/lib/apareca/submit";
import { routeDeps } from "@/lib/apareca/submit-server";
import { isValidSlug } from "@/lib/slug";

// O celular avisa que baixou: { id, device }. Conta 1 download (só do dono de vídeo aprovado,
// até 5 por hora por vídeo). Responde 204 sempre que o corpo for lido, para não revelar nada; a única
// exceção é o limite de leituras por IP (429), que não diz nada sobre o vídeo.
const NO_STORE = { "cache-control": "no-store" };
const MAX_BODY = 2_000;

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const slug = (await params).slug.toLowerCase();
  if (!isValidSlug(slug)) return NextResponse.json({ ok: false, code: "not_found" }, { status: 404, headers: NO_STORE });
  const read = await readBodyCapped(request, MAX_BODY);
  if (!read.ok) return NextResponse.json({ ok: false, code: "invalid" }, { status: read.status, headers: NO_STORE });
  try {
    const r = await countDownload(routeDeps(request), slug, parseJson(read.text));
    if (r === "too_many") return NextResponse.json({ ok: false, code: "too_many" }, { status: 429, headers: NO_STORE });
  } catch {
    // contador é melhor esforço
  }
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}
