import "server-only";
import type * as nocodb from "@/lib/db/nocodb";
import { AI_FRAMES_S, AI_TIMEOUT_MS, aiAvailable, moderateFrames, type Verdict } from "./ai";
import { frameUrl } from "./mux-video";
import type { AparecaHead, ModMode, VideoRow, VideoStatus } from "./types";

// Máquina de moderação do Apareça. Nada vai à TV sem "approved": a IA só aprova no modo automático;
// no híbrido ela só reprova (o aprovado vai para a equipe); no manual, ou com a IA desligada, tudo
// vai para a equipe. Erro, prazo ou resposta torta da IA → fila manual. ai_reason fica só no banco.
// Não importa store.ts (store.ts usa resolveStuck daqui): quem chama passa forget.

export const MAX_ASSET_S = 7; // folga sobre os 6 s da gravação; acima disso, reprova e apaga
// ai_review sem resposta → pending. Folga de 15 s sobre o prazo da IA: o retrato não mostra pending
// enquanto o veredito ainda pode chegar (correção 1 da T9).
export const STUCK_MS = AI_TIMEOUT_MS + 15_000;
const FRAME_MARGIN_S = 0.2; // nenhum quadro depois do fim do vídeo
const LONG_REASON = `duração acima de ${MAX_ASSET_S} s`;
const NO_REASON = "reprovado pela IA";

export type ReadyDecision =
  | { status: "rejected"; by: "ia" | "equipe" | null; reason: string; deleteAsset: true }
  | { status: "ai_review" }
  | { status: "pending" };

export type ModerationDeps = {
  db: Pick<typeof nocodb, "first" | "updateRows">;
  deleteAsset: (assetId: string) => Promise<void>;
  key?: string;
  model: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
  forget?: (rid: string) => void; // forgetSnapshot
  off?: () => boolean;
  // Restaurante lido direto do banco, sem cache: o veredito usa o modo e o interruptor da IA de agora.
  // Sem ele, vale a cabeça recebida.
  freshHead?: (rid: string) => Promise<AparecaHead | null>;
};

// Asset pronto no Mux: a duração é conferida primeiro (Foco 1: a URL de upload reaproveitada para
// mandar 2 min reprova sozinha e o asset é apagado). É regra do sistema, não da IA nem da equipe:
// by null, para não contar em ai_rejected. Duração 0 ou desconhecida vai para a equipe, nunca para a IA.
export function onAssetReady(v: { duration_s: number }, mode: ModMode, ai: boolean): ReadyDecision {
  const d = v.duration_s;
  if (typeof d !== "number" || Number.isNaN(d) || d <= 0) return { status: "pending" };
  if (d > MAX_ASSET_S) return { status: "rejected", by: null, reason: LONG_REASON, deleteAsset: true };
  if (mode === "manual" || !ai) return { status: "pending" };
  return { status: "ai_review" };
}

export function applyVerdict(
  mode: ModMode,
  v: Verdict | null,
): { status: "approved" | "pending" | "rejected"; by: "ia" | null; reason: string | null } {
  if (!v || mode === "manual") return { status: "pending", by: null, reason: null };
  if (!v.aprovado) return { status: "rejected", by: "ia", reason: v.motivo.trim() || NO_REASON };
  if (mode === "automatico") return { status: "approved", by: "ia", reason: null };
  return { status: "pending", by: null, reason: null }; // híbrido: a equipe decide o aprovado
}

// ai_review sem resposta há mais de STUCK_MS (ou sem carimbo) vira pending para a equipe.
export function resolveStuck(v: Pick<VideoRow, "status" | "decided_at">, now: Date): "pending" | null {
  if (v.status !== "ai_review") return null;
  const at = v.decided_at ? Date.parse(v.decided_at) : Number.NaN;
  if (!Number.isFinite(at)) return "pending";
  return now.getTime() - at > STUCK_MS ? "pending" : null;
}

// Um quadro por segundo, cada um limitado a (duração − 0,2 s); repetidos saem. Vídeo curto usa os que
// couberem, no mínimo 1.
function framesFor(duration_s: number): number[] {
  const last = Math.max(0, duration_s - FRAME_MARGIN_S);
  const ts = [...new Set(AI_FRAMES_S.map((t) => Math.round(Math.min(t, last) * 10) / 10))];
  return ts.length ? ts : [0];
}

