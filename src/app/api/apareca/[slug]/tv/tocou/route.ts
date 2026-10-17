import { NextResponse, type NextRequest } from "next/server";
import { aparecaOff } from "@/lib/apareca/off";
import { forgetSnapshot, getAparecaHead, getHouseVideos } from "@/lib/apareca/store";
import { identifyTv, reportPlay, type AparecaTvDeps } from "@/lib/apareca/tv";
import { parseJson, readBodyCapped } from "@/lib/comunidade/http";
import * as db from "@/lib/db/nocodb";
import { isValidSlug } from "@/lib/slug";

// A TV avisa que começou a tocar: { video, play, kind? } (play = uuid daquela exibição; kind
// "house" para institucional). Segredo no cabeçalho x-telao, como na programação. Cliente: soma
// plays do vídeo aprovado deste restaurante (o mesmo play conta uma vez) e esquece o retrato da
// fila, para a próxima programação já sair sem o vídeo que completou as exibições.
// Institucional: soma a duração no uso do mês. Corpo ≤ 2.000 bytes. 200 { ok }.
const deps: AparecaTvDeps = { db, getHead: getAparecaHead, forget: forgetSnapshot, getHouse: getHouseVideos };
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
    const tv = await identifyTv(deps, slug, request.headers.get("x-telao"));
    if ("status" in tv) {
      const code = tv.status === 401 ? "unauthorized" : "not_found";
      return NextResponse.json({ ok: false, code }, { status: tv.status, headers: NO_STORE });
    }
    const r = await reportPlay(deps, tv, parseJson(read.text));
    return NextResponse.json(r, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, code: "error" }, { status: 503, headers: NO_STORE });
  }
}
