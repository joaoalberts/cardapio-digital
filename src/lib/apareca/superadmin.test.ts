// Super admin do Apareça (T17): quem é super admin, a liberação em cadeia e o uso por restaurante.
// E-mails só fictícios (@exemplo.com); a lista real fica na variável SUPERADMIN_EMAILS da Vercel.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminRows, aiAllowedPatch, allowedPatch, isSuperAdmin, superAdminList } from "./superadmin";

const h = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  row: null as Record<string, unknown> | null,
  updateTag: vi.fn<(tag: string) => void>(),
  updateRows: vi.fn<(t: string, rows: Record<string, unknown>[]) => Promise<void>>(async () => {}),
  first: vi.fn<(t: string, w: Record<string, unknown>) => Promise<Record<string, unknown> | null>>(async () => null),
}));
vi.mock("next/cache", () => ({ updateTag: h.updateTag }));
vi.mock("@/lib/auth", () => ({ currentUser: async () => h.user }));
vi.mock("@/lib/db/nocodb", () => ({ first: h.first, updateRows: h.updateRows }));
// store.ts é "server-only"; as etiquetas são as mesmas de lá (apareca:slug:<slug>, apareca:rid:<id>).
vi.mock("@/lib/apareca/store", () => ({
  aparecaTags: { slug: (s: string) => `apareca:slug:${s}`, rid: (id: string) => `apareca:rid:${id}` },
}));

const actions = await import("@/app/painel/apareca/admin/actions");

const RID = "00000000-0000-4000-8000-000000000001";
const ADMIN = { id: "u1", email: "Admin@Exemplo.com" };
const OWNER = { id: "u2", email: "dono@exemplo.com" };

beforeEach(() => {
  process.env.SUPERADMIN_EMAILS = " admin@exemplo.com , outro@exemplo.com";
  h.user = ADMIN;
  h.row = { Id: 7, id: RID, slug: "Forno", apareca_allowed: true, apareca_enabled: true, apareca_ai_allowed: true, apareca_config: { mode: "automatico" } };
  h.first.mockImplementation(async (_t, w) => (h.row && w.uid === h.row.id ? h.row : null));
  h.updateRows.mockClear();
  h.updateTag.mockClear();
});

describe("isSuperAdmin", () => {
  it("lista com vírgulas, espaços e maiúsculas", () => {
    expect(isSuperAdmin("Joao@X.com", " joao@x.com , outro@y.com")).toBe(true);
    expect(isSuperAdmin("outro@y.com", " joao@x.com , outro@y.com")).toBe(true);
    expect(superAdminList(" A@b.com,, c@d.com ")).toEqual(new Set(["a@b.com", "c@d.com"]));
  });
  it("vazio ou ausente = ninguém", () => {
    expect(isSuperAdmin("a@b.com", "")).toBe(false);
    expect(isSuperAdmin("a@b.com", " , ")).toBe(false);
    expect(isSuperAdmin("a@b.com", undefined)).toBe(false);
    expect(superAdminList(undefined).size).toBe(0);
  });
  it("sem e-mail = não", () => {
    expect(isSuperAdmin(null, "joao@x.com")).toBe(false);
    expect(isSuperAdmin(undefined, "joao@x.com")).toBe(false);
    expect(isSuperAdmin("", "joao@x.com")).toBe(false);
    expect(isSuperAdmin("   ", " , joao@x.com")).toBe(false);
  });
  it("e-mail parecido não vale", () => {
    expect(isSuperAdmin("joao@x.com.br", "joao@x.com")).toBe(false);
    expect(isSuperAdmin("xjoao@x.com", "joao@x.com")).toBe(false);
  });
});

describe("liberação em cadeia (puro)", () => {
  it("desligar a liberação desliga também o interruptor do dono", () => {
    expect(allowedPatch(false)).toEqual({ apareca_allowed: false, apareca_enabled: false });
    expect(allowedPatch(true)).toEqual({ apareca_allowed: true });
  });
  it("desligar a IA volta o modo para manual", () => {
    expect(aiAllowedPatch(false, { mode: "automatico", plays: 2 })).toMatchObject({
      apareca_ai_allowed: false,
      apareca_config: { mode: "manual", plays: 2 },
    });
    expect(aiAllowedPatch(false, { mode: "hibrido" })).toMatchObject({ apareca_config: { mode: "manual" } });
    expect(aiAllowedPatch(false, { mode: "manual" })).toEqual({ apareca_ai_allowed: false });
    expect(aiAllowedPatch(true, { mode: "manual" })).toEqual({ apareca_ai_allowed: true });
  });
});

