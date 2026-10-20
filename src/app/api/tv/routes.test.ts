// Rotas públicas da TV (código e estado) e do pedido de ponta a ponta, com o banco e as
// leituras em cache falsos: prova que cada rota usa o corte de corpo em fluxo e os limites em memória.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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
  // Cada slug (menos "nada") é um restaurante sem horário.
  const ids = new Map<string, string>();
  const headOf = (slug: string) => {
    if (!ids.has(slug)) ids.set(slug, `00000000-0000-4000-8000-${String(ids.size + 1).padStart(12, "0")}`);
    return {
      id: ids.get(slug) as string,
      slug,
      name: slug,
      timezone: "America/Sao_Paulo",
      opening_hours: null,
      instagram: null,
      logo_path: null,
      brand_color: null,
      tv_simple: false,
    };
  };
  return {
    store,
    db,
    headOf,
    getTvHead: vi.fn(async (slug: string) => (slug === "nada" ? null : headOf(slug))),
    getPublicMenu: vi.fn(async () => null),
  };
});

vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  // Fora de um pedido do Next, after() roda na hora.
  after: (task: unknown) => (typeof task === "function" ? task() : task),
}));
vi.mock("@/lib/db/nocodb", () => h.db);
vi.mock("@/lib/tv/server", () => ({ getTvHead: h.getTvHead }));
// O pedido lê o cardápio pelo data.ts (só do servidor, com cache do Next): aqui, nenhum.
vi.mock("@/lib/menu/data", () => ({ getPublicMenu: h.getPublicMenu }));

const codigo = await import("@/app/api/tv/[slug]/codigo/route");
const estado = await import("@/app/api/tv/[slug]/estado/route");
const pedidos = await import("@/app/api/pedidos/[slug]/route");
const { sha256Hex } = await import("@/lib/tv/pair");

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
  for (const f of Object.values(h.db)) f.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("corpo lido em fluxo, com teto, em todas as rotas POST", () => {
  // [nome, rota, URL, pedaços de 1 KB que bastam para passar do teto da rota]
  const routes: [string, Handler, string, number][] = [
    ["tv/codigo", codigo.POST, "/api/tv/forno/codigo", 10],
    ["tv/estado", estado.POST, "/api/tv/forno/estado", 10],
    // Pedido: teto de 20.000 bytes, cerca de 20 pedaços.
    ["pedidos", pedidos.POST, "/api/pedidos/forno", 25],
  ];
  for (const [name, handler, url, chunks] of routes) {
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
      expect(made).toBeLessThan(chunks);
      expect(h.db.list).not.toHaveBeenCalled();
      expect(h.db.insertOne).not.toHaveBeenCalled();
    });
  }
});

describe("pedidos: corpo com teto de 20.000 bytes, lido em fluxo", () => {
  const send = (body: BodyInit | null, headers: Record<string, string> = {}) => pedidos.POST(post("/api/pedidos/forno", body, headers), ctx("forno"));

  it("content-length acima do teto: 413 antes de ler o corpo", async () => {
    const res = await send("{}", { "content-length": "20001" });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ ok: false, code: "invalid" });
    expect(h.getPublicMenu).not.toHaveBeenCalled();
  });

  it("corpo no teto passa adiante; texto que não é JSON vira pedido inválido (400)", async () => {
    h.getPublicMenu.mockClear();
    // Pedido válido com observações longas (cada uma até 1.000 letras), perto do teto.
    const lines = Array.from({ length: 18 }, (_, i) => ({ item: U(100 + i), qty: 1, note: "a".repeat(1_000) }));
    const order = JSON.stringify({ mesa: "4VEUC7", device: U(98), ref: U(99), lines });
    expect(order.length).toBeGreaterThan(18_000);
    expect(order.length).toBeLessThanOrEqual(20_000);
    const res = await send(order);
    // Sem cardápio (mock), o serviço responde not_found: chegou até ele.
    expect(res.status).toBe(404);
    expect(h.getPublicMenu).toHaveBeenCalled();
    const bad = await send("{nao é json");
    expect(bad.status).toBe(400);
    expect(bad.headers.get("cache-control")).toBe("no-store");
  });

  it("acentos contam em bytes: 10.001 letras 'ã' (20.002 bytes) passam do teto", async () => {
    const res = await send(JSON.stringify({ note: "ã".repeat(10_001) }));
    expect(res.status).toBe(413);
  });
});

describe("tv/codigo: 5 por hora por IP e slug", () => {
  const ask = async (slug: string, xff: string, secret: string) =>
    codigo.POST(post(`/api/tv/${slug}/codigo`, JSON.stringify({ hash: await sha256Hex(secret) }), { "x-forwarded-for": xff }), ctx(slug));

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

  it("só gasta o limite quando cria um código novo: a mesma TV pedindo de novo (recarga) não conta", async () => {
    const ip = freshIp();
    const first = await ask("telao-c", ip, "tv-c-0");
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body).toMatchObject({ ok: true, created: true });
    for (let i = 0; i < 8; i++) {
      const again = await ask("telao-c", ip, "tv-c-0");
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual({ ...body, created: false });
    }
    // 1 código criado até aqui: cabem mais 4 TVs novas deste IP; a 5ª nova é 429.
    for (let i = 1; i <= 4; i++) expect((await ask("telao-c", ip, `tv-c-${i}`)).status).toBe(200);
    expect((await ask("telao-c", ip, "tv-c-5")).status).toBe(429);
  });

  it("pedido recusado (hash inválido ou teto de códigos vivos do restaurante) não gasta o limite", async () => {
    const ip = freshIp();
    const bad = await codigo.POST(
      post("/api/tv/telao-d/codigo", JSON.stringify({ hash: "nao-e-hash" }), { "x-forwarded-for": ip }),
      ctx("telao-d"),
    );
    expect(bad.status).toBe(400);
    // Restaurante com 20 códigos vivos de outras TVs: too_many, sem gastar o limite do IP.
    const head = h.headOf("telao-e");
    const later = new Date(Date.now() + 5 * 60_000).toISOString();
    for (let i = 0; i < 20; i++) {
      await h.db.insertOne("community_tvs", {
        restaurant_id: head.id,
        secret_hash: String(i).padStart(64, "e"),
        pair_code: `LV${"ABCDEFGHJKLMNPQRSTUVWXYZ"[i]}222`,
        pair_expires_at: later,
        revoked: false,
      });
    }
    for (let i = 0; i < 6; i++) expect((await ask("telao-e", ip, `tv-e-${i}`)).status).toBe(429);
    h.store.community_tvs = (h.store.community_tvs ?? []).filter((r) => r.restaurant_id !== head.id);
    // Os 6 recusados não contaram: este IP ainda tem os 5 códigos da hora.
    for (let i = 0; i < 5; i++) expect((await ask("telao-e", ip, `tv-e-ok-${i}`)).status).toBe(200);
    expect((await ask("telao-e", ip, "tv-e-ok-5")).status).toBe(429);
  });
});
