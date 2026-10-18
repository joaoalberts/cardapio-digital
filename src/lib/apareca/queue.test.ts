// Posição na fila e tempo estimado que o celular mostra em "Seu vídeo está na fila!".
import { describe, expect, it } from "vitest";
import type { TvRow } from "@/lib/tv/types";
import { DEFAULT_CONFIG } from "./config";
import { estimateWait, queuePosition, tvsIn } from "./queue";
import type { VideoRow } from "./types";

const Z1 = "00000000-0000-4000-8000-0000000000a1";
const Z2 = "00000000-0000-4000-8000-0000000000a2";

let seq = 0;
function v(p: Partial<VideoRow> = {}): VideoRow {
  seq += 1;
  return {
    Id: seq, id: `v-${seq}`, restaurant_id: "r", kind: "cliente", table_id: null, zone_id: null, device_id: "d", name: null,
    consent_at: "", mux_upload_id: "u", mux_asset_id: null, mux_playback_id: null, duration_ms: 6000, status: "approved",
    decided_by: null, decided_at: null, ai_reason: null, plays: 0, plays_target: 1, first_shown_at: null, downloads: 0,
    expires_at: "2026-10-16T23:00:00.000Z", created_at: `2026-10-16T18:00:${String(seq % 60).padStart(2, "0")}.000Z`, ...p,
  };
}

describe("queuePosition", () => {
  it("conta pending, ai_review e approved não tocados, da mesma zona ou sem zona, por created_at", () => {
    const mine = v({ id: "mine", status: "pending", zone_id: Z1, created_at: "2026-10-16T18:10:00.000Z" });
    const rows = [
      mine,
      v({ status: "approved", zone_id: Z1, created_at: "2026-10-16T18:05:00.000Z" }), // conta
      v({ status: "ai_review", zone_id: null, created_at: "2026-10-16T18:06:00.000Z" }), // conta (sem zona)
      v({ status: "pending", zone_id: Z2, created_at: "2026-10-16T18:01:00.000Z" }), // outra zona
      v({ status: "approved", plays: 1, plays_target: 1, created_at: "2026-10-16T18:02:00.000Z" }), // já tocou
      v({ status: "rejected", created_at: "2026-10-16T18:03:00.000Z" }),
      v({ status: "uploading", created_at: "2026-10-16T18:03:30.000Z" }),
      v({ status: "processing", created_at: "2026-10-16T18:03:40.000Z" }),
      v({ status: "removed", created_at: "2026-10-16T18:04:00.000Z" }),
      v({ status: "pending", zone_id: Z1, created_at: "2026-10-16T18:20:00.000Z" }), // depois de mim
    ];
    expect(queuePosition(rows, "mine", Z1)).toBe(3);
  });

  it("1 = próximo; approved com plays < plays_target ainda conta", () => {
    const rows = [v({ id: "a", plays: 1, plays_target: 2, created_at: "2026-10-16T18:00:00.000Z" }), v({ id: "b", created_at: "2026-10-16T18:01:00.000Z" })];
    expect(queuePosition(rows, "a", null)).toBe(1);
    expect(queuePosition(rows, "b", null)).toBe(2);
  });

  it("ordem pelo created_at, não pelo Id", () => {
    const rows = [v({ id: "late", created_at: "2026-10-16T18:30:00.000Z" }), v({ id: "early", created_at: "2026-10-16T18:00:00.000Z" })];
    expect(queuePosition(rows, "late", null)).toBe(2);
  });

  it("fora da fila (reprovado, tocado ou ausente) → null", () => {
    const rows = [v({ id: "r", status: "rejected" }), v({ id: "t", plays: 1 })];
    expect(queuePosition(rows, "r", null)).toBeNull();
    expect(queuePosition(rows, "t", null)).toBeNull();
    expect(queuePosition(rows, "x", null)).toBeNull();
  });
});

describe("estimateWait", () => {
  const rule = DEFAULT_CONFIG.rule; // depois de cada institucional, até 3 de clientes

  it("posição 1: logo (antes de um institucional inteiro)", () => {
    expect(estimateWait({ position: 1, rule, houseS: [30], tvs: 1 })).toBeLessThan(30_000);
  });

  it("posição 5 com clients_max 3 soma um institucional no meio", () => {
    const a = estimateWait({ position: 5, rule: { ...rule, clients_max: 3 }, houseS: [20, 40], tvs: 1 });
    const b = estimateWait({ position: 5, rule: { ...rule, clients_max: 10 }, houseS: [20, 40], tvs: 1 });
    expect(a - b).toBe(30_000); // um bloco de 1 institucional, com a média de 30 s
    expect(b).toBe(4 * 6_000); // 4 clipes de 6 s na frente
  });

  it("house_every 2 conta dois institucionais por bloco", () => {
    const one = estimateWait({ position: 4, rule: { kind: "intercalar", house_every: 1, clients_max: 3 }, houseS: [30], tvs: 1 });
    const two = estimateWait({ position: 4, rule: { kind: "intercalar", house_every: 2, clients_max: 3 }, houseS: [30], tvs: 1 });
    expect(two - one).toBe(30_000);
  });

  it("várias TVs dividem a fila; 0 TV conta como 1; sem institucionais não soma bloco", () => {
    const one = estimateWait({ position: 7, rule, houseS: [30], tvs: 1 });
    const two = estimateWait({ position: 7, rule, houseS: [30], tvs: 2 });
    expect(two).toBe(Math.round(one / 2));
    expect(estimateWait({ position: 7, rule, houseS: [30], tvs: 0 })).toBe(one);
    expect(estimateWait({ position: 4, rule, houseS: [], tvs: 1 })).toBe(3 * 6_000);
  });

  it("entradas tortas não viram NaN nem negativo", () => {
    const ms = estimateWait({ position: Number.NaN, rule, houseS: [Number.NaN, -5], tvs: Number.NaN });
    expect(Number.isFinite(ms)).toBe(true);
    expect(ms).toBeGreaterThanOrEqual(0);
  });
});

describe("tvsIn", () => {
  const tv = (p: Partial<TvRow>): TvRow =>
    ({ id: "t", restaurant_id: "r", label: null, pair_code: null, pair_expires_at: null, secret_hash: "h", paired_at: "2026-10-01T00:00:00.000Z",
      last_seen_at: null, revoked: false, created_at: "", ...p }) as TvRow;
  const T1 = "00000000-0000-4000-8000-0000000000b1";
  const T2 = "00000000-0000-4000-8000-0000000000b2";
  const T3 = "00000000-0000-4000-8000-0000000000b3";
  const cfg = { ...DEFAULT_CONFIG, zones: [{ id: Z1, name: "Salão" }, { id: Z2, name: "Bar" }], tv_zones: { [T1]: Z1, [T2]: Z2 } };

  it("conta TVs pareadas e não revogadas da zona, mais as sem zona", () => {
    const tvs = [tv({ id: T1 }), tv({ id: T2 }), tv({ id: T3 }), tv({ id: "x", revoked: true }), tv({ id: "y", paired_at: null })];
    expect(tvsIn(tvs, cfg, Z1)).toBe(2); // T1 + T3 (todas as zonas)
    expect(tvsIn(tvs, cfg, null)).toBe(3);
  });
  it("TV numa zona apagada vale para todas as zonas", () => {
    const c = { ...cfg, zones: [{ id: Z2, name: "Bar" }] };
    expect(tvsIn([tv({ id: T1 }), tv({ id: T2 })], c, Z2)).toBe(2);
  });
});
