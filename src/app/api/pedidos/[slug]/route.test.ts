import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  createOrder: vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ ok: false, code: "invalid" })),
}));
vi.mock("@/lib/db/nocodb", () => ({}));
vi.mock("@/lib/menu/data", () => ({ getPublicMenu: vi.fn() }));
vi.mock("@/lib/orders/service", () => ({ createOrder: h.createOrder, listDeviceOrders: vi.fn(async () => []) }));

const route = await import("./route");
const post = (slug: string, ip: string) =>
  route.POST(
    new NextRequest(`http://localhost/api/pedidos/${slug}`, { method: "POST", headers: { "x-forwarded-for": ip }, body: "{}" }),
    { params: Promise.resolve({ slug }) },
  );

describe("POST /api/pedidos/[slug]: limite por IP e restaurante", () => {
  beforeEach(() => h.createOrder.mockClear());

  it("o 61º pedido do mesmo IP no mesmo restaurante leva 429 too_many, sem chegar ao serviço", async () => {
    for (let i = 0; i < 60; i++) expect((await post("limite-a", "10.0.0.1")).status).toBe(400);
    const res = await post("limite-a", "10.0.0.1");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, code: "too_many" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.createOrder).toHaveBeenCalledTimes(60);
  });

  it("outro IP ou outro restaurante não é afetado", async () => {
    for (let i = 0; i < 61; i++) await post("limite-b", "10.0.0.2");
    expect((await post("limite-b", "10.0.0.3")).status).toBe(400);
    expect((await post("limite-c", "10.0.0.2")).status).toBe(400);
  });
});
