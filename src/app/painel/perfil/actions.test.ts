// Perfil e a Comunidade: o @ do Instagram, o nome, a logo, a cor e o horário estão na
// cabeça da Comunidade (cache de 5 min). Salvar no Perfil invalida comunidade:<slug> na hora.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  updateTag: vi.fn<(tag: string) => void>(),
  updateRows: vi.fn(async () => {}),
  first: vi.fn(async () => ({ Id: 1, slug: "forno", logo_path: null, languages: ["pt-BR"] })),
}));
vi.mock("next/cache", () => ({ updateTag: h.updateTag }));
vi.mock("@/lib/auth", () => ({ isOwner: async () => true }));
vi.mock("@/lib/db/nocodb", () => ({ first: h.first, updateRows: h.updateRows }));
vi.mock("@/lib/menu/data", () => ({ menuTag: (s: string) => `menu:${s}` }));
vi.mock("@/lib/menu/auto-translate", () => ({ backfillTranslations: async () => 0 }));
vi.mock("@/lib/media-store", () => ({ replaceMedia: async () => ({}), validMedia: () => true }));
vi.mock("@/lib/storage", () => ({ ownsFile: () => true, removeFiles: async () => {} }));
vi.mock("@/lib/menu/payments", () => ({ PAYMENT_IDS: ["pix"] }));

const actions = await import("./actions");
const RID = "00000000-0000-4000-8000-000000000001";
const week = Array.from({ length: 7 }, () => [{ open: "18:00", close: "23:00" }]);

beforeEach(() => h.updateTag.mockClear());

describe("Perfil invalida a cabeça da Comunidade", () => {
  it("salvar o perfil (Instagram) chama updateTag('comunidade:<slug>') além do cardápio", async () => {
    const res = await actions.saveProfile(RID, {
      name: "Forno",
      phone: "",
      address: "",
      description: "",
      brandColor: "#c08a3e",
      instagram: "@forno",
      facebook: "",
      wifiName: "",
      wifiPassword: "",
      showHours: true,
      hours: week,
      showPayments: false,
      paymentMethods: [],
    });
    expect(res).toEqual({});
    expect(h.updateTag).toHaveBeenCalledWith("menu:forno");
    expect(h.updateTag).toHaveBeenCalledWith("comunidade:forno");
  });

  it("logo, horário e cor também (estão no telão e no story)", async () => {
    await actions.setLogo(RID, null);
    await actions.saveHours(RID, week);
    await actions.saveMenuSettings(RID, { brandColor: "#112233", wifiName: "", wifiPassword: "" });
    expect(h.updateTag.mock.calls.filter(([t]) => t === "comunidade:forno")).toHaveLength(3);
  });

  it("erro de validação não invalida nada", async () => {
    const res = await actions.saveProfile(RID, {
      name: "Forno", phone: "", address: "", description: "", brandColor: "#c08a3e", instagram: "@@ inválido",
      facebook: "", wifiName: "", wifiPassword: "", showHours: false, hours: week, showPayments: false, paymentMethods: [],
    });
    expect(res.error).toBeTruthy();
    expect(h.updateTag).not.toHaveBeenCalled();
  });
});
