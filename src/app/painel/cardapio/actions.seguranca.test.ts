import { beforeEach, describe, expect, it, vi } from "vitest";

const RID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const h = vi.hoisted(() => ({
  isMember: vi.fn<(id: string) => Promise<boolean>>(),
  currentUserId: vi.fn<() => Promise<string | null>>(),
  uploadPassthrough: vi.fn<(id: string) => Promise<string>>(),
  videoState: vi.fn<(id: string) => Promise<unknown>>(),
  deleteAsset: vi.fn(async () => {}),
  suggest: vi.fn(async () => ({ title: "x" })),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ currentUserId: h.currentUserId, isMember: h.isMember }));
vi.mock("@/lib/db/nocodb", () => ({}));
vi.mock("@/lib/restaurants", () => ({ refreshMenu: vi.fn() }));
vi.mock("@/lib/menu/auto-translate", () => ({ autoTranslate: vi.fn() }));
vi.mock("@/lib/media-store", () => ({}));
vi.mock("@/lib/translate", () => ({ suggestTranslation: h.suggest, translationEnabled: () => true }));
vi.mock("@/lib/mux", async (orig) => ({
  ...(await orig<typeof import("@/lib/mux")>()),
  muxEnabled: () => true,
  uploadPassthrough: h.uploadPassthrough,
  videoState: h.videoState,
  deleteAsset: h.deleteAsset,
}));

const { discardVideo, suggestTranslations } = await import("./actions");

describe("discardVideo", () => {
  beforeEach(() => {
    for (const m of [h.isMember, h.uploadPassthrough, h.videoState, h.deleteAsset]) m.mockReset();
    h.isMember.mockResolvedValue(true);
    h.uploadPassthrough.mockResolvedValue(RID);
    h.videoState.mockResolvedValue({ status: "processing", assetId: "asset-1" });
  });

  it("membro apagando vídeo do próprio restaurante: apaga o asset", async () => {
    await discardVideo(RID, "up-1");
    expect(h.deleteAsset).toHaveBeenCalledWith("asset-1");
  });

  it("quem não é membro do restaurante: nada acontece, nem consulta o Mux", async () => {
    h.isMember.mockResolvedValue(false);
    await discardVideo(RID, "up-1");
    expect(h.uploadPassthrough).not.toHaveBeenCalled();
    expect(h.deleteAsset).not.toHaveBeenCalled();
  });

  it("vídeo enviado para outro restaurante: não apaga", async () => {
    h.uploadPassthrough.mockResolvedValue(OTHER);
    await discardVideo(RID, "up-1");
    expect(h.deleteAsset).not.toHaveBeenCalled();
  });

  it("sem passthrough no Mux (não dá para provar o dono): mantém o comportamento, vale o membro", async () => {
    h.uploadPassthrough.mockResolvedValue("");
    await discardVideo(RID, "up-1");
    expect(h.deleteAsset).toHaveBeenCalledWith("asset-1");
  });

  it("Mux fora do ar na conferência do dono: não apaga", async () => {
    h.uploadPassthrough.mockRejectedValue(new Error("mux 503"));
    await discardVideo(RID, "up-1");
    expect(h.deleteAsset).not.toHaveBeenCalled();
  });

  it("id de restaurante inválido: ignora", async () => {
    await discardVideo("nao-e-uuid", "up-1");
    expect(h.isMember).not.toHaveBeenCalled();
  });
});

describe("suggestTranslations: limite e entrada", () => {
  const T = { name: "a", description: "b" };
  beforeEach(() => h.suggest.mockClear());

  it("sem login: pede para entrar, sem gastar o serviço", async () => {
    h.currentUserId.mockResolvedValue(null);
    expect((await suggestTranslations(T, ["en"])).error).toMatch(/Entre de novo/);
    expect(h.suggest).not.toHaveBeenCalled();
  });

  it("idiomas repetidos ou desconhecidos não multiplicam as chamadas", async () => {
    h.currentUserId.mockResolvedValue("user-dup");
    const r = await suggestTranslations(T, ["en", "en", "en", "xx", "ja", "pt-BR", "es"]);
    expect(Object.keys(r.suggestions ?? {}).sort()).toEqual(["en", "es"]);
    expect(h.suggest).toHaveBeenCalledTimes(2);
    expect((await suggestTranslations(T, ["ja", "xx"])).error).toMatch(/idioma/);
  });

  it("textos grandes são cortados antes de ir ao serviço", async () => {
    h.currentUserId.mockResolvedValue("user-big");
    await suggestTranslations({ name: "n".repeat(5000), description: "d".repeat(50000) }, ["en"]);
    const sent = h.suggest.mock.calls[0] as unknown as [{ name: string; description: string }];
    expect(sent[0].name).toHaveLength(200);
    expect(sent[0].description).toHaveLength(2000);
  });

  it("cada idioma gasta uma batida: 150 por hora; sem cota para todos, nenhum roda", async () => {
    h.currentUserId.mockResolvedValue("user-A");
    const all = ["en", "es", "fr", "it", "de"];
    for (let i = 0; i < 30; i++) expect((await suggestTranslations(T, all)).suggestions).toBeDefined();
    const calls = h.suggest.mock.calls.length;
    expect((await suggestTranslations(T, ["en"])).error).toMatch(/Muitas sugestões/);
    expect(h.suggest.mock.calls.length).toBe(calls);
    h.currentUserId.mockResolvedValue("user-B");
    expect((await suggestTranslations(T, ["en"])).suggestions).toBeDefined();
  });
});
