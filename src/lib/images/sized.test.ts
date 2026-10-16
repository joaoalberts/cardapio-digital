import { describe, expect, it } from "vitest";
import { blobHostFromToken, imgHostAllowed, parseImgQuery, sizedSrc } from "./sized";

const BLOB = "https://abc123xyz.public.blob.vercel-storage.com/r1/items/1.webp";
const SUPA = "https://proj.supabase.co/storage/v1/object/public/media/r1/items/1.jpg";

describe("sizedSrc", () => {
  it("foto do Blob ou do Supabase passa pela rota que reduz", () => {
    expect(sizedSrc(BLOB, 480)).toBe(`/api/img?w=480&u=${encodeURIComponent(BLOB)}`);
    expect(sizedSrc(SUPA, 1080)).toBe(`/api/img?w=1080&u=${encodeURIComponent(SUPA)}`);
  });
  it("arredonda a largura para cima, para um dos tamanhos fixos (o cache se repete)", () => {
    expect(sizedSrc(BLOB, 300)).toContain("w=480");
    expect(sizedSrc(BLOB, 100)).toContain("w=240");
    expect(sizedSrc(BLOB, 1200)).toContain("w=1440");
    expect(sizedSrc(BLOB, 5000)).toContain("w=1440");
  });
  it("capa do Mux usa o tamanho do próprio Mux", () => {
    expect(sizedSrc("https://image.mux.com/abc/thumbnail.jpg", 480)).toBe("https://image.mux.com/abc/thumbnail.jpg?width=480");
    expect(sizedSrc("https://image.mux.com/abc/thumbnail.jpg?time=2", 240)).toBe("https://image.mux.com/abc/thumbnail.jpg?time=2&width=240");
  });
  it("arquivo local, vazio ou de outro site fica como está", () => {
    expect(sizedSrc("/demo/x.jpg", 480)).toBe("/demo/x.jpg");
    expect(sizedSrc(null, 480)).toBeNull();
    expect(sizedSrc("https://exemplo.com/a.jpg", 480)).toBe("https://exemplo.com/a.jpg");
  });
});

describe("hosts aceitos pela rota", () => {
  const env = { blobToken: "vercel_blob_rw_ABC123xyz_segredo", supabaseUrl: "https://proj.supabase.co" };
  it("o store do Blob vem do token", () => {
    expect(blobHostFromToken(env.blobToken)).toBe("abc123xyz.public.blob.vercel-storage.com");
    expect(blobHostFromToken(undefined)).toBeNull();
    expect(blobHostFromToken("lixo")).toBeNull();
  });
  it("aceita só o Blob do app e o Supabase antigo", () => {
    expect(imgHostAllowed(new URL(BLOB), env)).toBe(true);
    expect(imgHostAllowed(new URL(SUPA), env)).toBe(true);
    expect(imgHostAllowed(new URL("https://outro.public.blob.vercel-storage.com/a.jpg"), env)).toBe(false);
    expect(imgHostAllowed(new URL("https://169.254.169.254/latest"), env)).toBe(false);
    expect(imgHostAllowed(new URL("http://abc123xyz.public.blob.vercel-storage.com/a.jpg"), env)).toBe(false);
  });
  it("IMG_HOSTS libera hosts a mais (cópia local sem o token do Blob)", () => {
    const local = { extraHosts: "proj.supabase.co, abc123xyz.public.blob.vercel-storage.com" };
    expect(imgHostAllowed(new URL(BLOB), local)).toBe(true);
    expect(imgHostAllowed(new URL(SUPA), local)).toBe(true);
    expect(imgHostAllowed(new URL("https://outro.supabase.co/x"), local)).toBe(false);
  });
});

describe("parseImgQuery", () => {
  it("só larguras da lista e URL https", () => {
    expect(parseImgQuery(new URLSearchParams({ w: "480", u: BLOB }))).toEqual({ w: 480, url: new URL(BLOB) });
    expect(parseImgQuery(new URLSearchParams({ w: "500", u: BLOB }))).toBeNull();
    expect(parseImgQuery(new URLSearchParams({ w: "480", u: "nada" }))).toBeNull();
    expect(parseImgQuery(new URLSearchParams({ w: "480" }))).toBeNull();
  });
});
