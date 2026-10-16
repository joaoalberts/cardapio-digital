// Rota do cron: o passo do Apareça roda depois da senha e antes do interruptor da Comunidade,
// e um erro nele não derruba a retenção da Comunidade.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  sweep: vi.fn(),
  retention: vi.fn(),
  off: vi.fn(),
}));

vi.mock("@/lib/db/nocodb", () => ({}));
vi.mock("@/lib/storage", () => ({ ownsFile: vi.fn(), removeFilesStrict: vi.fn() }));
vi.mock("@/lib/apareca/mux-video", () => ({ deleteMuxAsset: vi.fn() }));
vi.mock("@/lib/apareca/sweep", () => ({ runAparecaSweep: m.sweep }));
vi.mock("@/lib/comunidade/off", () => ({ communityOff: m.off }));
vi.mock("@/lib/comunidade/retention", () => ({
  cronAuth: (h: string | null, s: string | undefined) => (!s ? "no_secret" : h === `Bearer ${s}` ? "ok" : "bad"),
  runRetention: m.retention,
}));

import { GET } from "./route";

const req = (auth?: string) =>
  new Request("http://x/api/cron/comunidade", { headers: auth ? { authorization: auth } : {} }) as unknown as import("next/server").NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s");
  m.sweep.mockResolvedValue({ deleted: 2, failed: 0 });
  m.retention.mockResolvedValue({ failed: 0, removed: 1 });
  m.off.mockReturnValue(false);
});

describe("GET /api/cron/comunidade", () => {
  it("sem senha certa, o Apareça nem roda", async () => {
    expect((await GET(req("Bearer errada"))).status).toBe(401);
    expect(m.sweep).not.toHaveBeenCalled();
  });

  it("com a Comunidade desligada, o Apareça ainda roda e a resposta traz os números", async () => {
    m.off.mockReturnValue(true);
    const res = await GET(req("Bearer s"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, off: true, apareca: { deleted: 2, failed: 0 } });
    expect(m.sweep).toHaveBeenCalledTimes(1);
    expect(m.retention).not.toHaveBeenCalled();
  });

  it("resposta normal ganha apareca: { deleted, failed }", async () => {
    const body = await (await GET(req("Bearer s"))).json();
    expect(body.apareca).toEqual({ deleted: 2, failed: 0 });
    expect(body.ok).toBe(true);
  });

  it("erro na varredura do Apareça: a retenção da Comunidade roda mesmo assim e o status é 500", async () => {
    m.sweep.mockRejectedValue(new Error("nocodb caiu"));
    const res = await GET(req("Bearer s"));
    expect(m.retention).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(500);
    expect((await res.json()).apareca).toEqual({ deleted: 0, failed: 1 });
  });
});
