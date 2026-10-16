import { after, NextResponse, type NextRequest } from "next/server";
import * as db from "@/lib/db/nocodb";
import { recordFunnel } from "@/lib/comunidade/funnel";
import { parseJson, readBodyCapped } from "@/lib/comunidade/http";
import { communityOff } from "@/lib/comunidade/off";
import { getCommunityContent, getCommunityHead } from "@/lib/comunidade/server";
import { castVote, type CommunityDb, type VoteDeps } from "@/lib/comunidade/votes";
import { isValidSlug } from "@/lib/slug";

// Voto na enquete da casa: { mesa, device, poll, option }. O restaurante vem do slug, a mesa
// e a enquete são conferidas no banco, e o voto nunca invalida cache. O corpo é lido em
// fluxo e cortado em 2.000 bytes.
const STATUS = { invalid: 400, not_found: 404, disabled: 403, table: 403, closed: 409, poll: 409, too_many: 429 } as const;
const NO_STORE = { "cache-control": "no-store" };
const MAX_BODY = 2_000;

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const slug = (await params).slug.toLowerCase();
  if (!isValidSlug(slug)) return NextResponse.json({ ok: false, code: "not_found" }, { status: 404, headers: NO_STORE });
  const read = await readBodyCapped(request, MAX_BODY);
  if (!read.ok) return NextResponse.json({ ok: false, code: "invalid" }, { status: read.status, headers: NO_STORE });
  const body = parseJson(read.text);

  // O funil conta "vote" só quando um voto novo foi gravado (o repetido devolve o primeiro).
  let wrote = false;
  const tracked: CommunityDb = {
    list: db.list,
    first: db.first,
    async insertOne(t, row) {
      const r = await db.insertOne(t, row);
      wrote = true;
      return r;
    },
  };
  const deps: VoteDeps = { db: tracked, getHead: getCommunityHead, getContent: getCommunityContent, off: communityOff };

  try {
    const r = await castVote(deps, slug, body);
    if (r.ok && wrote) {
      const mesa = (body as { mesa: string }).mesa;
      after(() => recordFunnel(slug, { counts: { vote: 1 }, mesa }));
    }
    return NextResponse.json(r, { status: r.ok ? 200 : STATUS[r.code], headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, code: "error" }, { status: 503, headers: NO_STORE });
  }
}
