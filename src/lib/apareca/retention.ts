import { localNow } from "@/lib/menu/hours";
import type { AparecaTallyRow, TallyCounts, VideoRow } from "./types";

export const RETENTION_MIN_H = 6;
export const RETENTION_MAX_H = 168;
const STUCK_MS = 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// Retenção fora da faixa é corrigida (2 -> 6, 500 -> 168); número inválido vira o mínimo (6).
export function expiresAt(createdAt: Date, retentionH: number): string {
  const h = Number.isFinite(retentionH) ? Math.min(RETENTION_MAX_H, Math.max(RETENTION_MIN_H, retentionH)) : RETENTION_MIN_H;
  return new Date(createdAt.getTime() + h * HOUR_MS).toISOString();
}

// Data ilegível = não vencido: nunca apagar por engano.
export function isExpired(v: Pick<VideoRow, "expires_at">, now: Date): boolean {
  const t = Date.parse(v.expires_at);
  return Number.isFinite(t) && t <= now.getTime();
}

export function isStuckUpload(v: Pick<VideoRow, "status" | "created_at">, now: Date): boolean {
  if (v.status !== "uploading") return false;
  const t = Date.parse(v.created_at);
  return Number.isFinite(t) && now.getTime() - t > STUCK_MS;
}

type TallyOut = Omit<AparecaTallyRow, "id" | "created_at">;

// Data (AAAA-MM-DD) no fuso do restaurante. O dia/hora vêm do instante de criação do vídeo.
function localDay(timezone: string, at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

const emptyCounts = (): TallyCounts => ({
  sent: 0, approved: 0, rejected: 0, ai_rejected: 0, removed: 0, shown: 0, downloads: 0, encoded_s: 0, played_s: 0, mp4_s: 0,
});

// Decide o que apagar e o que contar antes de apagar. Quem chama apaga o asset no Mux primeiro,
// depois a linha, e grava o tally. Aprovado dentro do prazo nunca entra em `gone`.
export function purgePlan(
  rows: VideoRow[],
  now: Date,
  timezone: (rid: string) => string,
): { gone: VideoRow[]; assets: string[]; tally: TallyOut[] } {
  const gone = rows.filter((v) => isExpired(v, now) || isStuckUpload(v, now));
  const assets = gone.map((v) => v.mux_asset_id).filter((a): a is string => !!a);
  const groups = new Map<string, TallyOut>();

  for (const v of gone) {
    const created = new Date(v.created_at);
    if (!Number.isFinite(created.getTime())) continue; // sem data de criação não dá para contar o dia
    const tz = timezone(v.restaurant_id);
    const day = localDay(tz, created);
    const key = `${v.restaurant_id}|${day}`;
    let g = groups.get(key);
    if (!g) {
      g = { restaurant_id: v.restaurant_id, day, month: day.slice(0, 7), counts: emptyCounts(), hours: new Array(24).fill(0) };
      groups.set(key, g);
    }
    const c = g.counts as TallyCounts;
    const dur_s = (v.duration_ms ?? 0) / 1000;
    c.sent += 1;
    if (v.status === "approved") c.approved += 1;
    if (v.status === "rejected") {
      c.rejected += 1;
      if (v.decided_by === "ia") c.ai_rejected += 1;
    }
    if (v.status === "removed") c.removed += 1;
    if (v.plays > 0 || v.first_shown_at) c.shown += 1;
    c.downloads += v.downloads;
    c.encoded_s += dur_s;
    c.played_s += v.plays * dur_s;
    c.mp4_s += dur_s; // MP4 "highest" nasce com o asset; pior caso para o custo
    g.hours[Math.floor(localNow(tz, created).min / 60)] += 1;
  }
  return { gone, assets, tally: [...groups.values()] };
}
