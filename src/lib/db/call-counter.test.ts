// Contador de chamadas ao NocoDB (medição do orçamento): só existe com NOCODB_COUNT=1, e a
// leitura só sai pela rota do driver local.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const { countCall, readCalls, COUNTER_KEY } = await import("./call-counter");
const db = await import("./nocodb");
const rota = await import("@/app/api/arquivos-locais/[...path]/route");

const saved = { ...process.env };
const g = globalThis as Record<string, unknown>;

beforeEach(() => {
  delete g[COUNTER_KEY];
  delete process.env.NOCODB_COUNT;
});
afterEach(() => {
  process.env = { ...saved };
  delete g[COUNTER_KEY];
  vi.unstubAllGlobals();
});

describe("contador de chamadas", () => {
  it("sem NOCODB_COUNT não conta nem cria nada no globalThis", () => {
    countCall("GET", "community_votes");
    expect(COUNTER_KEY in g).toBe(false);
    expect(readCalls()).toBeNull();
  });

  it("só NOCODB_COUNT=1 liga (outros valores não)", () => {
    process.env.NOCODB_COUNT = "true";
    countCall("GET", "community_votes");
    expect(COUNTER_KEY in g).toBe(false);
    expect(readCalls()).toBeNull();
  });

  it("com NOCODB_COUNT=1 soma o total e por método + tabela", () => {
    process.env.NOCODB_COUNT = "1";
    countCall("GET", "community_votes");
    countCall("GET", "community_votes");
    countCall("POST", "community_tally");
    const c = readCalls();
    expect(c?.total).toBe(3);
    expect(c?.byKey).toEqual({ "GET community_votes": 2, "POST community_tally": 1 });
    expect(typeof c?.since).toBe("string");
  });

  it("readCalls devolve uma cópia (quem lê não mexe na conta)", () => {
    process.env.NOCODB_COUNT = "1";
    countCall("GET", "restaurants");
    const c = readCalls();
    if (!c) throw new Error("sem contador");
    c.total = 99;
    c.byKey["GET restaurants"] = 99;
    expect(readCalls()?.total).toBe(1);
    expect(readCalls()?.byKey["GET restaurants"]).toBe(1);
  });

  it("com NOCODB_COUNT=1 e nada contado ainda, lê zero", () => {
    process.env.NOCODB_COUNT = "1";
    expect(readCalls()).toMatchObject({ total: 0, byKey: {} });
  });
});

describe("nocodb.ts conta cada pedido HTTP ao NocoDB", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("meta + leitura + gravação, cada uma com o nome da tabela", async () => {
    process.env.NOCODB_COUNT = "1";
    process.env.NOCODB_API_TOKEN = "teste";
    const fetchStub = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/meta/bases/")) return ok({ list: [{ id: "t1", title: "community_votes", table_name: "community_votes" }] });
      if ((init?.method ?? "GET") === "GET") return ok({ list: [{ Id: 1, uid: "a" }], pageInfo: { isLastPage: true } });
      return ok([{ Id: 2 }]);
    });
    vi.stubGlobal("fetch", fetchStub);
    await db.list("community_votes", { poll_id: "x" });
    await db.insertOne("community_votes", { poll_id: "x" });
    const c = readCalls();
    // A lista de tabelas pode já estar em memória de outro teste; conta só o que foi pedido.
    expect(c?.total).toBe(fetchStub.mock.calls.length);
    expect(c?.byKey["GET community_votes"]).toBe(1);
    expect(c?.byKey["POST community_votes"]).toBe(1);
  });

  it("sem NOCODB_COUNT os pedidos saem e nada é contado", async () => {
    process.env.NOCODB_API_TOKEN = "teste";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/meta/bases/")
          ? ok({ list: [{ id: "t1", title: "community_votes", table_name: "community_votes" }] })
          : ok({ list: [], pageInfo: { isLastPage: true } }),
      ),
    );
    await db.list("community_votes", {});
    expect(COUNTER_KEY in g).toBe(false);
  });
});

describe("GET /api/arquivos-locais/_calls", () => {
  const get = () =>
    rota.GET(new NextRequest("http://localhost/api/arquivos-locais/_calls"), { params: Promise.resolve({ path: ["_calls"] }) });

  it("fora do driver local responde 404, mesmo com NOCODB_COUNT=1", async () => {
    process.env.NOCODB_COUNT = "1";
    delete process.env.STORAGE_DRIVER;
    countCall("GET", "restaurants");
    const r = await get();
    expect(r.status).toBe(404);
    expect(await r.text()).toBe("");
  });

  it("driver local sem NOCODB_COUNT responde 404", async () => {
    process.env.STORAGE_DRIVER = "local";
    const r = await get();
    expect(r.status).toBe(404);
  });

  it("driver local com NOCODB_COUNT=1 devolve a conta, sem cache", async () => {
    process.env.STORAGE_DRIVER = "local";
    process.env.NOCODB_COUNT = "1";
    countCall("GET", "restaurants");
    countCall("PATCH", "community_tvs");
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const j = await r.json();
    expect(j).toMatchObject({ total: 2, byKey: { "GET restaurants": 1, "PATCH community_tvs": 1 } });
  });

  it("_calls com mais pedaços no caminho continua 404", async () => {
    process.env.STORAGE_DRIVER = "local";
    process.env.NOCODB_COUNT = "1";
    const r = await rota.GET(new NextRequest("http://localhost/api/arquivos-locais/_calls/x"), {
      params: Promise.resolve({ path: ["_calls", "x"] }),
    });
    expect(r.status).toBe(404);
  });
});
