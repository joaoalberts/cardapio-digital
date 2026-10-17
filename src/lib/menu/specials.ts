// Produto especial (oferta relâmpago): regras do que vem do banco para o cardápio.
// Valores e faixas decididos com o João (spec 2026-10-16-oferta-relampago-design.md).
import type { SpecialInfo } from "./types";

export const SPECIAL_DEFAULTS = { every_h: 2, show_s: 6, limit: 1 } as const;
export const SPECIAL_LIMITS = { show_s: [4, 15], every_h: [0.5, 24], limit: [1, 10] } as const;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const SPECIAL_MAX_TIMES = 12;
export const SPECIAL_TIME_WINDOW_MIN = 1; // pontual: na hora marcada, com 1 minuto de folga (decisão do João, 16/10)

const clamp = (v: unknown, [min, max]: readonly [number, number], fallback: number) => {
  const n = typeof v === "number" ? v : Number(v);
  if (v == null || v === "" || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};
const time = (v: unknown) => (typeof v === "string" && HHMM.test(v) ? v : null);

export function specialInfo(row: {
  special_every_h?: unknown;
  special_show_s?: unknown;
  special_days?: unknown;
  special_from?: unknown;
  special_to?: unknown;
  special_limit?: unknown;
  special_times?: unknown;
}): SpecialInfo {
  const days = Array.isArray(row.special_days)
    ? row.special_days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6)
    : [];
  return {
    every_h: clamp(row.special_every_h, SPECIAL_LIMITS.every_h, SPECIAL_DEFAULTS.every_h),
    show_s: Math.round(clamp(row.special_show_s, SPECIAL_LIMITS.show_s, SPECIAL_DEFAULTS.show_s)),
    days,
    from: time(row.special_from),
    to: time(row.special_to),
    limit: Math.round(clamp(row.special_limit, SPECIAL_LIMITS.limit, SPECIAL_DEFAULTS.limit)),
    times: Array.isArray(row.special_times)
      ? [...new Set(row.special_times.filter((t): t is string => typeof t === "string" && HHMM.test(t)))].sort().slice(0, SPECIAL_MAX_TIMES)
      : [],
  };
}
