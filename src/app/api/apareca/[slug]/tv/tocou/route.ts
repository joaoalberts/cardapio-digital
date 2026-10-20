import { NextResponse, type NextRequest } from "next/server";
import { aparecaOff } from "@/lib/apareca/off";
import { forgetSnapshot, getAparecaHead, getHouseVideos } from "@/lib/apareca/store";
import { playFromTv, type AparecaTvDeps } from "@/lib/apareca/tv";
import { parseJson, readBodyCapped } from "@/lib/http";
import * as db from "@/lib/db/nocodb";
import { isValidSlug } from "@/lib/slug";

// A TV avisa que começou a tocar: { video, play, kind?, duration_s? } (play = uuid daquela exibição;
// kind "house" para institucional, com a duração que tocou). Segredo no cabeçalho x-telao, como na
// programação. Só com o Apareça no ar (a mesma regra da programação); fora dele, 404 { enabled: false }
// sem gravar. Cliente: soma plays do vídeo aprovado deste restaurante e da zona da TV (o mesmo play
// conta uma vez) e esquece o retrato da fila, para a próxima programação já sair sem o vídeo que
// completou as exibições. Institucional: soma a duração no uso do mês. Teto de tempo por TV.
// Corpo ≤ 2.000 bytes. 200 { ok }.
const deps: AparecaTvDeps = { db, getHead: getAparecaHead, forget: forgetSnapshot, getHouse: getHouseVideos, off: aparecaOff };
const NO_STORE = { "cache-control": "no-store" };
const MAX_BODY = 2_000;

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const slug = (await params).slug.toLowerCase();
  if (!isValidSlug(slug) || aparecaOff()) {
    return NextResponse.json({ ok: false, code: "not_found" }, { status: 404, headers: NO_STORE });
  }
  const read = await readBodyCapped(request, MAX_BODY);
  if (!read.ok) return NextResponse.json({ ok: false, code: "invalid" }, { status: read.status, headers: NO_STORE });
  try {
    const r = await playFromTv(deps, slug, request.headers.get("x-telao"), parseJson(read.text));
    return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, code: "error" }, { status: 503, headers: NO_STORE });
  }
}
