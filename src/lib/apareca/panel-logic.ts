import type { Zone, VideoRow, VideoStatus } from "./types";

// Fila de moderação do painel (T10), sem nada do Next nem do servidor: o fila.tsx (cliente) usa
// hasNew e alertPattern; actions.ts usa queueItems e teamDecide com o banco e o Mux de verdade.
// Nada daqui leva device_id, ai_reason nem ids do Mux para o painel: só o que a equipe precisa ver.

export type QueueItem = {
  id: string; name: string | null; table_label: string | null; zone: string | null; status: VideoStatus;
  hls: string | null; poster: string | null; created_at: string; plays: number; plays_target: number;
};

// O NocoDB devolve "AAAA-MM-DD HH:MM:SS+00:00"; o T no lugar do espaço vale em qualquer motor.
const ms = (iso: string | null) => (iso ? Date.parse(iso.trim().replace(" ", "T")) : Number.NaN);
const at = (iso: string) => {
  const t = ms(iso);
  return Number.isFinite(t) ? t : 0;
};

// O pendente mais novo (o que pede ação da equipe). Aprovado não conta.
export function newestOf(items: QueueItem[]): string | null {
  let best: QueueItem | null = null;
  for (const i of items) if (i.status === "pending" && (!best || at(i.created_at) > at(best.created_at))) best = i;
  return best?.created_at ?? null;
}

// Chegou pendente mais novo que o último visto? A primeira resposta sempre diz sim quando há
// pendente; o componente ignora a primeira resposta para não tocar ao abrir a página.
export function hasNew(prevNewest: string | null, items: QueueItem[]): boolean {
  const newest = newestOf(items);
  if (!newest) return false;
  if (!prevNewest) return true;
  const p = ms(prevNewest);
  return !Number.isFinite(p) || at(newest) > p;
}

export function alertPattern(): number[] {
  return [150, 80, 150];
}

export type QueueContext = {
  tables: Map<string, string>; // uid da mesa -> nome
  zones: Zone[];
  hls: (playbackId: string) => string;
  poster: (playbackId: string) => string;
};

// "Para aprovar" (pending, mais antigos primeiro) e depois "Na TV agora" (approved, mais novos
// primeiro). Zona apagada ou mesa removida aparecem sem nome, nunca somem.
export function queueItems(rows: VideoRow[], ctx: QueueContext): QueueItem[] {
  const zone = new Map(ctx.zones.map((z) => [z.id, z.name]));
  const toItem = (v: VideoRow): QueueItem => ({
    id: v.id,
    name: v.name || null,
    table_label: (v.table_id && ctx.tables.get(v.table_id)) || null,
    zone: (v.zone_id && zone.get(v.zone_id)) || null,
    status: v.status,
    hls: v.mux_playback_id ? ctx.hls(v.mux_playback_id) : null,
    poster: v.mux_playback_id ? ctx.poster(v.mux_playback_id) : null,
    created_at: v.created_at,
    plays: v.plays ?? 0,
    plays_target: v.plays_target ?? 1,
  });
  const pending = rows.filter((v) => v.status === "pending").sort((a, b) => at(a.created_at) - at(b.created_at));
  const approved = rows.filter((v) => v.status === "approved").sort((a, b) => at(b.created_at) - at(a.created_at));
  return [...pending, ...approved].map(toItem);
}

// ---------- Decisão da equipe ----------

export type TeamAction = "approve" | "reject" | "remove";
const FROM: Record<TeamAction, VideoStatus[]> = {
  // ai_review também: o retrato mostra pending depois do prazo da IA, mas a linha continua ai_review.
  approve: ["pending", "ai_review"],
  reject: ["pending", "ai_review"],
  remove: ["approved"],
};
const TO: Record<TeamAction, VideoStatus> = { approve: "approved", reject: "rejected", remove: "removed" };

export const TEAM_ERRORS = {
  gone: "Este vídeo não está mais na fila.",
  decided: "Este vídeo já foi decidido. A lista foi atualizada.",
  fail: "Não foi possível salvar. Tente de novo.",
};

export type DecideDeps = {
  db: {
    first: <T>(table: "apareca_videos", where: Record<string, string>) => Promise<T | null>;
    updateRows: (table: "apareca_videos", rows: ({ Id: number } & Record<string, unknown>)[]) => Promise<unknown>;
  };
  deleteAsset: (assetId: string) => Promise<void>;
  now?: () => Date;
  forget?: (rid: string) => void;
};

// Quem chama já conferiu que a pessoa é membro de rid. A busca filtra por restaurant_id: um id de
// outra casa não é achado e nada é gravado. Sem gravação condicional no NocoDB: depois de gravar,
// relê; se a IA gravou por cima com outro status, a decisão da equipe é regravada (a equipe prevalece).
// Reprovar e remover apagam o asset no Mux depois do status; se falhar, o status fica e a varredura apaga.
export async function teamDecide(d: DecideDeps, rid: string, id: string, action: TeamAction): Promise<{ error?: string }> {
  const where = { uid: id, restaurant_id: rid };
  const v = await d.db.first<VideoRow>("apareca_videos", where);
  if (!v || v.restaurant_id !== rid) return { error: TEAM_ERRORS.gone };
  if (!FROM[action].includes(v.status)) {
    d.forget?.(rid);
    return { error: TEAM_ERRORS.decided };
  }
  const mine = { status: TO[action], decided_by: "equipe" as const, decided_at: (d.now ?? (() => new Date()))().toISOString() };
  await d.db.updateRows("apareca_videos", [{ Id: v.Id, ...mine }]);
  const after = await d.db.first<VideoRow>("apareca_videos", where);
  if (after && after.decided_by === "ia" && after.status !== mine.status) {
    await d.db.updateRows("apareca_videos", [{ Id: v.Id, ...mine }]);
  }
  d.forget?.(rid);
  const asset = after?.mux_asset_id ?? v.mux_asset_id;
  if (action !== "approve" && asset) {
    await d.deleteAsset(asset).catch((e: unknown) =>
      console.warn("apareca: apagar asset depois da decisão da equipe; a varredura tenta de novo", String(e).slice(0, 200)),
    );
  }
  return {};
}
