// Preços do Mux conferidos em 16/10/2026 (plano Pay as you go, primeira faixa de volume).
// Fonte: https://www.mux.com/docs/pricing/video (também https://www.mux.com/pricing e
// https://www.mux.com/docs/guides/enable-static-mp4-renditions). Detalhes: docs/superpowers/specs/2026-10-16-apareca-conta-mux.md.
export const MUX_PRICES = {
  source: "https://www.mux.com/docs/pricing/video (conferido em 16/10/2026; também mux.com/pricing)",
  checked_at: "2026-10-16",
  encode_basic_per_min: 0, // codificação basic é grátis
  storage_per_min_month: 0.003, // basic 1080p (pior caso; até 720p é 0,0024); mínimo de 1 mês por asset
  delivery_per_min: 0.001, // basic 1080p por minuto assistido
  // Fatia do Apareça nos 100 mil min grátis por mês (o resto fica para os vídeos de prato).
  delivery_free_min: 60_000,
  mp4_storage_per_min_month: 0.00075, // MP4 "highest": a doc diverge; contamos o pior caso
};

// Minutos "asset-mês" e segundos medidos no mês. Entrega = played_s (clientes, moderação e downloads
// do MP4, que quem chama deve somar) + house_min (minutos dos institucionais exibidos em loop).
export type MonthUsage = { encoded_s: number; stored_min_month: number; played_s: number; mp4_s: number; house_min: number };

const nn = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export function estimateUsd(u: MonthUsage, p: typeof MUX_PRICES = MUX_PRICES): number {
  const encodedMin = nn(u.encoded_s) / 60;
  // Basic cobra no mínimo 1 mês por asset: todo minuto codificado no mês paga 1 mês cheio,
  // mesmo que o vídeo seja apagado em 6 h. Os institucionais (guardados o mês todo) entram em stored_min_month.
  const storedMin = Math.max(nn(u.stored_min_month), encodedMin);
  const mp4Min = nn(u.mp4_s) / 60;
  const deliveredMin = nn(u.played_s) / 60 + nn(u.house_min);
  const billableDelivery = Math.max(0, deliveredMin - p.delivery_free_min);
  return (
    encodedMin * p.encode_basic_per_min +
    storedMin * p.storage_per_min_month +
    mp4Min * p.mp4_storage_per_min_month +
    billableDelivery * p.delivery_per_min
  );
}

// Teto inválido (<= 0) pausa: melhor parar que gastar sem limite.
export function uploadGate(usd: number, tetoUsd: number): "ok" | "warn" | "paused" {
  if (!(tetoUsd > 0)) return "paused";
  if (usd >= tetoUsd * 0.9) return "paused";
  if (usd >= tetoUsd * 0.75) return "warn";
  return "ok";
}

// APARECA_TETO_USD; vazio, inválido ou <= 0 = 15 (decisão do João em 16/10). Só ponto decimal.
export function tetoUsd(env?: string): number {
  const n = env && /^\d+(\.\d+)?$/.test(env.trim()) ? Number(env) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : 15;
}
