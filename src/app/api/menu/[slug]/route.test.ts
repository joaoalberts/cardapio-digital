import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getPublicMenu: vi.fn<(slug: string, lang?: string) => Promise<unknown>>(async () => ({ ok: 1 })) }));
vi.mock("@/lib/menu/data", () => ({ getPublicMenu: h.getPublicMenu }));

const route = await import("./route");
const call = (qs: string) =>
  route.GET(new NextRequest(`http://localhost/api/menu/forno${qs}`), { params: Promise.resolve({ slug: "forno" }) });

describe("GET /api/menu/[slug]", () => {
  beforeEach(() => h.getPublicMenu.mockClear());

  it("aceita os 6 idiomas do sistema e o padrão pt-BR", async () => {
    for (const lang of ["pt-BR", "en", "es", "fr", "it", "de"]) {
      expect((await call(`?lang=${lang}`)).status).toBe(200);
    }
    expect((await call("")).status).toBe(200);
  });

  it("idioma de formato válido mas fora da lista: 404 sem ir ao banco", async () => {
    for (const lang of ["ja", "zh-CN", "pt-PT", "EN", "pt-br"]) {
      expect((await call(`?lang=${lang}`)).status).toBe(404);
    }
    expect(h.getPublicMenu).not.toHaveBeenCalled();
  });

  it("formato inválido continua 404", async () => {
    expect((await call("?lang=../../x")).status).toBe(404);
  });
});
