// Rota da programação da TV: com o Apareça fora do ar, nada é gravado (nem o sinal de vida da TV
// nem o tally dos institucionais). "Com o recurso desligado, nada muda para ninguém" (spec).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@/lib/tv/pair";
import { DEFAULT_CONFIG } from "@/lib/apareca/config";
import type { AparecaHead } from "@/lib/apareca/types";

const m = vi.hoisted(() => ({
  afters: [] as (() => Promise<void> | void)[],
  head: null as unknown,
  tvs: [] as Record<string, unknown>[],
  list: vi.fn(),
  update: vi.fn(),
  updateRows: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => Promise<void> | void) => void m.afters.push(fn),
}));
vi.mock("@/lib/db/nocodb", () => ({ list: m.list, update: m.update, updateRows: m.updateRows, insert: m.insert }));
vi.mock("@/lib/apareca/mux-video", () => ({ deleteMuxAsset: vi.fn() }));
vi.mock("@/lib/apareca/off", () => ({ aparecaOff: () => false }));
vi.mock("@/lib/apareca/store", () => ({
  getAparecaHead: async () => m.head,
  getHouseVideos: async () => [],
  readSnapshot: async () => ({ videos: [] }),
}));

import { resetTvMemory } from "@/lib/apareca/tv";
import { POST } from "./route";

const RID = "11111111-1111-4111-8111-111111111111";
const TV = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SECRET = "a".repeat(64);
const head = (over: Partial<AparecaHead> = {}): AparecaHead => ({
  id: RID, slug: "forno", name: "Forno", timezone: "America/Sao_Paulo", opening_hours: null, allowed: true,
  ai_allowed: false, enabled: true, config: { ...DEFAULT_CONFIG, hours: { from: "00:00", to: "23:59" } },
  logo_path: null, brand_color: null, instagram: null, ...over,
});
const req = () =>
  new Request("http://localhost:3000/api/apareca/forno/tv/programa", {
    method: "POST", headers: { "x-telao": SECRET, "content-type": "application/json" }, body: "{}",
  }) as unknown as import("next/server").NextRequest;
const ctx = { params: Promise.resolve({ slug: "forno" }) };
const runAfters = async () => {
  for (const fn of m.afters.splice(0)) await fn();
};
const writes = () => m.update.mock.calls.length + m.updateRows.mock.calls.length + m.insert.mock.calls.length;

beforeEach(async () => {
  vi.clearAllMocks();
  resetTvMemory();
  m.afters.length = 0;
  m.tvs = [{
    Id: 7, id: TV, restaurant_id: RID, secret_hash: await sha256Hex(SECRET), pair_code: null,
    paired_at: "2026-10-16 20:00:00+00:00", revoked: false,
  }];
  m.list.mockImplementation(async (t: string) => (t === "community_tvs" ? m.tvs.map((r) => ({ ...r })) : []));
  m.update.mockResolvedValue(1);
  m.updateRows.mockResolvedValue(undefined);
  m.insert.mockResolvedValue([]);
});

describe("POST /api/apareca/<slug>/tv/programa", () => {
  it.each([
    ["Apareça desligado pela casa", { enabled: false }],
    ["casa não liberada pelo João", { allowed: false }],
  ])("%s: enabled false e nada gravado (nem last_seen_at nem tally)", async (_n, over) => {
    m.head = head(over);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(false);
    expect(body.program).toBeNull();
    await runAfters();
    expect(m.afters).toHaveLength(0);
    expect(writes()).toBe(0);
  });

  it("ligado: responde o programa e a base dos vídeos, e grava o sinal de vida depois da resposta", async () => {
    m.head = head();
    const res = await POST(req(), ctx);
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.stream).toBe("https://stream.mux.com");
    expect(body.program).toMatchObject({ house: [], clients: [] });
    await runAfters();
    expect(m.updateRows).toHaveBeenCalledWith("community_tvs", [expect.objectContaining({ Id: 7, last_seen_at: expect.any(String) })]);
  });

  it("desligado também manda a base (a TV não precisa adivinhar)", async () => {
    m.head = head({ enabled: false });
    expect((await (await POST(req(), ctx)).json()).stream).toBe("https://stream.mux.com");
  });
});
