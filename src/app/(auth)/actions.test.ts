import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  checkCredentials: vi.fn<(e: string, p: string) => Promise<{ id: string } | null>>(),
  startSession: vi.fn(async (..._a: unknown[]) => {}),
  setPassword: vi.fn(async () => 5),
  currentUser: vi.fn(async () => ({ id: "u1", email: "a@x.com" })),
  currentUserId: vi.fn(async () => "u1"),
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
  currentUser: h.currentUser,
  currentUserId: h.currentUserId,
  findUserByEmail: vi.fn(async () => null),
  setPassword: h.setPassword,
}));

const { signIn, changePassword, updatePassword } = await import("./actions");
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

describe("troca de senha: sessão atual continua, com a versão nova", () => {
  beforeEach(() => {
    h.checkCredentials.mockReset();
    h.startSession.mockClear();
    h.setPassword.mockClear();
  });
  const pw = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };

  it("changePassword: sobe a versão e reemite o cookie com ela", async () => {
    h.checkCredentials.mockResolvedValue({ id: "u1" });
    const r = await changePassword({}, pw({ current: "senha-antiga1", password: "senha-nova-123", confirm: "senha-nova-123" }));
    expect(r.message).toMatch(/Senha alterada/);
    expect(h.setPassword).toHaveBeenCalledWith("u1", "senha-nova-123");
    expect(h.startSession).toHaveBeenCalledWith("u1", 5);
  });

  it("changePassword com a senha atual errada não troca nada", async () => {
    h.checkCredentials.mockResolvedValue(null);
    const r = await changePassword({}, pw({ current: "errada-errada", password: "senha-nova-123", confirm: "senha-nova-123" }));
    expect(r.error).toMatch(/atual está errada/);
    expect(h.setPassword).not.toHaveBeenCalled();
    expect(h.startSession).not.toHaveBeenCalled();
  });

  it("updatePassword: sobe a versão e reemite o cookie", async () => {
    await expect(updatePassword({}, pw({ password: "senha-nova-123" }))).rejects.toThrow("redirect:/painel");
    expect(h.startSession).toHaveBeenCalledWith("u1", 5);
  });
});
