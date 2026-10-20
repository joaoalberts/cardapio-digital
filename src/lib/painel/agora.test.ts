import { describe, expect, it } from "vitest";
import type { QueueResult } from "@/app/painel/apareca/actions";
import type { QueueItem } from "@/lib/apareca/panel-logic";
import { agoraFrom } from "./agora";

const RID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-17T22:00:00Z");
const min = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString();

const item = (id: string, status: QueueItem["status"]): QueueItem => ({
  id, name: null, table_label: null, zone: null, status, hls: null, poster: null, created_at: min(-5), plays: 0, plays_target: 1,
});
const QUEUE: QueueResult = { items: [item("v1", "pending"), item("v2", "approved")], newest: min(-5), warn: "warn" };

const tv = (id: string, extra: Record<string, unknown> = {}) => ({
  id, restaurant_id: RID, label: `TV ${id}`, paired_at: "2026-10-10 20:00:00+00:00", last_seen_at: min(-2), revoked: false, ...extra,
});

const base = { queue: QUEUE, tvRows: [] as Record<string, unknown>[], now: NOW, aparecaAllowed: true, restaurantId: RID };

describe("agoraFrom", () => {
  it("fila que falhou (null) não derruba as TVs", () => {
    const r = agoraFrom({ ...base, queue: null, tvRows: [tv("ok")] });
    expect(r.queueOk).toBe(false);
    expect(r.queue).toEqual({ items: [], newest: null, warn: "ok" });
    expect(r.tvs.map((t) => t.id)).toEqual(["ok"]);
  });

  it("TVs: só as conectadas e não desconectadas, com o estado", () => {
    const r = agoraFrom({
      ...base,
      tvRows: [
        tv("ok"),
        tv("revogada", { revoked: true }),
        tv("sem-par", { paired_at: null }),
        tv("muda", { last_seen_at: min(-30) }),
        tv("alheia", { restaurant_id: "22222222-2222-4222-8222-222222222222" }),
      ],
    });
    expect(r.tvs.map((t) => t.id).sort()).toEqual(["muda", "ok"]);
    expect(r.tvs.find((t) => t.id === "ok")).toEqual({ id: "ok", label: "TV ok", status: { on: true, text: "ligada" } });
    expect(r.tvs.find((t) => t.id === "muda")!.status).toEqual({ on: false, text: "sem sinal há 30 min" });
  });

  it("Apareça não liberado: fila vazia", () => {
    const r = agoraFrom({ ...base, aparecaAllowed: false });
    expect(r.queue).toEqual({ items: [], newest: null, warn: "ok" });
    expect(r.queueOk).toBe(true);
    expect(r.aparecaAllowed).toBe(false);
  });

  it("Apareça liberado: a fila passa como veio", () => {
    const r = agoraFrom(base);
    expect(r.queue).toBe(QUEUE);
    expect(r.queueOk).toBe(true);
    expect(r.aparecaAllowed).toBe(true);
  });
});
