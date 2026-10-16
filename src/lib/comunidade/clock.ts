// Relógio da Comunidade: o "dia" (que vira em day_start, no fuso do restaurante) e as fases
// da enquete. Abrir e fechar é derivado do relógio, então a agenda pode ficar em cache.
// Funções puras; o "agora" sempre vem de fora.
import { localNow } from "@/lib/menu/hours";
import type { PollRow } from "./types";

export const DAY_START_DEFAULT = "05:00";
// Depois de encerrada, a enquete fica 15 min no Palco e no telão, com a vencedora.
export const CLOSED_POLL_LINGER_MS = 15 * 60_000;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

// day_start vazio ou malformado (vem do banco) cai no padrão, em minutos desde 00:00.
function startMin(dayStart: string): number {
  const m = HHMM.exec(dayStart) ?? HHMM.exec(DAY_START_DEFAULT)!;
  return Number(m[1]) * 60 + Number(m[2]);
}

// O localNow (hours.ts) dá o dia da semana e o minuto; a data do calendário vem daqui,
// no mesmo fuso.
function zoned(ms: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute"), s: get("second") };
}

const ymd = (y: number, mo: number, d: number) => new Date(Date.UTC(y, mo - 1, d)).toISOString().slice(0, 10);

function addDays(day: string, n: number): string {
  const [y, mo, d] = day.split("-").map(Number);
  return ymd(y, mo, d + n);
}

// Diferença entre o relógio de parede no fuso e o UTC, no instante dado.
function offsetAt(ms: number, timezone: string): number {
  const z = zoned(ms, timezone);
  return Date.UTC(z.y, z.mo - 1, z.d, z.h, z.mi, z.s) - Math.floor(ms / 1000) * 1000;
}

// Hora de parede no fuso → instante UTC. Duas passadas acertam a troca de horário de verão.
function zonedToUtc(day: string, minutes: number, timezone: string): Date {
  const [y, mo, d] = day.split("-").map(Number);
  const wall = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60);
  const first = wall - offsetAt(wall, timezone);
  const second = wall - offsetAt(first, timezone);
  return new Date(second);
}

// "AAAA-MM-DD" do dia da Comunidade: antes de day_start, ainda é o dia anterior.
export function communityDay(now: Date, timezone: string, dayStart: string): string {
  const { min } = localNow(timezone, now);
  const z = zoned(now.getTime(), timezone);
  const today = ymd(z.y, z.mo, z.d);
  return min < startMin(dayStart) ? addDays(today, -1) : today;
}

// Instantes UTC em que o dia da Comunidade começa e termina (from ≤ t < to).
export function dayBounds(day: string, timezone: string, dayStart: string): { from: Date; to: Date } {
  if (!DAY.test(day)) throw new RangeError(`dia inválido: ${day}`);
  const start = startMin(dayStart);
  return { from: zonedToUtc(day, start, timezone), to: zonedToUtc(addDays(day, 1), start, timezone) };
}

const ms = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);

// Fim efetivo: o encerramento da casa, se veio antes do fim agendado.
function endMs(p: PollRow): number {
  const end = ms(p.ends_at);
  const closed = ms(p.closed_at);
  return Number.isFinite(closed) ? Math.min(closed, end) : end;
}

// Aberta quando starts_at <= agora < ends_at e sem closed_at. Qualquer closed_at encerra.
// Datas inválidas nunca abrem a enquete.
export function pollPhase(p: PollRow, now: Date): "scheduled" | "open" | "closed" {
  const start = ms(p.starts_at);
  const end = ms(p.ends_at);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "closed";
  if (p.closed_at) return "closed";
  const t = now.getTime();
  if (t < start) return "scheduled";
  return t < end ? "open" : "closed";
}

// A aberta (a de starts_at mais recente); senão, a que encerrou por último, se faz ≤ 15 min.
// Uma agendada cancelada antes de abrir nunca aparece como encerrada.
export function currentPoll(polls: PollRow[], now: Date): PollRow | null {
  const t = now.getTime();
  let open: PollRow | null = null;
  let closed: PollRow | null = null;
  for (const p of polls) {
    const phase = pollPhase(p, now);
    if (phase === "open") {
      if (!open || ms(p.starts_at) > ms(open.starts_at)) open = p;
    } else if (phase === "closed") {
      const end = endMs(p);
      if (!Number.isFinite(end) || end <= ms(p.starts_at)) continue;
      if (t - end > CLOSED_POLL_LINGER_MS) continue;
      if (!closed || end > endMs(closed)) closed = p;
    }
  }
  return open ?? closed;
}

// A agendada que começa primeiro.
export function nextPoll(polls: PollRow[], now: Date): PollRow | null {
  let next: PollRow | null = null;
  for (const p of polls) {
    if (pollPhase(p, now) !== "scheduled") continue;
    if (!next || ms(p.starts_at) < ms(next.starts_at)) next = p;
  }
  return next;
}