describe("actions do super admin", () => {
  it("mutação: dono comum (não super admin) → erro e nada gravado", async () => {
    h.user = OWNER;
    expect((await actions.setAllowed(RID, false)).error).toBeTruthy();
    expect((await actions.setAllowed(RID, true)).error).toBeTruthy();
    expect((await actions.setAiAllowed(RID, false)).error).toBeTruthy();
    expect((await actions.setAiAllowed(RID, true)).error).toBeTruthy();
    expect(h.updateRows).not.toHaveBeenCalled();
    expect(h.updateTag).not.toHaveBeenCalled();
  });

  it("sem sessão ou sem lista → erro e nada gravado", async () => {
    h.user = null;
    expect((await actions.setAllowed(RID, true)).error).toBeTruthy();
    h.user = ADMIN;
    process.env.SUPERADMIN_EMAILS = "";
    expect((await actions.setAiAllowed(RID, true)).error).toBeTruthy();
    delete process.env.SUPERADMIN_EMAILS;
    expect((await actions.setAllowed(RID, true)).error).toBeTruthy();
    expect(h.updateRows).not.toHaveBeenCalled();
  });

  it("id inválido ou restaurante inexistente → erro", async () => {
    expect((await actions.setAllowed("abc", true)).error).toBeTruthy();
    expect((await actions.setAllowed("00000000-0000-4000-8000-000000000999", true)).error).toBeTruthy();
    expect(h.updateRows).not.toHaveBeenCalled();
  });

  it("setAllowed(false) grava apareca_allowed:false e apareca_enabled:false e limpa o cache", async () => {
    expect(await actions.setAllowed(RID, false)).toEqual({});
    expect(h.updateRows).toHaveBeenCalledWith("restaurants", [{ Id: 7, apareca_allowed: false, apareca_enabled: false }]);
    expect(h.updateTag).toHaveBeenCalledWith("apareca:slug:forno");
    expect(h.updateTag).toHaveBeenCalledWith(`apareca:rid:${RID}`);
  });

  it("setAllowed(true) só libera; quem liga é o dono", async () => {
    expect(await actions.setAllowed(RID, true)).toEqual({});
    expect(h.updateRows).toHaveBeenCalledWith("restaurants", [{ Id: 7, apareca_allowed: true }]);
  });

  it("setAiAllowed(false) com modo automático grava modo manual", async () => {
    expect(await actions.setAiAllowed(RID, false)).toEqual({});
    const [, rows] = h.updateRows.mock.calls[0];
    expect(rows[0]).toMatchObject({ Id: 7, apareca_ai_allowed: false, apareca_config: { mode: "manual" } });
    expect(h.updateTag).toHaveBeenCalledWith(`apareca:rid:${RID}`);
  });

  it("setAiAllowed(true) não mexe no modo", async () => {
    expect(await actions.setAiAllowed(RID, true)).toEqual({});
    expect(h.updateRows).toHaveBeenCalledWith("restaurants", [{ Id: 7, apareca_ai_allowed: true }]);
  });

  it("falha do banco → erro, sem limpar o cache", async () => {
    h.updateRows.mockRejectedValueOnce(new Error("x"));
    expect((await actions.setAllowed(RID, false)).error).toBeTruthy();
    expect(h.updateTag).not.toHaveBeenCalled();
  });
});

describe("adminRows", () => {
  const A = "00000000-0000-4000-8000-00000000000a";
  const B = "00000000-0000-4000-8000-00000000000b";
  const now = new Date("2026-10-16T15:00:00Z");
  const vid = (o: Record<string, unknown>) => ({
    restaurant_id: A, status: "approved", mux_asset_id: "as", duration_ms: 6_000,
    created_at: "2026-10-16T14:00:00Z", expires_at: "2026-10-16T20:00:00Z", ...o,
  });

  it("vídeos guardados agora e minutos no Mux no mês, por restaurante", () => {
    const rows = adminRows({
      month: "2026-10",
      now,
      restaurants: [
        { id: B, name: "Bistrô", slug: "bistro", apareca_allowed: false },
        { id: A, name: "Adega", slug: "adega", apareca_allowed: true, apareca_ai_allowed: true, apareca_enabled: true },
      ],
      videos: [
        vid({}),
        vid({ status: "pending" }),
        vid({ status: "rejected", mux_asset_id: null }), // asset já apagado
        vid({ expires_at: "2026-10-16T14:30:00Z" }), // vencido, à espera do purge: não conta como guardado, mas foi codificado no mês
        vid({ created_at: "2026-09-30T12:00:00Z" }), // mês passado
        vid({ restaurant_id: B, duration_ms: 3_000 }),
      ],
      tallies: [
        { restaurant_id: A, month: "2026-10", counts: { encoded_s: 120 } },
        { restaurant_id: A, month: "2026-09", counts: { encoded_s: 999 } },
      ],
      houses: [
        { restaurant_id: A, active: true, mux_asset_id: "h1", duration_ms: 60_000 },
        { restaurant_id: A, active: false, mux_asset_id: "h2", duration_ms: 60_000 },
      ],
    });
    expect(rows.map((r) => r.slug)).toEqual(["adega", "bistro"]);
    const a = rows[0];
    expect(a).toMatchObject({ name: "Adega", allowed: true, ai_allowed: true, enabled: true, stored_now: 5 });
    // 120 s do tally + 4 vídeos de 6 s criados em outubro (24 s) = 144 s = 2,4 min, + 1 min de institucional ativo.
    expect(a.mux_min_month).toBeCloseTo(3.4, 5);
    expect(rows[1]).toMatchObject({ allowed: false, ai_allowed: false, enabled: false, stored_now: 1 });
    expect(rows[1].mux_min_month).toBeCloseTo(0.05, 5);
  });

  it("ignora restaurante sem id ou slug", () => {
    expect(adminRows({ month: "2026-10", now, restaurants: [{ name: "x" }], videos: [], tallies: [], houses: [] })).toEqual([]);
  });
});
