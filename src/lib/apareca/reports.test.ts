// Relatórios do painel (T16): soma do apareca_tally (vídeos já apagados) com os vídeos vivos, por dia
// e por hora no fuso do restaurante. A série de dias não tem buracos.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aparecaReport } from "./reports";
import type { AparecaTallyRow, TallyCounts, VideoRow } from "./types";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => void fn(), connection: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "http://localhost:3000" }) }));

const auth = vi.hoisted(() => ({ member: new Set<string>() }));
vi.mock("@/lib/auth", () => ({
  isMember: vi.fn(async (rid: string) => auth.member.has(rid)),
  isOwner: vi.fn(async () => false),
}));
const fake = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, lists: [] as { t: string; w: unknown }[] }));
vi.mock("@/lib/db/nocodb", () => {
  const match = (r: Record<string, unknown>, w: Record<string, unknown>) =>
    Object.entries(w).every(([k, v]) => (k === "uid" ? r.id === v : r[k] === v));
  return {
    list: vi.fn(async (t: string, w: Record<string, unknown> = {}) => {
      fake.lists.push({ t, w });
      return (fake.tables[t] ?? []).filter((x) => match(x, w)).map((x) => ({ ...x }));
    }),
    first: vi.fn(async (t: string, w: Record<string, unknown>) => (fake.tables[t] ?? []).find((x) => match(x, w)) ?? null),
    insert: vi.fn(async () => []),
    removeIds: vi.fn(async () => {}),
    updateRows: vi.fn(async () => {}),
  };
});
vi.mock("@/lib/apareca/mux-video", () => ({
  deleteMuxAsset: vi.fn(async () => {}),
  createAparecaUpload: vi.fn(),
  assetInfo: vi.fn(),
  releaseMuxUpload: vi.fn(),
  frameUrl: vi.fn(),
  hlsUrl: vi.fn(),
}));

const SP = "America/Sao_Paulo";
const counts = (p: Partial<TallyCounts> = {}): Partial<TallyCounts> => p;
function tally(p: Partial<AparecaTallyRow>): AparecaTallyRow {
  return { id: "t", restaurant_id: "r1", day: "2026-10-15", month: "2026-10", counts: {}, hours: new Array(24).fill(0), created_at: "2026-10-16 03:00:00+00:00", ...p };
}
function video(p: Partial<VideoRow>): VideoRow {
  return {
    Id: 1, id: "v1", restaurant_id: "r1", kind: "cliente", table_id: null, zone_id: null, device_id: "d", name: null,
    consent_at: "2026-10-16T20:00:00Z", mux_upload_id: "u", mux_asset_id: null, mux_playback_id: null, duration_ms: 6000,
    status: "pending", decided_by: null, decided_at: null, ai_reason: null, plays: 0, plays_target: 1, first_shown_at: null,
    downloads: 0, expires_at: "2026-10-17T04:00:00.000Z", created_at: "2026-10-16T22:00:00Z", ...p,
  };
}
const base = { from: "2026-10-14", to: "2026-10-16", timezone: SP };

