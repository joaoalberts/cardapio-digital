// Senha do cron da Vercel: "authorization: Bearer <CRON_SECRET>". Sem CRON_SECRET no ambiente, a rota
// nunca roda aberta. Compara os resumos SHA-256 em tempo constante.
import { createHash, timingSafeEqual } from "node:crypto";

export function cronAuth(header: string | null, secret: string | undefined): "ok" | "no_secret" | "denied" {
  if (!secret || !secret.trim()) return "no_secret";
  if (typeof header !== "string") return "denied";
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`)) ? "ok" : "denied";
}
