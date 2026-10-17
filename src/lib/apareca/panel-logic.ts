import type { AparecaConfig, AparecaHead, HouseVideoRow, ModMode, Zone, VideoRow, VideoStatus } from "./types";

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

// Estado do aviso entre consultas. primed false = a carga inicial falhou: a primeira consulta boa
// só guarda o newest (os vídeos que já estavam na fila não são "novos"). O newest nunca volta para
// trás quando o pendente mais novo é aprovado ou reprovado.
export type AlertState = { newest: string | null; primed: boolean };
export function alertStep(prev: AlertState, items: QueueItem[]): AlertState & { ring: boolean } {
  if (!prev.primed) return { newest: newestOf(items) ?? prev.newest, primed: true, ring: false };
  if (hasNew(prev.newest, items)) return { newest: newestOf(items), primed: true, ring: true };
  return { newest: prev.newest, primed: true, ring: false };
}

// Mensagens da fila. O erro de leitura (load) some na próxima consulta que der certo. A mensagem
// de uma ação (action) só some na próxima ação, quando a pessoa toca em fechar ou depois de
// NOTICE_MS; uma consulta nunca apaga a resposta de uma ação.
export const NOTICE_MS = 8_000;
export type Notice = { load: string | null; action: { text: string; at: number } | null };
export type NoticeEvent =
  | { type: "load_ok" }
  | { type: "load_fail"; text: string }
  | { type: "action"; text: string | null; at: number }
  | { type: "close" }
  | { type: "tick"; at: number };
export function noticeOn(n: Notice, ev: NoticeEvent): Notice {
  switch (ev.type) {
    case "load_ok":
      return n.load === null ? n : { ...n, load: null };
    case "load_fail":
      return { ...n, load: ev.text };
    case "action":
      return { ...n, action: ev.text ? { text: ev.text, at: ev.at } : null };
    case "close":
      return { ...n, action: null };
    case "tick":
      return n.action && ev.at - n.action.at >= NOTICE_MS ? { ...n, action: null } : n;
  }
}
export const noticeText = (n: Notice): string | null => n.action?.text ?? n.load;

