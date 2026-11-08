import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  checkCredentials: vi.fn<(e: string, p: string) => Promise<{ id: string } | null>>(),
  startSession: vi.fn(async () => {}),
  ip: "20.0.0.1",
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": h.ip }) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/lib/restaurants", () => ({ createRestaurantFor: vi.fn(), slugTaken: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  EMAIL: /^\S+@\S+\.\S+$/,
  normalizeEmail: (e: string) => e.trim().toLowerCase(),
  checkCredentials: h.checkCredentials,
  startSession: h.startSession,
  createUser: vi.fn(),
  currentUser: vi.fn(),
  currentUserId: vi.fn(),
  findUserByEmail: vi.fn(async () => null),
  setPassword: vi.fn(),
}));

const { signIn } = await import("./actions");
const form = (email: string, password = "senha-errada") => {
  const f = new FormData();
  f.set("email", email);
  f.set("password", password);
  return f;
};

describe("signIn: limite de tentativas", () => {
  beforeEach(() => {
    h.checkCredentials.mockReset();
    h.startSession.mockClear();
  });

  it("5 senhas erradas no mesmo e-mail (com maiúsculas) e a 6ª errada recebe 'Muitas tentativas'", async () => {
    h.checkCredentials.mockResolvedValue(null);
    for (let i = 0; i < 5; i++) {
      expect(await signIn({}, form(i % 2 ? "Dono@x.com " : "dono@x.com"))).toEqual({ error: "E-mail ou senha incorretos." });
    }
    expect(await signIn({}, form("DONO@x.com"))).toEqual({ error: "Muitas tentativas. Tente de novo em alguns minutos." });
  });

  it("limite estourado + senha certa: entra normalmente", async () => {
    h.ip = "20.0.0.5";
    h.checkCredentials.mockResolvedValue(null);
    for (let i = 0; i < 7; i++) await signIn({}, form("vitima@x.com"));
    h.checkCredentials.mockResolvedValue({ id: "u9" });
    await expect(signIn({}, form("vitima@x.com", "senha-certa"))).rejects.toThrow("redirect:/painel");
    expect(h.startSession).toHaveBeenCalledWith("u9");
  });

  it("limite estourado + senha errada: recusa com a mensagem de limite, sem contar mais falha", async () => {
    h.ip = "20.0.0.6";
    h.checkCredentials.mockResolvedValue(null);
    for (let i = 0; i < 5; i++) await signIn({}, form("outro@x.com"));
    for (let i = 0; i < 30; i++) {
      expect(await signIn({}, form("outro@x.com"))).toEqual({ error: "Muitas tentativas. Tente de novo em alguns minutos." });
    }
    expect(h.startSession).not.toHaveBeenCalled();
    // E-mail diferente do mesmo IP continua dentro do limite do IP (5 falhas contadas, não 35).
    expect(await signIn({}, form("terceiro@x.com"))).toEqual({ error: "E-mail ou senha incorretos." });
  });

  it("logins certos não contam: dá para entrar muitas vezes", async () => {
    h.checkCredentials.mockResolvedValue({ id: "u1" });
    h.ip = "20.0.0.2";
    for (let i = 0; i < 15; i++) {
      await expect(signIn({}, form("certo@x.com", "senha-certa"))).rejects.toThrow("redirect:/painel");
    }
    expect(h.startSession).toHaveBeenCalledTimes(15);
  });

  it("erro do banco não conta como tentativa", async () => {
    h.ip = "20.0.0.3";
    h.checkCredentials.mockRejectedValue(new Error("fora do ar"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 8; i++) {
      expect((await signIn({}, form("db@x.com"))).error).toMatch(/banco não respondeu/);
    }
  });
});
