import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// O módulo guarda estado (ids das tabelas, pedidos do último segundo) e lê o ambiente ao
// carregar; cada teste carrega uma cópia nova.
async function load() {
  vi.resetModules();
  return import("./nocodb");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// NocoDB falso com a tabela "items": devolve no máximo `maxPage` linhas por página, mesmo
// que o pedido peça mais, como um servidor com teto de página menor que o nosso.
function fakeNocodb(total: number, maxPage = 100) {
  const rows = Array.from({ length: total }, (_, i) => ({ Id: i + 1, uid: `u${i + 1}`, name: `Item ${i + 1}` }));
  const calls: URL[] = [];
  vi.stubGlobal("fetch", async (input: string) => {
    const url = new URL(input);
    calls.push(url);
    if (url.pathname === "/api/v2/meta/bases/base-teste/tables") {
      return json({ list: [{ id: "tbl_items", title: "items", table_name: "items" }] });
    }
    if (url.pathname === "/api/v2/tables/tbl_items/records/count") return json({ count: total });
    if (url.pathname === "/api/v2/tables/tbl_items/records") {
      const offset = Number(url.searchParams.get("offset"));
      const pageSize = Math.min(Number(url.searchParams.get("limit")), maxPage);
      const list = rows.slice(offset, offset + pageSize);
      return json({
        list,
        pageInfo: {
          totalRows: total,
          page: Math.floor(offset / pageSize) + 1,
          pageSize,
          isFirstPage: offset === 0,
          isLastPage: offset + list.length >= total,
        },
      });
    }
    return json({ msg: "não encontrado" }, 404);
  });
  return {
    calls,
    offsets: () => calls.filter((u) => u.pathname.endsWith("/records")).map((u) => Number(u.searchParams.get("offset"))),
  };
}

beforeEach(() => {
  vi.stubEnv("NOCODB_URL", "http://nocodb.test");
  vi.stubEnv("NOCODB_BASE_ID", "base-teste");
  vi.stubEnv("NOCODB_API_TOKEN", "token-teste");
  vi.stubEnv("NOCODB_MAX_RPS", undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("list", () => {
  it("segue as páginas pelo que o servidor devolveu até isLastPage", async () => {
    const server = fakeNocodb(250);
    const db = await load();

    const rows = await db.list<{ Id: number; id: string }>("items");

    expect(rows.map((r) => r.Id)).toEqual(Array.from({ length: 250 }, (_, i) => i + 1));
    expect(rows[249].id).toBe("u250");
    expect(server.offsets()).toEqual([0, 100, 200]);
  });

  it("para no limit mesmo com páginas menores que o pedido", async () => {
    const server = fakeNocodb(250);
    const db = await load();

    const rows = await db.list<{ Id: number }>("items", {}, { limit: 120 });

    expect(rows.map((r) => r.Id)).toEqual(Array.from({ length: 120 }, (_, i) => i + 1));
    expect(server.offsets()).toEqual([0, 100]);
  });
});

describe("ritmo dos pedidos", () => {
  it("sem NOCODB_MAX_RPS, manda 4 por segundo e a 5ª chamada espera ~1 s", async () => {
    const server = fakeNocodb(1);
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const db = await load();

    // 1 pedido das tabelas + 4 contagens = 5 chamadas.
    const pending = Promise.all(Array.from({ length: 4 }, () => db.count("items", {})));
    await vi.advanceTimersByTimeAsync(0);
    expect(server.calls).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(990);
    expect(server.calls).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(20);
    expect(server.calls).toHaveLength(5);
    await expect(pending).resolves.toEqual([1, 1, 1, 1]);
  });

  it("com NOCODB_MAX_RPS=20, 20 chamadas saem no mesmo segundo e a 21ª espera", async () => {
    vi.stubEnv("NOCODB_MAX_RPS", "20");
    const server = fakeNocodb(1);
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const db = await load();

    // 1 pedido das tabelas + 20 contagens = 21 chamadas.
    const pending = Promise.all(Array.from({ length: 20 }, () => db.count("items", {})));
    await vi.advanceTimersByTimeAsync(0);
    expect(server.calls).toHaveLength(20);
    await vi.advanceTimersByTimeAsync(1010);
    expect(server.calls).toHaveLength(21);
    await expect(pending).resolves.toHaveLength(20);
  });
});
