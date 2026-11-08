import { describe, expect, it } from "vitest";
import { CSP_REPORT_ONLY, PROTECTED_PATHS, securityHeaders } from "./security-headers";

const rules = securityHeaders();
const valueOf = (r: { headers: { key: string; value: string }[] }, key: string) => r.headers.find((h) => h.key === key)?.value;

describe("securityHeaders", () => {
  it("painel e telas de entrada: DENY e frame-ancestors 'none'", () => {
    for (const path of ["/painel/:path*", "/entrar", "/cadastro"]) expect(PROTECTED_PATHS).toContain(path);
    for (const source of PROTECTED_PATHS) {
      const r = rules.find((x) => x.source === source)!;
      expect(valueOf(r, "X-Frame-Options")).toBe("DENY");
      expect(valueOf(r, "Content-Security-Policy")).toBe("frame-ancestors 'none'");
    }
  });

  it("o cardápio público continua embutível: nenhuma regra geral traz X-Frame-Options nem CSP que bloqueie", () => {
    const all = rules.find((x) => x.source === "/:path*")!;
    expect(valueOf(all, "X-Frame-Options")).toBeUndefined();
    expect(valueOf(all, "Content-Security-Policy")).toBeUndefined();
    expect(valueOf(all, "Content-Security-Policy-Report-Only")).toBe(CSP_REPORT_ONLY);
    expect(valueOf(all, "X-Content-Type-Options")).toBe("nosniff");
    expect(valueOf(all, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    // O /[slug] não está entre as rotas protegidas.
    expect(PROTECTED_PATHS.some((p) => p.startsWith("/:slug") || p === "/:path*")).toBe(false);
  });

  it("a política só de relatório lista Blob e Mux", () => {
    expect(CSP_REPORT_ONLY).toContain("https://*.public.blob.vercel-storage.com");
    expect(CSP_REPORT_ONLY).toContain("https://stream.mux.com");
    expect(CSP_REPORT_ONLY).toContain("https://image.mux.com");
    expect(CSP_REPORT_ONLY).not.toContain("frame-ancestors");
  });
});
