import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  list: vi.fn<(t: string, w?: unknown) => Promise<unknown[]>>(async () => []),
  removeIds: vi.fn<(t: string, ids: number[]) => Promise<void>>(async () => {}),
}));
vi.mock("@/lib/db/nocodb", () => ({ list: h.list, removeIds: h.removeIds, update: vi.fn(), updateRows: vi.fn() }));
// A rota também varre o Apareça (módulos "server-only"); a tabela vem vazia aqui.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));

const route = await import("./route");

describe("GET /api/cron/diario", () => {
  const SECRET = "segredo-de-teste-do-cron";
  const call = (auth?: string) =>
    route.GET(new NextRequest("http://localhost/api/cron/diario", { headers: auth === undefined ? {} : { authorization: auth } }));

  beforeEach(() => {
    h.list.mockReset();
    h.list.mockImplementation(async () => []);
    h.removeIds.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sem CRON_SECRET: 503 sem tocar no banco", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.list).not.toHaveBeenCalled();
  });

  it("senha errada ou ausente: 401 sem tocar no banco", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    for (const auth of [undefined, "", SECRET, `Bearer ${SECRET}-x`, `Basic ${SECRET}`]) {
      const res = await call(auth);
      expect(res.status).toBe(401);
    }
    expect(h.list).not.toHaveBeenCalled();
  });

  it("senha certa: varre o Apareça e as TVs pendentes e devolve só os números", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const old = {
      Id: 7, id: "00000000-0000-4000-8000-000000000007", restaurant_id: "r", label: null, pair_code: "K7M3QX",
      pair_expires_at: "2020-01-01 00:00:00+00:00", secret_hash: "x", paired_at: null, last_seen_at: null, revoked: false, created_at: "",
    };
    h.list.mockImplementation(async (t: string) => (t === "community_tvs" ? [old] : []));
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, apareca: { deleted: 0, failed: 0 }, tvs: { deleted: 1, failed: 0 } });
    expect(h.removeIds).toHaveBeenCalledWith("community_tvs", [7]);
    expect(h.list.mock.calls.map(([t]) => t).sort()).toEqual(["apareca_videos", "community_tvs"]);
  });

  it("falha nas duas leituras: 500 com a contagem", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.list.mockRejectedValue(new Error("nocodb GET: 500"));
    const res = await call(`Bearer ${SECRET}`);
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, apareca: { deleted: 0, failed: 1 }, tvs: { deleted: 0, failed: 1 } });
  });

  it("declara maxDuration de 60 s", () => {
    expect(route.maxDuration).toBe(60);
  });
});
