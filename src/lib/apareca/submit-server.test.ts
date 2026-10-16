// Ligação real da IA nas rotas do cliente (decisão 3): a ANTHROPIC_API_KEY sozinha não liga nada;
// precisa do interruptor do restaurante e de não estar com APARECA_OFF=1. onReady só chama a IA em ai_review.
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "./config";
import type { AparecaHead, VideoRow } from "./types";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock("@/lib/comunidade/server", () => ({ getCommunityContent: vi.fn() }));
vi.mock("@/lib/db/nocodb", () => ({ list: vi.fn(), first: vi.fn(async () => null), insert: vi.fn(), removeIds: vi.fn(), updateRows: vi.fn() }));

import * as nocodb from "@/lib/db/nocodb";
import { routeDeps } from "./submit-server";

const head = (ai_allowed: boolean): AparecaHead => ({
  id: "00000000-0000-4000-8000-000000000001", slug: "casa", name: "Casa", timezone: "America/Sao_Paulo", opening_hours: null,
  allowed: true, ai_allowed, enabled: true, community_enabled: true, config: { ...DEFAULT_CONFIG, mode: "automatico" },
  logo_path: null, brand_color: null, instagram: null,
});
const req = () => new Request("https://cardapio.test/api/apareca/casa/enviar", { method: "POST" });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("routeDeps: IA", () => {
  it("chave presente e ai_allowed false → IA desligada", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    vi.stubEnv("APARECA_OFF", "");
    expect(routeDeps(req()).aiOn?.(head(false))).toBe(false);
  });
  it("ai_allowed true sem chave → desligada; com APARECA_OFF=1 → desligada; com os dois → ligada", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("APARECA_OFF", "");
    expect(routeDeps(req()).aiOn?.(head(true))).toBe(false);
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    vi.stubEnv("APARECA_OFF", "1");
    expect(routeDeps(req()).aiOn?.(head(true))).toBe(false);
    vi.stubEnv("APARECA_OFF", "");
    expect(routeDeps(req()).aiOn?.(head(true))).toBe(true);
  });
  it("onReady com pending não lê o banco nem chama a IA; com ai_review relê a linha", async () => {
    const d = routeDeps(req());
    await d.onReady({ id: "x", status: "pending" } as VideoRow, head(true));
    expect(nocodb.first).not.toHaveBeenCalled();
    await d.onReady({ id: "x", status: "ai_review" } as VideoRow, head(true));
    expect(nocodb.first).toHaveBeenCalledWith("apareca_videos", { uid: "x" });
  });
});
