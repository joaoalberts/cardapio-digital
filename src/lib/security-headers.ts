// Cabeçalhos de segurança (usados em next.config.ts).
// Painel e telas de entrada: ninguém embute (clickjacking). O cardápio público NÃO leva
// X-Frame-Options: a prévia da Aparência o abre num iframe do mesmo site.
export const PROTECTED_PATHS = ["/painel/:path*", "/entrar", "/cadastro", "/esqueci-senha", "/nova-senha"];

// Só relatório: nada é bloqueado, o navegador apenas avisa no console. As fontes são o que o
// app carrega de fato: o próprio site, fotos no Blob (e Supabase antigo), vídeo e capa no Mux,
// envio direto de vídeo ao Mux e as fontes do next/font (que já saem do próprio site).
export const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com https://*.supabase.co https://image.mux.com https://*.mux.com",
  "media-src 'self' blob: https://stream.mux.com https://*.mux.com https://*.public.blob.vercel-storage.com",
  "connect-src 'self' https://*.public.blob.vercel-storage.com https://stream.mux.com https://*.mux.com https://storage.googleapis.com",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export type HeaderRule = { source: string; headers: { key: string; value: string }[] };

export function securityHeaders(): HeaderRule[] {
  return [
    {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
      ],
    },
    ...PROTECTED_PATHS.map((source) => ({
      source,
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      ],
    })),
  ];
}
