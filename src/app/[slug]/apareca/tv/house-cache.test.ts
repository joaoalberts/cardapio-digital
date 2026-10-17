import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HouseClip } from "@/lib/apareca/schedule";
import { cacheHouse, HOUSE_CACHE, houseSrc } from "./house-cache";

// Cache API falsa em memória (o vitest roda em node, sem caches).
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    return {
      keys: async () => [...m.keys()].map((url) => ({ url })),
      delete: async (r: { url: string } | string) => m.delete(typeof r === "string" ? r : r.url),
      match: async (url: string) => m.get(url)?.clone(),
      put: async (url: string, r: Response) => void m.set(url, r),
    };
  };
  return { stores, api: { open } };
}

const mp4 = (id: string) => `https://stream.mux.com/${id}/highest.mp4`;
const clip = (playback: string): HouseClip => ({ id: "00000000-0000-4000-8000-000000000001", playback, aspect: "16:9", duration_s: 0 });

describe("house-cache", () => {
  let fc: ReturnType<typeof fakeCaches>;
  let fetched: string[];
  beforeEach(() => {
    fc = fakeCaches();
    fetched = [];
    vi.stubGlobal("caches", fc.api);
    vi.stubGlobal("fetch", async (url: string) => {
      fetched.push(url);
      if (url.includes("quebrado")) return new Response("x", { status: 404 });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "video/mp4" } });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("baixa o que falta e apaga do cache o que saiu do programa", async () => {
    await cacheHouse([clip("a"), clip("b")], mp4);
    expect([...fc.stores.get(HOUSE_CACHE)!.keys()].sort()).toEqual([mp4("a"), mp4("b")]);
    await cacheHouse([clip("b"), clip("c")], mp4);
    expect([...fc.stores.get(HOUSE_CACHE)!.keys()].sort()).toEqual([mp4("b"), mp4("c")]);
    // "b" já estava: não baixa de novo
    expect(fetched.filter((u) => u === mp4("b"))).toHaveLength(1);
  });

  it("resposta com erro não entra no cache", async () => {
    await cacheHouse([clip("quebrado")], mp4);
    expect(fc.stores.get(HOUSE_CACHE)!.size).toBe(0);
  });

  it("houseSrc: objectURL quando está guardado; a URL do Mux quando não está", async () => {
    await cacheHouse([clip("a")], mp4);
    expect(await houseSrc("a", mp4)).toMatch(/^blob:/);
    expect(await houseSrc("z", mp4)).toBe(mp4("z"));
  });

  it("sem Cache API (TV por http://<IP>): a URL do Mux, sem erro", async () => {
    vi.stubGlobal("caches", undefined);
    await expect(cacheHouse([clip("a")], mp4)).resolves.toBeUndefined();
    expect(await houseSrc("a", mp4)).toBe(mp4("a"));
  });
});
