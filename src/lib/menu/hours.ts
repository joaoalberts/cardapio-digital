import type { OpeningHours } from "./types";
import { t } from "./i18n";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// Dia da semana e minuto do dia no fuso do restaurante (não do celular do cliente).
function localNow(timezone: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return { day: DAYS.indexOf(get("weekday")), min: Number(get("hour")) * 60 + Number(get("minute")) };
}

export type OpenStatus =
  | { open: true; until: string }
  | { open: false; opensAt: string; inDays: number }
  | { open: false; opensAt: null; inDays: null };

export function openStatus(hours: OpeningHours, timezone: string, now = new Date()): OpenStatus {
  const { day, min } = localNow(timezone, now);
  const today = hours[day] ?? [];
  const yesterday = hours[(day + 6) % 7] ?? [];

  for (const r of yesterday) {
    if (toMin(r.close) <= toMin(r.open) && min < toMin(r.close)) return { open: true, until: r.close };
  }
  for (const r of today) {
    const o = toMin(r.open);
    const c = toMin(r.close);
    if (c > o ? min >= o && min < c : min >= o) return { open: true, until: r.close };
  }
  for (let d = 0; d < 7; d++) {
    const ranges = [...(hours[(day + d) % 7] ?? [])].sort((a, b) => toMin(a.open) - toMin(b.open));
    const next = ranges.find((r) => d > 0 || toMin(r.open) > min);
    if (next) return { open: false, opensAt: next.open, inDays: d };
  }
  return { open: false, opensAt: null, inDays: null };
}

// "23:00" vira "23h" em português; nos outros idiomas segue o costume local.
export function formatTime(hhmm: string, lang: string) {
  const [h, m] = hhmm.split(":").map(Number);
  if (lang.startsWith("pt")) return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
  const d = new Date(Date.UTC(2000, 0, 1, h, m));
  return new Intl.DateTimeFormat(lang, { hour: "numeric", minute: m ? "2-digit" : undefined, timeZone: "UTC" }).format(d);
}

function weekdayName(dayOffset: number, timezone: string, now: Date, lang: string) {
  const d = new Date(now.getTime() + dayOffset * 86400000);
  return new Intl.DateTimeFormat(lang, { weekday: "long", timeZone: timezone }).format(d);
}

// Selo da capa: "Aberto | até 23h", "Fechado | abre às 18h", "Fechado | abre sexta às 18h".
export function statusLabel(hours: OpeningHours, timezone: string, lang: string, now = new Date()) {
  const s = openStatus(hours, timezone, now);
  if (s.open) return { open: true, state: t("open", lang), detail: t("until", lang).replace("{t}", formatTime(s.until, lang)) };
  if (s.opensAt === null) return { open: false, state: t("closed", lang), detail: null };
  const time = formatTime(s.opensAt, lang);
  const rest =
    s.inDays === 0
      ? t("opensAt", lang).replace("{t}", time)
      : t("opensOn", lang)
          .replace("{d}", s.inDays === 1 ? t("tomorrow", lang) : weekdayName(s.inDays, timezone, now, lang))
          .replace("{t}", time);
  return { open: false, state: t("closed", lang), detail: rest };
}

export type StatusLabel = ReturnType<typeof statusLabel>;