describe("aparecaReport", () => {
  it("dois tallies do mesmo dia somam", () => {
    const r = aparecaReport({
      ...base, live: [],
      tallies: [
        tally({ day: "2026-10-15", counts: counts({ sent: 3, approved: 2, rejected: 1, downloads: 1 }) }),
        tally({ id: "t2", day: "2026-10-15", counts: counts({ sent: 2, approved: 1, rejected: 0, downloads: 4 }) }),
      ],
    });
    expect(r.days.find((d) => d.day === "2026-10-15")).toEqual({ day: "2026-10-15", sent: 5, approved: 3, rejected: 1, downloads: 5 });
    expect(r.totals.sent).toBe(5);
  });

  it("vídeos vivos entram no dia deles, sem contar em dobro com o tally", () => {
    const r = aparecaReport({
      ...base,
      tallies: [tally({ day: "2026-10-16", counts: counts({ sent: 2, approved: 2 }) })],
      live: [video({ id: "a", status: "approved", downloads: 3 }), video({ id: "b", status: "rejected", decided_by: "ia" })],
    });
    expect(r.days.find((d) => d.day === "2026-10-16")).toEqual({ day: "2026-10-16", sent: 4, approved: 3, rejected: 1, downloads: 3 });
    expect(r.totals.sent).toBe(4);
    expect(r.totals.ai_rejected).toBe(1);
  });

  it("hours soma por hora local: 22h de São Paulo cai em hours[22]", () => {
    const h = new Array(24).fill(0);
    h[9] = 2;
    const r = aparecaReport({
      ...base,
      tallies: [tally({ hours: h })],
      live: [video({ created_at: "2026-10-17 01:00:00+00:00", id: "x" }), video({ id: "y", created_at: "2026-10-16T01:30:00Z" })],
    });
    // 2026-10-16T01:30Z = 15/10 22:30 em SP (dentro do período); 17/10 01:00Z = 16/10 22:00 em SP
    expect(r.hours).toHaveLength(24);
    expect(r.hours[22]).toBe(2);
    expect(r.hours[9]).toBe(2);
    expect(r.days.find((d) => d.day === "2026-10-15")?.sent).toBe(1);
  });

  it("dia sem nada aparece com zeros: a série não tem buracos", () => {
    const r = aparecaReport({ ...base, tallies: [tally({ day: "2026-10-16", counts: counts({ sent: 1 }) })], live: [] });
    expect(r.days.map((d) => d.day)).toEqual(["2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(r.days[0]).toEqual({ day: "2026-10-14", sent: 0, approved: 0, rejected: 0, downloads: 0 });
  });

  it("rejected inclui ai_rejected (sem somar duas vezes); removed aparece à parte", () => {
    const r = aparecaReport({
      ...base, live: [],
      tallies: [tally({ counts: counts({ sent: 4, rejected: 3, ai_rejected: 2, removed: 1 }) })],
    });
    const d = r.days.find((x) => x.day === "2026-10-15");
    expect(d?.rejected).toBe(3);
    expect(r.totals.rejected).toBe(3);
    expect(r.totals.ai_rejected).toBe(2);
    expect(r.totals.removed).toBe(1);
    expect(d).not.toHaveProperty("removed");
  });

  it("o tempo dos institucionais nunca entra nos números de clientes", () => {
    const r = aparecaReport({
      ...base, live: [],
      tallies: [tally({ counts: counts({ house_played_s: 90 }) }), tally({ id: "t2", counts: counts({ sent: 1, played_s: 6, house_played_s: 30 }) })],
    });
    expect(r.totals.sent).toBe(1);
    expect(r.totals.played_s).toBe(6);
    expect(r.totals.house_played_s).toBe(120);
    expect(r.days.find((d) => d.day === "2026-10-15")?.sent).toBe(1);
  });

  it("fora do período não entra; datas do NocoDB com espaço e fuso valem", () => {
    const r = aparecaReport({
      ...base,
      tallies: [tally({ day: "2026-10-01", counts: counts({ sent: 9 }) }), tally({ id: "t3", day: "2026-10-14 00:00:00+00:00", counts: counts({ sent: 1 }) })],
      live: [video({ id: "old", created_at: "2026-09-01 12:00:00+00:00" }), video({ id: "ruim", created_at: "lixo" })],
    });
    expect(r.totals.sent).toBe(1);
    expect(r.days.find((d) => d.day === "2026-10-14")?.sent).toBe(1);
  });
});

describe("loadReport", () => {
  beforeEach(() => {
    auth.member.clear();
    fake.lists.length = 0;
    fake.tables = {};
  });

  it("só lê dados do restaurante e recusa quem não é membro (mutação: outro restaurante)", async () => {
    const { loadReport } = await import("@/app/painel/apareca/actions");
    const rid1 = "11111111-1111-4111-8111-111111111111";
    const rid2 = "22222222-2222-4222-8222-222222222222";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: SP }).format(new Date());
    fake.tables = {
      restaurants: [{ id: rid1, timezone: SP }, { id: rid2, timezone: SP }],
      apareca_tally: [
        { Id: 1, id: "a", restaurant_id: rid1, day: today, month: today.slice(0, 7), counts: { sent: 2 }, hours: new Array(24).fill(0) },
        { Id: 2, id: "b", restaurant_id: rid2, day: today, month: today.slice(0, 7), counts: { sent: 50 }, hours: new Array(24).fill(0) },
      ],
      apareca_videos: [{ ...video({ id: "v-outro", restaurant_id: rid2, created_at: new Date().toISOString() }) }],
    };
    auth.member.add(rid1);
    const ok = await loadReport(rid1, 7);
    expect(ok.totals.sent).toBe(2);
    expect(ok.days).toHaveLength(7);
    await expect(loadReport(rid2, 7)).rejects.toThrow();
    for (const l of fake.lists.filter((x) => x.t === "apareca_tally" || x.t === "apareca_videos")) {
      expect((l.w as { restaurant_id?: string }).restaurant_id).toBe(rid1);
    }
    expect(loadReport("nao-e-uuid", 7)).rejects.toThrow();
  });
});
