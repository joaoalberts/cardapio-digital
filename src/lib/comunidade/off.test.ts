import { afterEach, describe, expect, it, vi } from "vitest";
import { communityOff } from "./off";

// Se tv.ts ou funnel.ts voltarem a importar votes.ts, o import abaixo quebra.
vi.mock("./votes", () => {
  throw new Error("votes.ts não deve ser carregado por tv.ts nem por funnel.ts");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("communityOff", () => {
  it("só COMMUNITY_OFF=1 desliga", () => {
    vi.stubEnv("COMMUNITY_OFF", "1");
    expect(communityOff()).toBe(true);
    for (const v of ["", "0", "true", "sim"]) {
      vi.stubEnv("COMMUNITY_OFF", v);
      expect(communityOff()).toBe(false);
    }
  });

  it("tv.ts e funnel.ts usam a chave sem arrastar votes.ts", async () => {
    const tv = await import("./tv");
    const funnel = await import("./funnel");
    expect(typeof tv.checkTv).toBe("function");
    expect(typeof funnel.recordFunnelWith).toBe("function");
  });
});
