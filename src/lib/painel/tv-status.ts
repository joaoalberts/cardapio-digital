import { TV_FRESH_MS } from "@/lib/comunidade/public-state";

export type TvStatus = { on: boolean; text: string };

// O NocoDB devolve "AAAA-MM-DD HH:MM:SS+00:00"; sem o "T" o Date.parse falha em alguns motores.
function parse(s: string | null): number {
  if (!s) return NaN;
  return Date.parse(s.replace(" ", "T"));
}

export function tvStatus(lastSeenAt: string | null, now: Date): TvStatus {
  const seen = parse(lastSeenAt);
  if (Number.isNaN(seen)) return { on: false, text: "nunca ligada" };
  const age = Math.max(0, now.getTime() - seen);
  if (age < TV_FRESH_MS) return { on: true, text: "ligada" };
  const min = Math.floor(age / 60_000);
  return { on: false, text: min < 60 ? `sem sinal há ${min} min` : `sem sinal há ${Math.floor(min / 60)} h` };
}
