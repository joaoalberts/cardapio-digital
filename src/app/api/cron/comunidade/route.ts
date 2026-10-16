import { NextResponse, type NextRequest } from "next/server";
import * as db from "@/lib/db/nocodb";
import { communityOff } from "@/lib/comunidade/off";
import { cronAuth, runRetention } from "@/lib/comunidade/retention";
import { ownsFile, removeFiles } from "@/lib/storage";

// Retenção diária da Comunidade, chamada pelo cron da Vercel (vercel.json, 09:00 UTC =
// 06h em São Paulo) com "authorization: Bearer <CRON_SECRET>". Sem CRON_SECRET no
// ambiente, 503: nunca roda aberta. Com COMMUNITY_OFF=1, responde desligada sem tocar no
// banco. A resposta só tem números, nunca ids.
const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: NextRequest) {
  // Ler o cabeçalho primeiro faz a rota rodar sempre no pedido (nunca pré-renderizada no build).
  const auth = cronAuth(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (auth === "no_secret") return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE });
  if (auth !== "ok") return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
  if (communityOff()) return NextResponse.json({ ok: true, off: true }, { headers: NO_STORE });

  try {
    const report = await runRetention({ db, removeFiles, ownsFile });
    return NextResponse.json({ ok: report.failed === 0, ...report }, { status: report.failed ? 500 : 200, headers: NO_STORE });
  } catch (e) {
    console.error("retenção da Comunidade:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}