// O NocoDB devolve "AAAA-MM-DD HH:MM:SS+00:00" (espaço no lugar do T): compara pelo instante, não
// pelo texto. Data ilegível = NaN, e a comparação dá false.
const dateMs = (iso: string | null) => (iso ? Date.parse(iso.trim().replace(" ", "T")) : Number.NaN);
const clock = (d: ModerationDeps) => (d.now ?? (() => new Date()))();
const reread = (d: ModerationDeps, v: VideoRow) => d.db.first<VideoRow>("apareca_videos", { uid: v.id });

async function write(d: ModerationDeps, v: VideoRow, patch: Partial<VideoRow> & { status: VideoStatus }) {
  await d.db.updateRows("apareca_videos", [{ Id: v.Id, ...patch }]);
  d.forget?.(v.restaurant_id);
}

// Chamada por after() quando o vídeo pronto entra em ai_review. Pode rodar mais de uma vez para o
// mesmo vídeo (instâncias diferentes): relê a linha antes de cada gravação e só grava sobre ai_review.
export async function runModeration(d: ModerationDeps, v: VideoRow, head: AparecaHead): Promise<void> {
  const cur = await reread(d, v);
  if (!cur || cur.status !== "ai_review") return;
  const start = clock(d);
  const toTeam = () => write(d, cur, { status: "pending", decided_by: null, decided_at: null });
  // Parado além do prazo: a equipe já vê como pending; não chama a IA.
  if (resolveStuck(cur, start)) return toTeam();
  const aiOn = (h: AparecaHead) => aiAvailable(h, { key: d.key, off: d.off?.() ?? false });
  const duration_s = (cur.duration_ms ?? 0) / 1000;
  if (!aiOn(head) || !d.key || !cur.mux_playback_id || !(duration_s > 0)) return toTeam();

  await write(d, cur, { status: "ai_review", decided_at: start.toISOString() });
  const playback = cur.mux_playback_id;
  const verdict = await moderateFrames(
    framesFor(duration_s).map((t) => frameUrl(playback, t)),
    { key: d.key, model: d.model, fetch: d.fetch, timeoutMs: d.timeoutMs },
  ).catch((e: unknown) => {
    console.warn("apareca: IA sem veredito; vídeo vai para a equipe", String(e).slice(0, 200));
    return null;
  });

  // Modo e interruptor de agora (o dono pode ter mudado durante a chamada). Sem leitura → equipe.
  const fresh = d.freshHead ? await d.freshHead(head.id).catch(() => null) : head;
  const res = fresh && aiOn(fresh) ? applyVerdict(fresh.config.mode, verdict) : applyVerdict("manual", null);

  const before = await reread(d, v);
  if (!before || before.status !== "ai_review") return; // a equipe (ou outra instância) já decidiu
  const stamp = clock(d).toISOString();
  const mine = {
    status: res.status,
    decided_by: res.by,
    decided_at: res.status === "pending" ? null : stamp,
    ai_reason: res.reason,
  };
  await write(d, before, mine);

  // Sem gravação condicional no NocoDB: a equipe (ou outra instância) pode ter gravado entre a
  // releitura e a gravação. Relê; se a linha não tem mais o que a IA gravou, a decisão da equipe
  // prevalece e é regravada (por cima de qualquer gravação atrasada da IA). Entre duas gravações da
  // IA, reprovação ganha de aprovação: a aprovação da IA nunca fica por cima de uma reprovação.
  const after = await reread(d, v);
  if (!after) return;
  const team = after.decided_by === "equipe";
  const conflict = after.status !== mine.status || (team && dateMs(after.decided_at) > dateMs(stamp));
  let final: VideoStatus = mine.status;
  if (conflict) {
    if (team || after.status === "rejected" || after.status === "removed" || mine.status !== "rejected") {
      final = after.status;
      await write(d, after, { status: after.status, decided_by: after.decided_by, decided_at: after.decided_at, ai_reason: after.ai_reason });
    } else {
      await write(d, after, mine); // a IA reprovou e outra gravação da IA aprovou: fica reprovado
    }
  }
  if (final === "rejected" && !team && mine.status === "rejected" && after.mux_asset_id) {
    // Falhou? A linha já está rejected (nunca vai à TV) e a retenção apaga o asset depois.
    await d.deleteAsset(after.mux_asset_id).catch((e: unknown) => console.warn("apareca: apagar asset reprovado", String(e).slice(0, 200)));
  }
}
