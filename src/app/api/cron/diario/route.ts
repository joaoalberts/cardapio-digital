import { NextResponse, type NextRequest } from "next/server";
import * as db from "@/lib/db/nocodb";
import { deleteMuxAsset } from "@/lib/apareca/mux-video";
import { runAparecaSweep } from "@/lib/apareca/sweep";
import { cronAuth } from "@/lib/cron";
import { sweepPendingTvs } from "@/lib/tv/sweep";

// Limpeza diária, chamada pelo cron da Vercel (vercel.json, 09:00 UTC = 06h em São Paulo) com
// "authorization: Bearer <CRON_SECRET>". Sem CRON_SECRET no ambiente, 503: nunca roda aberta.
// Dois passos independentes (um que falha não segura o outro): o prazo de apagar do Apareça na TV
// e as TVs pendentes com o código vencido. A resposta só tem números, nunca ids.
const NO_STORE = { "cache-control": "no-store" };

// A varredura do Apareça lê a tabela inteira (páginas de 1.000): até 60 s.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Ler o cabeçalho primeiro faz a rota rodar sempre no pedido (nunca pré-renderizada no build).
  const auth = cronAuth(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (auth === "no_secret") return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE });
  if (auth !== "ok") return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });

  let apareca = { deleted: 0, failed: 0 };
  try {
    apareca = await runAparecaSweep({ db, mux: { deleteAsset: deleteMuxAsset } });
  } catch (e) {
    console.error("varredura do Apareça:", e instanceof Error ? e.message : e);
    apareca = { deleted: 0, failed: 1 };
  }

  const tvs = { deleted: 0, failed: 0 };
  try {
    tvs.deleted = await sweepPendingTvs({ db });
  } catch (e) {
    console.error("varredura das TVs:", e instanceof Error ? e.message : e);
    tvs.failed = 1;
  }

  const ok = apareca.failed === 0 && tvs.failed === 0;
  return NextResponse.json({ ok, apareca, tvs }, { status: ok ? 200 : 500, headers: NO_STORE });
}
