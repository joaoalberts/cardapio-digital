import { describe, expect, it, vi } from "vitest";
import { expiredPendingTvs, sweepPendingTvs } from "./sweep";
import type { TvRow } from "./types";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const NOW = new Date("2026-10-16T09:00:00Z");
const now = NOW.getTime();
const noco = (t: number) => new Date(t).toISOString().replace("T", " ").replace(/\.\d+Z$/, "+00:00");
const ago = (d: number) => noco(now - d);

let n = 0;
const tv = (over: Partial<TvRow> = {}): TvRow => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  restaurant_id: "11111111-1111-4111-8111-111111111111",
  label: null,
  pair_code: "K7M3QX",
  pair_expires_at: ago(MIN),
  secret_hash: "a".repeat(64),
  paired_at: null,
  last_seen_at: null,
  revoked: false,
  created_at: ago(DAY),
  ...over,
});

describe("expiredPendingTvs", () => {
  it("TV pendente: código vencido há 1 min sai; vencendo daqui a 1 min fica; vencendo agora sai", () => {
    const gone = tv({ pair_expires_at: ago(MIN) });
    const keep = tv({ pair_expires_at: noco(now + MIN) });
    const edge = tv({ pair_expires_at: noco(now) });
    expect(expiredPendingTvs([gone, keep, edge], NOW)).toEqual([gone.id, edge.id]);
  });
  it("TV conectada nunca sai, mesmo com o código antigo vencido; revogada ou sem prazo também fica", () => {
    const paired = tv({ paired_at: ago(30 * DAY), pair_code: null, pair_expires_at: ago(30 * DAY) });
    const revoked = tv({ revoked: true, pair_code: null, pair_expires_at: ago(DAY) });
    const noExpiry = tv({ pair_expires_at: null });
    const junk = tv({ pair_expires_at: "amanhã" });
    expect(expiredPendingTvs([paired, revoked, noExpiry, junk], NOW)).toEqual([]);
  });
});

describe("sweepPendingTvs", () => {
  it("apaga pelo Id do NocoDB só as vencidas; linha sem Id é ignorada", async () => {
    const gone = { Id: 4, ...tv() };
    const keep = { Id: 5, ...tv({ paired_at: ago(DAY) }) };
    const noId = tv();
    const db = { list: vi.fn(async () => [gone, keep, noId]), removeIds: vi.fn(async () => {}) };
    expect(await sweepPendingTvs({ db: db as never, now: () => NOW })).toBe(1);
    expect(db.list).toHaveBeenCalledWith("community_tvs", {});
    expect(db.removeIds).toHaveBeenCalledWith("community_tvs", [4]);
  });
  it("nada vencido: não chama o removeIds", async () => {
    const db = { list: vi.fn(async () => [{ Id: 1, ...tv({ pair_expires_at: noco(now + MIN) }) }]), removeIds: vi.fn(async () => {}) };
    expect(await sweepPendingTvs({ db: db as never, now: () => NOW })).toBe(0);
    expect(db.removeIds).not.toHaveBeenCalled();
  });
});
