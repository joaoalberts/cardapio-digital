// Portão do funil (/eventos), em memória e por instância (melhor esforço): o device é
// forjável e a rota é anônima, então o que passa daqui é limitado antes de somar.
// 1. No máximo 60 lotes por minuto por IP (todos os devices daquela rede juntos).
// 2. No máximo 1 lote a cada 10 s por device e restaurante.
// 3. Teto diário de 50 por device, restaurante e contador; o que passa é cortado.
// O que não passa é descartado em silêncio (a rota responde 204 do mesmo jeito).
import type { FunnelBatch } from "./funnel";
import { createLimiter } from "./limiter";

export const EVENT_DEVICE_GAP_MS = 10_000;
export const EVENTS_PER_IP_PER_MIN = 60;
export const EVENT_DAILY_CAP = 50;
const DAY_MS = 24 * 60 * 60_000;
const SWEEP_MS = 60 * 60_000;
const DAILY_MAX_KEYS = 20_000;

type Counts = FunnelBatch["e"];
type CountKey = keyof Counts;

export type EventGate = {
  // O que pode ser somado deste lote (cortado pelo teto diário), ou null se nada passa.
  admit(slug: string, device: string, ip: string, e: Counts): Counts | null;
};

export function createEventGate(now: () => number = () => Date.now()): EventGate {
  const perIp = createLimiter({ max: EVENTS_PER_IP_PER_MIN, windowMs: 60_000, now });
  const perDevice = createLimiter({ max: 1, windowMs: EVENT_DEVICE_GAP_MS, now });
  // Quanto cada device já somou no dia dele (24 h a partir do primeiro lote aceito).
  const daily = new Map<string, { start: number; used: Counts }>();
  let lastSweep = now();

  const sweep = (t: number) => {
    for (const [k, d] of daily) if (t - d.start >= DAY_MS) daily.delete(k);
    lastSweep = t;
  };

  return {
    admit(slug, device, ip, e) {
      const keys = (Object.keys(e) as CountKey[]).filter((k) => (e[k] ?? 0) > 0);
      if (!keys.length) return null;
      if (!perIp.hit(ip)) return null;
      const key = `${slug}|${device}`;
      if (!perDevice.hit(key)) return null;

      const t = now();
      if (t - lastSweep >= SWEEP_MS) sweep(t);
      let d = daily.get(key);
      if (d && t - d.start >= DAY_MS) {
        daily.delete(key);
        d = undefined;
      }
      if (!d) {
        while (daily.size >= DAILY_MAX_KEYS) {
          const oldest = daily.keys().next();
          if (oldest.done) break;
          daily.delete(oldest.value);
        }
        d = { start: t, used: {} };
        daily.set(key, d);
      }

      const out: Counts = {};
      for (const k of keys) {
        const room = EVENT_DAILY_CAP - (d.used[k] ?? 0);
        const v = Math.min(e[k] ?? 0, room);
        if (v > 0) {
          out[k] = v;
          d.used[k] = (d.used[k] ?? 0) + v;
        }
      }
      return Object.keys(out).length ? out : null;
    },
  };
}

// Um portão por processo, no globalThis (molde do acumulador do funil).
const SHARED = Symbol.for("cardapio-digital.comunidade.eventos");
export function sharedEventGate(): EventGate {
  const g = globalThis as unknown as Record<symbol, EventGate | undefined>;
  return (g[SHARED] ??= createEventGate());
}
