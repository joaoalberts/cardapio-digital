// Mux do Apareça com fetch falso: nunca fala com o Mux de verdade.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let reply: (c: Call) => { status: number; body?: unknown } = () => ({ status: 200, body: { data: {} } });

beforeEach(() => {
  calls = [];
  vi.stubEnv("MUX_TOKEN_ID", "id-teste");
  vi.stubEnv("MUX_TOKEN_SECRET", "segredo-teste");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { method?: string; body?: string }) => {
      const c = { url, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : undefined };
      calls.push(c);
      const r = reply(c);
      return new Response(r.status === 204 ? null : JSON.stringify(r.body ?? {}), { status: r.status });
    }),
  );
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const load = () => import("./mux-video");

describe("createAparecaUpload", () => {
  it("pede basic, 1080p, MP4 highest, público e o passthrough", async () => {
    reply = () => ({ status: 201, body: { data: { id: "up1", url: "https://up" } } });
    const { createAparecaUpload } = await load();
    expect(await createAparecaUpload("https://casa.test", "apareca:r:-:v")).toEqual({ id: "up1", url: "https://up" });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toMatch(/\/uploads$/);
    expect(calls[0].body).toEqual({
      cors_origin: "https://casa.test",
      new_asset_settings: {
        playback_policies: ["public"],
        video_quality: "basic",
        max_resolution_tier: "1080p",
        static_renditions: [{ resolution: "highest" }],
        passthrough: "apareca:r:-:v",
      },
    });
  });

  it("sem as chaves do Mux lança 'mux desligado' sem chamar a rede", async () => {
    vi.stubEnv("MUX_TOKEN_ID", "");
    const { createAparecaUpload } = await load();
    await expect(createAparecaUpload("https://x", "apareca:r:-:v")).rejects.toThrow("mux desligado");
    expect(calls).toHaveLength(0);
  });

  it("recusa passthrough acima de 255 caracteres", async () => {
    const { createAparecaUpload } = await load();
    await expect(createAparecaUpload("https://x", "a".repeat(256))).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("assetInfo", () => {
  const asset = (p: Record<string, unknown> = {}) => ({
    status: "ready",
    duration: 6.02,
    playback_ids: [{ id: "pb1", policy: "public" }],
    static_renditions: { files: [{ name: "highest.mp4", resolution: "highest", status: "ready" }] },
    ...p,
  });
  const route = (up: unknown, as?: unknown) => (c: Call) =>
    c.url.includes("/uploads/") ? { status: 200, body: { data: up } } : { status: 200, body: { data: as } };

  it("pronto: asset, playback público, duração e MP4 highest pronto", async () => {
    reply = route({ status: "asset_created", asset_id: "as1" }, asset());
    const { assetInfo } = await load();
    expect(await assetInfo("up1")).toEqual({ status: "ready", assetId: "as1", playbackId: "pb1", durationS: 6.02, mp4: true });
  });

  it("MP4 ainda preparando: pronto com mp4 false", async () => {
    reply = route(
      { status: "asset_created", asset_id: "as1" },
      asset({ static_renditions: { files: [{ name: "highest.mp4", resolution: "highest", status: "preparing" }] } }),
    );
    const { assetInfo } = await load();
    expect(await assetInfo("up1")).toMatchObject({ status: "ready", mp4: false });
  });

  it("upload sem asset ainda: processing; upload cancelado ou asset com erro: failed", async () => {
    const { assetInfo } = await load();
    reply = route({ status: "waiting" });
    expect(await assetInfo("up1")).toEqual({ status: "processing" });
    reply = route({ status: "timed_out" });
    expect(await assetInfo("up1")).toEqual({ status: "failed" });
    reply = route({ status: "asset_created", asset_id: "as1" }, asset({ status: "errored" }));
    expect(await assetInfo("up1")).toEqual({ status: "failed" });
    reply = route({ status: "asset_created", asset_id: "as1" }, asset({ status: "preparing" }));
    expect(await assetInfo("up1")).toEqual({ status: "processing" });
  });
});

describe("deleteMuxAsset", () => {
  it("apaga e lança quando o Mux falha (para segurar a linha)", async () => {
    const { deleteMuxAsset } = await load();
    reply = () => ({ status: 204 });
    await expect(deleteMuxAsset("as1")).resolves.toBeUndefined();
    expect(calls[0]).toMatchObject({ method: "DELETE" });
    expect(calls[0].url).toMatch(/\/assets\/as1$/);
    reply = () => ({ status: 500, body: {} });
    await expect(deleteMuxAsset("as1")).rejects.toThrow(/mux 500/);
  });

  it("asset que já não existe (404) conta como apagado e avisa no log sem o id", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { deleteMuxAsset } = await load();
    reply = () => ({ status: 404, body: {} });
    await expect(deleteMuxAsset("as1")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0])).not.toContain("as1");
  });

  it("id fora do formato não vira caminho da API", async () => {
    const { deleteMuxAsset } = await load();
    await expect(deleteMuxAsset("../uploads")).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("releaseMuxUpload", () => {
  const route = (up: unknown) => (c: Call) =>
    c.url.includes("/uploads/") && c.method === "GET" ? { status: 200, body: { data: up } } : { status: 204 };

  it("upload que já virou asset: apaga o asset", async () => {
    reply = route({ status: "asset_created", asset_id: "as9" });
    const { releaseMuxUpload } = await load();
    await releaseMuxUpload("up1");
    expect(calls.map((c) => `${c.method} ${c.url.replace(/^.*\/video\/v1/, "")}`)).toEqual([
      "GET /uploads/up1",
      "DELETE /assets/as9",
    ]);
  });

  it("upload ainda esperando: cancela", async () => {
    reply = route({ status: "waiting" });
    const { releaseMuxUpload } = await load();
    await releaseMuxUpload("up1");
    expect(calls.map((c) => `${c.method} ${c.url.replace(/^.*\/video\/v1/, "")}`)).toEqual([
      "GET /uploads/up1",
      "PUT /uploads/up1/cancel",
    ]);
  });

  it("upload cancelado ou com erro e sem asset: nada a fazer", async () => {
    reply = route({ status: "timed_out" });
    const { releaseMuxUpload } = await load();
    await releaseMuxUpload("up1");
    expect(calls).toHaveLength(1);
  });

  it("consulta que falha lança (a linha fica para a próxima leitura)", async () => {
    reply = () => ({ status: 500, body: {} });
    const { releaseMuxUpload } = await load();
    await expect(releaseMuxUpload("up1")).rejects.toThrow(/mux 500/);
    await expect(releaseMuxUpload("../x")).rejects.toThrow();
  });
});

describe("endereços", () => {
  it("MP4, HLS e quadro usam as bases trocáveis", async () => {
    let m = await load();
    expect(m.mp4Url("pb1")).toBe("https://stream.mux.com/pb1/highest.mp4");
    expect(m.hlsUrl("pb1")).toBe("https://stream.mux.com/pb1.m3u8");
    expect(m.frameUrl("pb1", 0.5)).toBe("https://image.mux.com/pb1/thumbnail.jpg?time=0.5&width=640");
    vi.stubEnv("MUX_STREAM_BASE", "http://localhost:9999/s");
    vi.stubEnv("MUX_IMAGE_BASE", "http://localhost:9999/i");
    vi.resetModules();
    m = await load();
    expect(m.mp4Url("pb1")).toBe("http://localhost:9999/s/pb1/highest.mp4");
    expect(m.frameUrl("pb1", 3)).toBe("http://localhost:9999/i/pb1/thumbnail.jpg?time=3&width=640");
  });
});
