import "server-only";
import { after } from "next/server";
import * as db from "@/lib/db/nocodb";
import { deleteMuxAsset } from "@/lib/apareca/mux-video";
import { readSnapshot } from "@/lib/apareca/store";

// Número de vídeos esperando aprovação (o selo do botão Agora no menu). Só o PanelShell chama, com a linha do
// restaurante que o currentRestaurant já achou pelo membro da sessão; por isso não confere o membro de novo e
// não é ação ("use server"), que o navegador poderia chamar com outro id. Sem a liberação do Apareça
// (apareca_allowed), 0 sem ler nada. Lê o mesmo retrato com memo da fila: navegar pelo painel não gasta leitura
// quando ele está quente. Em erro, 0: o número nunca trava a página.
export async function pendingCount(rid: string, allowed: boolean): Promise<number> {
  if (!allowed) return 0;
  try {
    const snap = await readSnapshot({ db, mux: { deleteAsset: deleteMuxAsset }, defer: (fn) => after(fn) }, rid);
    return snap.videos.filter((v) => v.restaurant_id === rid && v.status === "pending").length;
  } catch {
    return 0;
  }
}
