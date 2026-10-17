// Selo do botão Agora: só conta com a liberação do Apareça, e só os pending do próprio restaurante.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/db/nocodb", () => ({}));
vi.mock("@/lib/apareca/mux-video", () => ({ deleteMuxAsset: vi.fn() }));
vi.mock("@/lib/apareca/store", () => ({ readSnapshot: vi.fn() }));

import { readSnapshot } from "@/lib/apareca/store";
import { pendingCount } from "./pending-count";

const RID = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const v = (restaurant_id: string, status: string) => ({ restaurant_id, status }) as never;

beforeEach(() => {
  vi.mocked(readSnapshot).mockReset();
  vi.mocked(readSnapshot).mockResolvedValue({
    at: 0,
    videos: [v(RID, "pending"), v(RID, "pending"), v(RID, "approved"), v(RID, "ai_review"), v(OTHER, "pending")],
  });
});

describe("pendingCount", () => {
  it("sem a liberação do Apareça → 0, sem ler o retrato", async () => {
    expect(await pendingCount(RID, false)).toBe(0);
    expect(readSnapshot).not.toHaveBeenCalled();
  });
  it("com a liberação → conta só os pending daquele restaurante", async () => {
    expect(await pendingCount(RID, true)).toBe(2);
    expect(vi.mocked(readSnapshot).mock.calls.map((c) => c[1])).toEqual([RID]);
  });
  it("leitura falhou → 0 (o número nunca trava a página)", async () => {
    vi.mocked(readSnapshot).mockRejectedValueOnce(new Error("nocodb 500"));
    expect(await pendingCount(RID, true)).toBe(0);
  });
});
