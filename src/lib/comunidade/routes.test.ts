// Rotas públicas da Comunidade de ponta a ponta, com o banco e as leituras em cache falsos:
// prova que cada rota usa o corte de corpo em fluxo e os limites em memória.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { CommunityHead, PostRow } from "./types";

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  type Where = Record<string, unknown>;
  const store: Record<string, Row[]> = {};
  let nextId = 1;
  const match = (r: Row, w: Where) => Object.entries(w).every(([k, v]) => (r[k] ?? null) === v);
  const db = {
    list: vi.fn(async (t: string, w: Where = {}) => (store[t] ?? []).filter((r) => match(r, w)).map((r) => ({ ...r }))),
    first: vi.fn(async (t: string, w: Where) => {
      const r = (store[t] ?? []).find((x) => match(x, w));
      return r ? { ...r } : null;
    }),
    insertOne: vi.fn(async (t: string, row: Row) => {
      const uid = crypto.randomUUID();
      const full = { Id: nextId++, uid, id: uid, created_at: new Date().toISOString(), ...row };
      (store[t] ??= []).push(full);
      return { ...full };
    }),
    insert: vi.fn(async () => []),
    update: vi.fn(async (t: string, w: Where, p: Row) => {
      const hit = (store[t] ?? []).filter((r) => match(r, w));
      for (const r of hit) Object.assign(r, p);
      return hit.length;
    }),
    remove: vi.fn(async (t: string, w: Where) => {
      const all = store[t] ?? [];
      const keep = all.filter((r) => !match(r, w));
      store[t] = keep;
      return all.length - keep.length;
    }),
  };
  // Cada slug (menos "nada") é um restaurante com a Comunidade ligada e sem horário.
  const ids = new Map<string, string>();
  const headOf = (slug: string) => {
    if (!ids.has(slug)) ids.set(slug, `00000000-0000-4000-8000-${String(ids.size + 1).padStart(12, "0")}`);
    return {
      id: ids.get(slug) as string,
      slug,
      name: slug,
      enabled: true,
      day_start: "05:00",
      timezone: "America/Sao_Paulo",
      opening_hours: null,
      instagram: null,
      logo_path: null,
      brand_color: null,
    };
  };
  return {
    store,
    db,
    headOf,
    getCommunityHead: vi.fn(async (slug: string) => (slug === "nada" ? null : headOf(slug))),
    getCommunityContent: vi.fn(async (): Promise<{ polls: unknown[]; posts: unknown[]; tvs: unknown[] }> => ({ polls: [], posts: [], tvs: [] })),
    getCommunityTables: vi.fn(async () => []),
    recordFunnel: vi.fn(async () => {}),
  };
});

vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  // Fora de um pedido do Next, after() roda na hora.
  after: (task: unknown) => (typeof task === "function" ? task() : task),
}));
vi.mock("@/lib/db/nocodb", () => h.db);
vi.mock("@/lib/comunidade/server", () => ({
  getCommunityHead: h.getCommunityHead,
  getCommunityContent: h.getCommunityContent,
  getCommunityTables: h.getCommunityTables,
}));
vi.mock("@/lib/comunidade/funnel", async (orig) => ({
  ...(await orig<typeof import("./funnel")>()),
  recordFunnel: h.recordFunnel,
}));

const votar = await import("@/app/api/comunidade/[slug]/votar/route");
const eventos = await import("@/app/api/comunidade/[slug]/eventos/route");
const codigo = await import("@/app/api/comunidade/[slug]/telao/codigo/route");
const estado = await import("@/app/api/comunidade/[slug]/telao/estado/route");
const leitura = await import("@/app/api/comunidade/[slug]/route");
const { sha256Hex } = await import("./tv");

type Handler = (r: NextRequest, c: { params: Promise<{ slug: string }> }) => Promise<Response>;
const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let ipSeq = 0;
// Um IP novo por teste: os limitadores ficam no globalThis e duram o arquivo inteiro.
const freshIp = () => `198.51.100.${++ipSeq}`;

