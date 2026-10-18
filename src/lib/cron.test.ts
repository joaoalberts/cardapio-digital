import { describe, expect, it } from "vitest";
import { cronAuth } from "./cron";

describe("cronAuth", () => {
  it("sem CRON_SECRET (ou vazia) nunca roda aberta", () => {
    expect(cronAuth("Bearer qualquer", undefined)).toBe("no_secret");
    expect(cronAuth("Bearer ", "")).toBe("no_secret");
    expect(cronAuth("Bearer    ", "   ")).toBe("no_secret");
  });
  it("só aceita exatamente 'Bearer <segredo>'", () => {
    const s = "segredo-de-teste-123456";
    expect(cronAuth(`Bearer ${s}`, s)).toBe("ok");
    expect(cronAuth(null, s)).toBe("denied");
    expect(cronAuth("", s)).toBe("denied");
    expect(cronAuth(s, s)).toBe("denied");
    expect(cronAuth(`bearer ${s}`, s)).toBe("denied");
    expect(cronAuth(`Bearer ${s}x`, s)).toBe("denied");
    expect(cronAuth(`Bearer ${s.slice(0, -1)}`, s)).toBe("denied");
  });
});
