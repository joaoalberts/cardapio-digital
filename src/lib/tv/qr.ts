// QR do telão: o endereço mais curto possível (esquema, host e slug) e correção de erro L.
// Com menos módulos, cada quadradinho fica maior na TV, e a câmera lê de mais longe. O QR fica sobre fundo liso, sem logo
// no meio, então a correção L basta.
export const QR_ECC = "L" as const;

// proto e host vêm dos cabeçalhos do proxy (x-forwarded-*), que podem trazer uma lista
// ("a, b"): vale o primeiro. Host em minúsculas e sem a porta padrão do esquema.
export function qrLink(proto: string, host: string, slug: string): string {
  const p = (proto.split(",")[0] ?? "").trim().toLowerCase() === "http" ? "http" : "https";
  let h = (host.split(",")[0] ?? "").trim().toLowerCase();
  if ((p === "https" && h.endsWith(":443")) || (p === "http" && h.endsWith(":80"))) h = h.slice(0, h.lastIndexOf(":"));
  const path = `/${slug}`;
  return h ? `${p}://${h}${path}` : path;
}