// Consultas da fila: no máximo uma automática por vez (busy), e só a resposta do pedido mais novo
// vale (current). bump() invalida as que estão em andamento (ação local mais nova que elas).
export function latestOnly() {
  let seq = 0;
  const open = new Set<number>();
  return {
    begin: () => {
      open.add(++seq);
      return seq;
    },
    end: (n: number) => void open.delete(n),
    current: (n: number) => n === seq,
    busy: () => open.size > 0,
    bump: () => void ++seq,
  };
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
  ai_rejected: "A análise automática reprovou este vídeo; a lista foi atualizada.",
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
    // A IA reprovou no meio: o asset já foi (ou está sendo) apagado e o vídeo não tem como tocar.
    // Aprovar por cima deixaria um "approved" sem vídeo; a equipe vê o aviso e a lista atualizada.
    if (action === "approve" && (after.status === "rejected" || after.status === "removed")) {
      d.forget?.(rid);
      return { error: TEAM_ERRORS.ai_rejected };
    }
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

// ---------- Configurações, zonas e institucionais (T15) ----------

// Frase da cadeia de interruptores: o João ainda não liberou o Apareça para a casa.
export const NOT_ALLOWED = "Este recurso ainda não foi liberado para a sua casa.";

// Institucionais: a TV carrega cada um inteiro na memória a cada exibição (T14), então o envio é
// limitado (decisão do controlador na T15): até 3 min e 200 MB. O tamanho é conferido no navegador
// antes do envio; a duração, quando o Mux devolve o asset (acima disso, o asset é apagado).
export const HOUSE_MAX_S = 180;
export const HOUSE_MAX_BYTES = 200 * 1024 * 1024;
export const HOUSE_TITLE_MAX = 60; // minha escolha
export const HOUSE_LIST_MAX = 20; // minha escolha: institucionais por casa
export const ZONES_MAX = 12;
export const ZONE_NAME_MAX = 40;
export const RETENTION_OPTIONS = [6, 12, 24, 72, 168] as const; // 6 h, 12 h, 24 h, 3 dias, 7 dias
export const CLIENTS_MAX = { min: 1, max: 5 };
export const PLAYS_MAX = 3;
export const DEVICE_PER_HOUR = { min: 1, max: 10 };

const ALL_MODES: ModMode[] = ["manual", "hibrido", "automatico"];

// Modos de moderação que o dono pode escolher: híbrido e automático só com a IA liberada pelo
// João (apareca_ai_allowed) e a chave da Anthropic no servidor.
export function allowedModes(head: Pick<AparecaHead, "ai_allowed">, hasKey: boolean): ModMode[] {
  return head.ai_allowed === true && hasKey ? [...ALL_MODES] : ["manual"];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const intIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export type ConfigPatch = Partial<Omit<AparecaConfig, "zones" | "table_zones" | "tv_zones">>;

// Aplica o que o painel mandou sobre a config atual. Valor fora das faixas do painel é erro (nada
// é gravado); zonas e mapas ficam de fora (só o saveZones mexe neles).
export function applyConfigPatch(
  cur: AparecaConfig, patch: unknown, modes: ModMode[],
): { cfg: AparecaConfig } | { error: string } {
  if (!isObj(patch)) return { error: "Confira os dados." };
  const next: AparecaConfig = { ...cur, rule: { ...cur.rule } };
  if ("mode" in patch) {
    if (!modes.includes(patch.mode as ModMode)) return { error: "Este modo de moderação não está liberado para a sua casa." };
    next.mode = patch.mode as ModMode;
  }
  if ("rule" in patch) {
    const r = patch.rule;
    if (!isObj(r) || r.kind !== "intercalar" || !intIn(r.clients_max, CLIENTS_MAX.min, CLIENTS_MAX.max)) {
      return { error: `Escolha de ${CLIENTS_MAX.min} a ${CLIENTS_MAX.max} vídeos de clientes.` };
    }
    next.rule = { kind: "intercalar", house_every: cur.rule.house_every, clients_max: r.clients_max };
  }
  if ("plays" in patch) {
    if (!intIn(patch.plays, 1, PLAYS_MAX)) return { error: `Cada vídeo toca de 1 a ${PLAYS_MAX} vezes.` };
    next.plays = patch.plays as 1 | 2 | 3;
  }
  if ("device_per_hour" in patch) {
    if (!intIn(patch.device_per_hour, DEVICE_PER_HOUR.min, DEVICE_PER_HOUR.max)) {
      return { error: `O limite por celular vai de ${DEVICE_PER_HOUR.min} a ${DEVICE_PER_HOUR.max} vídeos por hora.` };
    }
    next.device_per_hour = patch.device_per_hour;
  }
  if ("hours" in patch) {
    const h = patch.hours;
    if (h === null) next.hours = null;
    else if (isObj(h) && typeof h.from === "string" && typeof h.to === "string" && HHMM_RE.test(h.from) && HHMM_RE.test(h.to)) {
      if (h.from === h.to) return { error: "O horário precisa ter início e fim diferentes." };
      next.hours = { from: h.from, to: h.to };
    } else return { error: "Confira o horário (ex.: 19:00 a 02:00)." };
  }
  if ("retention_h" in patch) {
    if (!RETENTION_OPTIONS.includes(patch.retention_h as (typeof RETENTION_OPTIONS)[number])) {
      return { error: "Escolha um dos prazos para apagar os vídeos." };
    }
    next.retention_h = patch.retention_h as number;
  }
  return { cfg: next };
}

// Zonas do painel: até 12, nome de 1 a 40 caracteres, id uuid (o navegador sorteia o da zona nova).
// Mesa e TV só entram se forem do restaurante (own*) e apontarem para uma zona da lista nova; o
// resto é ignorado. Zona apagada: quem apontava para ela fica sem zona.
export function cleanZones(
  zones: unknown, tables: unknown, tvs: unknown, own: { tables: Set<string>; tvs: Set<string> },
): { zones: Zone[]; table_zones: Record<string, string>; tv_zones: Record<string, string> } | { error: string } {
  if (!Array.isArray(zones)) return { error: "Confira as zonas." };
  if (zones.length > ZONES_MAX) return { error: `No máximo ${ZONES_MAX} zonas.` };
  const out: Zone[] = [];
  const seen = new Set<string>();
  for (const z of zones) {
    if (!isObj(z) || typeof z.id !== "string" || !UUID_RE.test(z.id) || seen.has(z.id)) return { error: "Confira as zonas." };
    const name = typeof z.name === "string" ? z.name.trim().replace(/\s+/g, " ") : "";
    if (!name) return { error: "Dê um nome a cada zona." };
    if (name.length > ZONE_NAME_MAX) return { error: `O nome da zona pode ter até ${ZONE_NAME_MAX} caracteres.` };
    seen.add(z.id);
    out.push({ id: z.id, name });
  }
  const pick = (raw: unknown, mine: Set<string>) => {
    const m: Record<string, string> = {};
    if (!isObj(raw)) return m;
    for (const [k, v] of Object.entries(raw)) if (mine.has(k) && typeof v === "string" && seen.has(v)) m[k] = v;
    return m;
  };
  return { zones: out, table_zones: pick(tables, own.tables), tv_zones: pick(tvs, own.tvs) };
}

// Nova ordem depois de subir (-1) ou descer (+1) um institucional: troca com o vizinho e renumera
// 0..n-1. Devolve só as linhas cuja posição mudou; [] na ponta; null se o id não está na lista.
export function reorderHouse(
  rows: Pick<HouseVideoRow, "Id" | "id" | "position">[], id: string, dir: -1 | 1,
): { Id: number; position: number }[] | null {
  const list = [...rows].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.Id - b.Id);
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) return null;
  const j = i + dir;
  if (j < 0 || j >= list.length) return [];
  [list[i], list[j]] = [list[j], list[i]];
  return list.flatMap((r, k) => (r.position === k ? [] : [{ Id: r.Id, position: k }]));
}