function post(url: string, body: BodyInit | null, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${url}`, { method: "POST", body, headers, duplex: "half" } as ConstructorParameters<typeof NextRequest>[1]);
}

beforeEach(() => {
  h.recordFunnel.mockClear();
  for (const f of Object.values(h.db)) f.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("corpo lido em fluxo, com teto, em todas as rotas POST", () => {
  const routes: [string, Handler, string][] = [
    ["votar", votar.POST, "/api/comunidade/forno/votar"],
    ["eventos", eventos.POST, "/api/comunidade/forno/eventos"],
    ["telao/codigo", codigo.POST, "/api/comunidade/forno/telao/codigo"],
    ["telao/estado", estado.POST, "/api/comunidade/forno/telao/estado"],
  ];
  for (const [name, handler, url] of routes) {
    it(`${name}: corpo sem fim e sem content-length → 413, lendo só o começo`, async () => {
      let made = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(ctrl) {
          if (made++ < 10_000) ctrl.enqueue(new Uint8Array(1_024).fill(0x7b));
          else ctrl.close();
        },
      });
      const res = await handler(post(url, body, { "x-forwarded-for": freshIp() }), ctx("forno"));
      expect(res.status).toBe(413);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(made).toBeLessThan(10);
      expect(h.db.list).not.toHaveBeenCalled();
      expect(h.db.insertOne).not.toHaveBeenCalled();
    });
  }
});

describe("eventos: limites em memória", () => {
  const send = (device: string, e: Record<string, number>, ip: string, slug = "forno") =>
    eventos.POST(post(`/api/comunidade/${slug}/eventos`, JSON.stringify({ mesa: null, device, e }), { "x-forwarded-for": ip, "content-type": "text/plain" }), ctx(slug));

  it("61 lotes do mesmo IP no mesmo minuto: todos 204, só 60 somam", async () => {
    const ip = freshIp();
    for (let i = 0; i < 61; i++) {
      const res = await send(U(10_000 + i), { open: 1 }, ip);
      expect(res.status).toBe(204);
    }
    expect(h.recordFunnel).toHaveBeenCalledTimes(60);
    // Outro IP continua somando.
    expect((await send(U(10_100), { open: 1 }, freshIp())).status).toBe(204);
    expect(h.recordFunnel).toHaveBeenCalledTimes(61);
  });

  it("mesmo device em menos de 10 s: 204 e soma uma vez; 10 s depois soma de novo", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const ip = freshIp();
    const dev = U(20_001);
    expect((await send(dev, { open: 1 }, ip)).status).toBe(204);
    vi.setSystemTime(Date.now() + 9_000);
    expect((await send(dev, { open: 1 }, ip)).status).toBe(204);
    expect(h.recordFunnel).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 1_000);
    expect((await send(dev, { open: 1 }, ip)).status).toBe(204);
    expect(h.recordFunnel).toHaveBeenCalledTimes(2);
  });

  it("teto diário de 50 por device e contador: corta e depois descarta em silêncio", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const ip = freshIp();
    const dev = U(20_002);
    for (let i = 0; i < 4; i++) {
      expect((await send(dev, { buy_tap: 20 }, ip)).status).toBe(204);
      vi.setSystemTime(Date.now() + 10_000);
    }
    const summed = h.recordFunnel.mock.calls.map((c) => (c as unknown as [string, { counts: { buy_tap?: number } }])[1].counts.buy_tap);
    expect(summed).toEqual([20, 20, 10]);
  });

  it("lote vazio ou corpo inválido não soma nem gasta a vez", async () => {
    const ip = freshIp();
    const dev = U(20_003);
    expect((await send(dev, {}, ip)).status).toBe(204);
    const bad = await eventos.POST(post("/api/comunidade/forno/eventos", "não é json", { "x-forwarded-for": ip }), ctx("forno"));
    expect(bad.status).toBe(400);
    expect((await send(dev, { open: 1 }, ip)).status).toBe(204);
    expect(h.recordFunnel).toHaveBeenCalledTimes(1);
  });
});

describe("telao/codigo: 5 por hora por IP e slug", () => {
  const ask = async (slug: string, xff: string, secret: string) =>
    codigo.POST(post(`/api/comunidade/${slug}/telao/codigo`, JSON.stringify({ hash: await sha256Hex(secret) }), { "x-forwarded-for": xff }), ctx(slug));

  it("o 6º pedido do mesmo IP no mesmo restaurante é 429 sem tocar no banco; outro IP ou outro restaurante passa", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const ip = freshIp();
    for (let i = 0; i < 5; i++) {
      // Só o primeiro IP do x-forwarded-for conta (o resto são saltos da rede).
      const res = await ask("telao-a", `${ip}, 10.0.0.${i}`, `tv-a-${i}`);
      expect(res.status).toBe(200);
    }
    const lists = h.db.list.mock.calls.length;
    const sixth = await ask("telao-a", ip, "tv-a-5");
    expect(sixth.status).toBe(429);
    expect(await sixth.json()).toEqual({ ok: false, code: "too_many" });
    expect(sixth.headers.get("cache-control")).toBe("no-store");
    expect(h.db.list.mock.calls.length).toBe(lists);
    expect((await ask("telao-a", freshIp(), "tv-a-6")).status).toBe(200);
    expect((await ask("telao-b", ip, "tv-b-0")).status).toBe(200);
    // Uma hora depois do primeiro, cabe de novo.
    vi.setSystemTime(Date.now() + 60 * 60_000);
    expect((await ask("telao-a", ip, "tv-a-7")).status).toBe(200);
  });
});

describe("GET agregada", () => {
  const get = (slug: string, qs = "") => leitura.GET(new NextRequest(`http://localhost/api/comunidade/${slug}${qs}`), ctx(slug));

  it("erro do banco: 503 com 5 s de CDN, não no-store", async () => {
    h.getCommunityContent.mockRejectedValueOnce(new Error("nocodb GET: 500"));
    const res = await get("forno");
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=5");
  });

  it("?antes= só com o created_at de um post do Mural; senão 400 no-store", async () => {
    const head = h.headOf("forno") as CommunityHead;
    const created = new Date(Date.now() - 5 * 60_000).toISOString();
    const p: PostRow = {
      id: U(1),
      restaurant_id: head.id,
      item_id: U(2),
      photo_path: "/f.webp",
      thumb_path: "/t.webp",
      source: "house",
      status: "approved",
      on_tv: false,
      hidden_at: null,
      created_at: created,
    };
    h.getCommunityContent.mockResolvedValue({ polls: [], posts: [p], tvs: [] });
    const ok = await get("forno", `?antes=${encodeURIComponent(created)}`);
    expect(ok.status).toBe(200);
    const bad = await get("forno", `?antes=${encodeURIComponent(new Date(Date.now() - 6 * 60_000).toISOString())}`);
    expect(bad.status).toBe(400);
    expect(bad.headers.get("cache-control")).toBe("no-store");
    h.getCommunityContent.mockResolvedValue({ polls: [], posts: [], tvs: [] });
  });

  it("slug inexistente: 404 com 60 s de CDN", async () => {
    const res = await get("nada");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60");
  });
});
