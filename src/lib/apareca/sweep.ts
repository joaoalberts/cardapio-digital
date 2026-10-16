import "server-only";
import { purge, type StoreDeps } from "./store";
import type { VideoRow } from "./types";

// Rede de segurança do cron diário: o Apareça apaga o vencido quando alguém lê a fila, mas restaurante
// sem movimento (ou com o recurso desligado depois) ficaria com dado parado. Aqui a tabela é lida inteira
// (sem where; o nocodb.ts pagina de 1.000 em 1.000) e o purge, que já decide o que venceu ou ficou preso,
// apaga: asset no Mux primeiro, depois o relatório, depois a linha. Falha numa casa não segura as outras.
export async function runAparecaSweep(d: StoreDeps): Promise<{ deleted: number; failed: number }> {
  const rows = await d.db.list<VideoRow>("apareca_videos");
  return purge(d, rows);
}
