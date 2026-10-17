import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import * as db from "@/lib/db/nocodb";
import { communityOff } from "@/lib/comunidade/off";
import { cronAuth, runRetention } from "@/lib/comunidade/retention";
import { communityTags } from "@/lib/comunidade/tags";
import { ownsFile, removeFilesStrict } from "@/lib/storage";
import { deleteMuxAsset } from "@/lib/apareca/mux-video";
import { runAparecaSweep } from "@/lib/apareca/sweep";

// Retenção diária da Comunidade, chamada pelo cron da Vercel (vercel.json, 09:00 UTC =
// 06h em São Paulo) com "authorization: Bearer <CRON_SECRET>". Sem CRON_SECRET no
// ambiente, 503: nunca roda aberta. Com COMMUNITY_OFF=1, responde desligada sem tocar no
// banco. A resposta só tem números, nunca ids. Arquivos saem pela remoção estrita: se o
// Blob (ou o disco) falhar, a linha da foto fica e a próxima rodada tenta de novo.
const NO_STORE = { "cache-control": "no-store" };

// A varredura lê as 4 tabelas da Comunidade inteiras, mais enquetes e restaurantes quando
// há voto, e a do Apareça inteira (páginas de 1.000): até 60 s.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Ler o cabeçalho primeiro faz a rota rodar sempre no pedido (nunca pré-renderizada no build).
  const auth = cronAuth(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (auth === "no_secret") return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE });
  if (auth !== "ok") return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });

  // Apareça na TV: o prazo de apagar vale para todo dado coletado, com o recurso ligado ou não, e a
  // Comunidade desligada não segura este passo. Erro aqui não derruba a retenção da Comunidade.
  let apareca = { deleted: 0, failed: 0 };
  try {
    apareca = await runAparecaSweep({ db, mux: { deleteAsset: deleteMuxAsset } });
  } catch (e) {
    console.error("varredura do Apareça:", e instanceof Error ? e.message : e);
    apareca = { deleted: 0, failed: 1 };
  }

  if (communityOff()) return NextResponse.json({ ok: apareca.failed === 0, off: true, apareca }, { status: apareca.failed ? 500 : 200, headers: NO_STORE });

  try {
    // Enquete que ganhou result: a agenda em cache passa a trazê-lo (os votos já saíram).
    // { expire: 0 } e não "max": com "max", o próximo pedido ainda recebe a agenda velha, sem
    // o result e com os votos já apagados (o story sairia "Deu X 100%" e ficaria 1 dia na CDN).
    // Isso só limpa esta instância; nas outras, story.ts e votes.ts leem a linha na hora.
    const revalidate = (rid: string) => revalidateTag(communityTags.rid(rid), { expire: 0 });
    const report = await runRetention({ db, removeFiles: removeFilesStrict, ownsFile, revalidate });
    const ok = report.failed === 0 && apareca.failed === 0;
    return NextResponse.json({ ok, ...report, apareca }, { status: ok ? 200 : 500, headers: NO_STORE });
  } catch (e) {
    console.error("retenção da Comunidade:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}
