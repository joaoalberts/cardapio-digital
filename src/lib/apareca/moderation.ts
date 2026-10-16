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
export const STUCK_MS = AI_TIMEOUT_MS; // ai_review sem resposta depois do prazo da IA → pending
const LONG_REASON = `duração acima de ${MAX_ASSET_S} s`;
const NO_REASON = "reprovado pela IA";

export type ReadyDecision =
  | { status: "rejected"; by: "ia" | "equipe"; reason: string; deleteAsset: true }
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
};

// Asset pronto no Mux: a duração é conferida primeiro (Foco 1: a URL de upload reaproveitada para
// mandar 2 min reprova sozinha, "by: ia" = decisão automática do sistema, e o asset é apagado).
export function onAssetReady(v: { duration_s: number }, mode: ModMode, ai: boolean): ReadyDecision {
  if (!(Number.isFinite(v.duration_s) && v.duration_s <= MAX_ASSET_S)) {
    return { status: "rejected", by: "ia", reason: LONG_REASON, deleteAsset: true };
  }
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
  const on = aiAvailable(head, { key: d.key, off: d.off?.() ?? false });
  if (!on || !d.key || !cur.mux_playback_id) return toTeam();

  await write(d, cur, { status: "ai_review", decided_at: start.toISOString() });
  const playback = cur.mux_playback_id;
  const verdict = await moderateFrames(
    AI_FRAMES_S.map((t) => frameUrl(playback, t)),
    { key: d.key, model: d.model, fetch: d.fetch, timeoutMs: d.timeoutMs },
  ).catch((e: unknown) => {
    console.warn("apareca: IA sem veredito; vídeo vai para a equipe", String(e).slice(0, 200));
    return null;
  });
  const res = applyVerdict(head.config.mode, verdict);

  const now = await reread(d, v);
  if (!now || now.status !== "ai_review") return; // a equipe (ou outra instância) já decidiu
  await write(d, now, {
    status: res.status,
    decided_by: res.by,
    decided_at: res.status === "pending" ? null : clock(d).toISOString(),
    ai_reason: res.reason,
  });
  if (res.status === "rejected" && now.mux_asset_id) {
    // Falhou? A linha já está rejected (nunca vai à TV) e a retenção apaga o asset depois.
    await d.deleteAsset(now.mux_asset_id).catch((e: unknown) => console.warn("apareca: apagar asset reprovado", String(e).slice(0, 200)));
  }
}