type AssetInfoLike =
  | { status: "processing" }
  | { status: "failed" }
  | { status: "ready"; assetId: string; playbackId: string; durationS: number };

export type HouseSyncDeps = {
  rows: HouseVideoRow[]; // só do restaurante, já filtradas por quem chama
  assetInfo: (uploadId: string) => Promise<AssetInfoLike>;
  deleteAsset: (assetId: string) => Promise<void>;
};

// Confere no Mux os institucionais em preparo. Pronto com até 3 min → ready com asset, playback e
// duração. Mais longo → o asset é apagado e a linha vira failed (inativa, sem asset, com a duração
// para o painel explicar); se o Mux não apagar, a linha continua em preparo e a próxima conferência
// tenta de novo. Erro do Mux em uma linha não derruba as outras.
export async function houseSyncPlan(d: HouseSyncDeps): Promise<{ pending: number; updates: ({ Id: number } & Partial<HouseVideoRow>)[] }> {
  const updates: ({ Id: number } & Partial<HouseVideoRow>)[] = [];
  let pending = 0;
  for (const h of d.rows) {
    if (h.status !== "processing") continue;
    if (!h.mux_upload_id) {
      updates.push({ Id: h.Id, status: "failed", active: false });
      continue;
    }
    let info: AssetInfoLike;
    try {
      info = await d.assetInfo(h.mux_upload_id);
    } catch {
      pending += 1;
      continue;
    }
    if (info.status === "processing") pending += 1;
    else if (info.status === "failed") updates.push({ Id: h.Id, status: "failed", active: false });
    else {
      const duration_ms = Math.round(info.durationS * 1000);
      if (info.durationS > HOUSE_MAX_S) {
        try {
          await d.deleteAsset(info.assetId);
        } catch {
          pending += 1;
          continue;
        }
        updates.push({ Id: h.Id, status: "failed", active: false, mux_asset_id: null, mux_playback_id: null, duration_ms });
      } else {
        updates.push({ Id: h.Id, status: "ready", mux_asset_id: info.assetId, mux_playback_id: info.playbackId, duration_ms });
      }
    }
  }
  return { pending, updates };
}
