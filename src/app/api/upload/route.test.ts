import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ putFile: vi.fn(async () => "https://x.public.blob.vercel-storage.com/a") }));
vi.mock("@/lib/auth", () => ({ isMember: async () => true }));
vi.mock("@/lib/storage", () => ({ putFile: h.putFile, storageEnabled: () => true }));

const route = await import("./route");
const post = (type: string, body: Uint8Array | string, name = "items/a.png") =>
  route.POST(
    new NextRequest(`http://localhost/api/upload?restaurant=r1&name=${name}`, { method: "POST", headers: { "content-type": type }, body: body as BodyInit }),
  );
const pad = (...v: number[]) => new Uint8Array([...v, ...new Array(32).fill(0)]);

describe("POST /api/upload: assinatura dos bytes", () => {
  beforeEach(() => h.putFile.mockClear());

  it("PNG de verdade passa e vai para o Blob", async () => {
    const res = await post("image/png", pad(0x89, 0x50, 0x4e, 0x47));
    expect(res.status).toBe(200);
    expect(h.putFile).toHaveBeenCalledTimes(1);
  });

  it("SVG ou HTML disfarçado de PNG: 400, nada gravado", async () => {
    for (const body of ['<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>', "<html><script>1</script></html>"]) {
      const res = await post("image/png", body);
      expect(res.status).toBe(400);
    }
    expect(h.putFile).not.toHaveBeenCalled();
  });

  it("JPEG declarado como PNG: 400", async () => {
    expect((await post("image/png", pad(0xff, 0xd8, 0xff))).status).toBe(400);
    expect(h.putFile).not.toHaveBeenCalled();
  });

  it("MP4 sem ftyp: 400; com ftyp: 200", async () => {
    expect((await post("video/mp4", pad(0, 0, 0, 0x20, 0x61, 0x62, 0x63, 0x64), "items/a.mp4")).status).toBe(400);
    expect((await post("video/mp4", pad(0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70), "items/a.mp4")).status).toBe(200);
  });
});
