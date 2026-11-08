import { describe, expect, it } from "vitest";
import { matchesSignature } from "./upload-sniff";

const b = (...v: number[]) => new Uint8Array([...v, ...new Array(16).fill(0)]);
const text = (s: string) => new TextEncoder().encode(s.padEnd(16, " "));
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0]);
const mp4 = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);

describe("matchesSignature", () => {
  it("aceita o arquivo certo de cada tipo", () => {
    expect(matchesSignature(b(0x89, 0x50, 0x4e, 0x47), "image/png")).toBe(true);
    expect(matchesSignature(b(0xff, 0xd8, 0xff, 0xe0), "image/jpeg")).toBe(true);
    expect(matchesSignature(webp, "image/webp")).toBe(true);
    expect(matchesSignature(mp4, "video/mp4")).toBe(true);
    expect(matchesSignature(mp4, "video/quicktime")).toBe(true);
    expect(matchesSignature(b(0x1a, 0x45, 0xdf, 0xa3), "video/webm")).toBe(true);
  });

  it("recusa tipo declarado diferente dos bytes", () => {
    expect(matchesSignature(b(0x89, 0x50, 0x4e, 0x47), "image/jpeg")).toBe(false);
    expect(matchesSignature(webp, "image/png")).toBe(false);
    expect(matchesSignature(mp4, "video/webm")).toBe(false);
    expect(matchesSignature(b(0xff, 0xd8, 0xff), "video/mp4")).toBe(false);
  });

  it("WebP exige RIFF e WEBP; RIFF de outro tipo (WAVE) não passa", () => {
    const wav = new Uint8Array(webp);
    wav.set([0x57, 0x41, 0x56, 0x45], 8);
    expect(matchesSignature(wav, "image/webp")).toBe(false);
  });

  it("recusa SVG, HTML e XML, mesmo declarados como imagem", () => {
    for (const s of ["<svg xmlns=", "<!DOCTYPE html>", "<?xml version", "<script>alert(1)"]) {
      for (const t of ["image/png", "image/jpeg", "image/webp", "video/mp4"]) expect(matchesSignature(text(s), t)).toBe(false);
    }
  });

  it("recusa vazio, curto e tipo desconhecido", () => {
    expect(matchesSignature(new Uint8Array(), "image/png")).toBe(false);
    expect(matchesSignature(new Uint8Array([0x89, 0x50]), "image/png")).toBe(false);
    expect(matchesSignature(b(0x89, 0x50, 0x4e, 0x47), "image/svg+xml")).toBe(false);
  });
});
