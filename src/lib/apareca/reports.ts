import type { AparecaTallyRow, TallyCounts, VideoRow } from "./types";

// Relatórios do painel (T16). Soma o que já virou apareca_tally (vídeos apagados) com os vídeos ainda
// vivos, que só entram no tally quando são apagados, então um vídeo nunca conta duas vezes. Vários
// tallies do mesmo dia são normais (um por apagamento e um por rodada da TV): tudo soma.
// O tempo dos institucionais (house_played_s) fica só em totals.house_played_s, fora dos números de clientes.

export type ReportDay = { day: string; sent: number; approved: number; rejected: number; downloads: number };
export type AparecaReport = { days: ReportDay[]; hours: number[]; totals: TallyCounts };

const MAX_DAYS = 366;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUM_KEYS = ["sent", "approved", "rejected", "ai_rejected", "removed", "shown", "downloads", "encoded_s", "played_s", "mp4_s"] as const;

const emptyTotals = (): TallyCounts => ({
  sent: 0, approved: 0, rejected: 0, ai_rejected: 0, removed: 0, shown: 0, downloads: 0, encoded_s: 0, played_s: 0, mp4_s: 0,
  house_played_s: 0,
});
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

// O NocoDB pode devolver "AAAA-MM-DD HH:MM:SS+00:00". Sem fuso na data, vale UTC.
export function parseDbDate(s: unknown): number {
  if (typeof s !== "string") return Number.NaN;
  let t = s.trim().replace(" ", "T");
  if (/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(t)) t += "Z";
  return Date.parse(t);
}

function localParts(timezone: string, at: Date): { day: string; hour: number } {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return { day: `${g("year")}-${g("month")}-${g("day")}`, hour: Number(g("hour")) % 24 };
}

// Dia do tally: "AAAA-MM-DD" (a data já é local; o pedaço de hora, se vier, é ignorado).
const tallyDay = (s: unknown) => (typeof s === "string" && DAY_RE.test(s.trim().slice(0, 10)) ? s.trim().slice(0, 10) : null);

export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  if (!DAY_RE.test(from) || !DAY_RE.test(to)) return out;
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end && out.length < MAX_DAYS; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function aparecaReport(i: {
  tallies: AparecaTallyRow[]; live: VideoRow[]; from: string; to: string; timezone: string;
}): AparecaReport {
  const byDay = new Map<string, ReportDay>(dayRange(i.from, i.to).map((day) => [day, { day, sent: 0, approved: 0, rejected: 0, downloads: 0 }]));
  const hours = new Array<number>(24).fill(0);
  const totals = emptyTotals();

  const add = (day: string, c: Partial<TallyCounts>, h: number[]) => {
    const d = byDay.get(day);
    if (!d) return; // fora do período
    // ai_rejected é um pedaço de rejected (a IA reprovou), não uma soma a mais.
    const rejected = Math.max(num(c.rejected), num(c.ai_rejected));
    d.sent += num(c.sent);
    d.approved += num(c.approved);
    d.rejected += rejected;
    d.downloads += num(c.downloads);
    for (const k of NUM_KEYS) totals[k] += k === "rejected" ? rejected : num(c[k]);
    totals.house_played_s = (totals.house_played_s ?? 0) + num(c.house_played_s);
    for (let k = 0; k < 24; k++) hours[k] += num(h[k]);
  };

  for (const t of i.tallies) {
    const day = tallyDay(t.day);
    if (day) add(day, t.counts ?? {}, Array.isArray(t.hours) ? t.hours : []);
  }

  for (const v of i.live) {
    const at = parseDbDate(v.created_at);
    if (!Number.isFinite(at)) continue;
    const { day, hour } = localParts(i.timezone, new Date(at));
    const dur_s = num(v.duration_ms) / 1000;
    const h = new Array<number>(24).fill(0);
    h[hour] = 1;
    add(
      day,
      {
        sent: 1,
        approved: v.status === "approved" ? 1 : 0,
        rejected: v.status === "rejected" ? 1 : 0,
        ai_rejected: v.status === "rejected" && v.decided_by === "ia" ? 1 : 0,
        removed: v.status === "removed" ? 1 : 0,
        shown: v.plays > 0 || v.first_shown_at ? 1 : 0,
        downloads: num(v.downloads),
        encoded_s: dur_s,
        played_s: num(v.plays) * dur_s,
        mp4_s: dur_s,
      },
      h,
    );
  }

  return { days: [...byDay.values()], hours, totals };
}
