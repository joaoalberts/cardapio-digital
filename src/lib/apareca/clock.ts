// Relógio padrão do Apareça no servidor (store.ts e submit.ts, quando ninguém injeta outro).
// Só para a verificação ponta a ponta (scripts/apareca/e2e.mjs): APARECA_NOW_OFFSET_MS adianta
// o relógio para testar o vencimento sem esperar horas. A variável só vale com STORAGE_DRIVER=local,
// que é o driver de teste local e Docker (storage.ts); na Vercel (Blob) ela é ignorada.

type Env = Record<string, string | undefined>;

const MAX_OFFSET_MS = 30 * 24 * 3_600_000; // 30 dias: além disso é engano de digitação

/** Quanto o relógio do Apareça anda à frente: 0 fora do driver local ou com valor torto. */
export function nowOffsetMs(env: Env = process.env): number {
  if (env.STORAGE_DRIVER !== "local") return 0;
  const raw = env.APARECA_NOW_OFFSET_MS?.trim();
  if (!raw || !/^-?\d+$/.test(raw)) return 0;
  const n = Number(raw);
  return Number.isSafeInteger(n) && Math.abs(n) <= MAX_OFFSET_MS ? n : 0;
}

/** Agora, para o Apareça. Igual a new Date() em produção. */
export function serverNow(env: Env = process.env, base: number = Date.now()): Date {
  return new Date(base + nowOffsetMs(env));
}
