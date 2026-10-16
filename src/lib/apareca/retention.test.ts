import { describe, expect, it } from "vitest";
import { expiresAt, isExpired, isStuckUpload, purgePlan, RETENTION_MAX_H, RETENTION_MIN_H } from "./retention";
import type { VideoRow } from "./types";

const NOW = new Date("2026-10-16T22:30:00Z");
const tzSP = () => "America/Sao_Paulo";

function row(p: Partial<VideoRow>): VideoRow {
  return {
    Id: 1, id: "v1", restaurant_id: "r1", kind: "cliente", table_id: null, zone_id: null, device_id: "d",
    name: null, consent_at: "2026-10-16T20:00:00Z", mux_upload_id: "u", mux_asset_id: null, mux_playback_id: null,
    duration_ms: 6000, status: "approved", decided_by: "equipe", decided_at: null, ai_reason: null, plays: 1,
    plays_target: 1, first_shown_at: null, downloads: 0, expires_at: "2026-10-17T04:00:00.000Z",
    created_at: "2026-10-16T22:00:00Z", ...p,
  };
}
const EXPIRED = "2026-10-16T22:00:00.000Z";

describe("expiresAt", () => {
  it("soma as horas de retenção", () => {
    expect(expiresAt(new Date("2026-10-16T22:00:00Z"), 6)).toBe("2026-10-17T04:00:00.000Z");
  });
  it("corrige as faixas: 2 vira 6, 500 vira 168", () => {
    expect(RETENTION_MIN_H).toBe(6);
    expect(RETENTION_MAX_H).toBe(168);
    expect(expiresAt(new Date("2026-10-16T22:00:00Z"), 2)).toBe("2026-10-17T04:00:00.000Z");
    expect(expiresAt(new Date("2026-10-16T22:00:00Z"), 500)).toBe("2026-10-23T22:00:00.000Z");
  });
  it("valor inválido vira 6 h", () => {
    expect(expiresAt(new Date("2026-10-16T22:00:00Z"), Number.NaN)).toBe("2026-10-17T04:00:00.000Z");
  });
});

describe("isExpired", () => {
  it("1 s atrás vence, 1 s à frente não, ilegível não", () => {
    expect(isExpired({ expires_at: new Date(NOW.getTime() - 1000).toISOString() }, NOW)).toBe(true);
    expect(isExpired({ expires_at: new Date(NOW.getTime() + 1000).toISOString() }, NOW)).toBe(false);
    expect(isExpired({ expires_at: "" }, NOW)).toBe(false);
    expect(isExpired({ expires_at: "lixo" }, NOW)).toBe(false);
  });
});

describe("isStuckUpload", () => {
  it("só uploading há mais de 1 h", () => {
    const old = new Date(NOW.getTime() - 3_600_001).toISOString();
    const recent = new Date(NOW.getTime() - 3_599_000).toISOString();
    expect(isStuckUpload({ status: "uploading", created_at: old }, NOW)).toBe(true);
    expect(isStuckUpload({ status: "uploading", created_at: recent }, NOW)).toBe(false);
    expect(isStuckUpload({ status: "processing", created_at: old }, NOW)).toBe(false);
    expect(isStuckUpload({ status: "uploading", created_at: "" }, NOW)).toBe(false);
  });
});

describe("purgePlan", () => {
  it("só vencidos e uploading presos saem; approved no prazo nunca", () => {
    const keep = row({ id: "keep" });
    const stuck = row({ id: "stuck", status: "uploading", created_at: "2026-10-16T20:00:00Z" });
    const old = row({ id: "old", expires_at: EXPIRED });
    const p = purgePlan([keep, stuck, old], NOW, tzSP);
    expect(p.gone.map((r) => r.id).sort()).toEqual(["old", "stuck"]);
  });
  it("assets: só os mux_asset_id não nulos dos que saem", () => {
    const a = row({ id: "a", expires_at: EXPIRED, mux_asset_id: "A" });
    const b = row({ id: "b", expires_at: EXPIRED, mux_asset_id: null });
    const c = row({ id: "c", mux_asset_id: "C" });
    expect(purgePlan([a, b, c], NOW, tzSP).assets).toEqual(["A"]);
  });
  it("3 vencidos do mesmo restaurante e dia viram 1 linha somada", () => {
    const rows = [
      row({ id: "1", expires_at: EXPIRED, status: "approved", downloads: 2, plays: 2, duration_ms: 6000 }),
      row({ id: "2", expires_at: EXPIRED, status: "rejected", decided_by: "ia", downloads: 0, plays: 0, duration_ms: 4000 }),
      row({ id: "3", expires_at: EXPIRED, status: "rejected", decided_by: "equipe", downloads: 1, plays: 1, duration_ms: 5000 }),
    ];
    const { tally } = purgePlan(rows, NOW, tzSP);
    expect(tally).toHaveLength(1);
    const t = tally[0];
    expect(t.restaurant_id).toBe("r1");
    expect(t.day).toBe("2026-10-16");
    expect(t.month).toBe("2026-10");
    expect(t.counts.sent).toBe(3);
    expect(t.counts.approved).toBe(1);
    expect(t.counts.rejected).toBe(2);
    expect(t.counts.ai_rejected).toBe(1);
    expect(t.counts.downloads).toBe(3);
    expect(t.counts.encoded_s).toBe(15);
    expect(t.counts.played_s).toBe(2 * 6 + 0 + 1 * 5);
    expect(t.hours).toHaveLength(24);
    expect(t.hours[19]).toBe(3); // 22:00Z = 19h em São Paulo
    expect(t.hours.reduce((a, b) => a + b, 0)).toBe(3);
  });
  it("hours conta pela hora local de São Paulo (22h local = 01Z)", () => {
    const r = row({ id: "x", expires_at: EXPIRED, created_at: "2026-10-17T01:10:00Z" });
    const { tally } = purgePlan([r], new Date("2026-10-17T05:00:00Z"), tzSP);
    expect(tally[0].day).toBe("2026-10-16");
    expect(tally[0].hours[22]).toBe(1);
  });
  it("dois restaurantes viram duas linhas, cada uma com seu restaurant_id", () => {
    const rows = [row({ id: "1", restaurant_id: "r1", expires_at: EXPIRED }), row({ id: "2", restaurant_id: "r2", expires_at: EXPIRED })];
    const { tally } = purgePlan(rows, NOW, tzSP);
    expect(tally.map((t) => t.restaurant_id).sort()).toEqual(["r1", "r2"]);
    expect(tally.every((t) => t.counts.sent === 1)).toBe(true);
  });
  it("usa o fuso de cada restaurante", () => {
    const r = row({ id: "1", restaurant_id: "r9", expires_at: EXPIRED, created_at: "2026-10-16T22:00:00Z" });
    const { tally } = purgePlan([r], NOW, () => "Asia/Tokyo");
    expect(tally[0].day).toBe("2026-10-17");
    expect(tally[0].hours[7]).toBe(1);
  });
  it("lista vazia não gera nada", () => {
    expect(purgePlan([], NOW, tzSP)).toEqual({ gone: [], assets: [], tally: [] });
  });
});
