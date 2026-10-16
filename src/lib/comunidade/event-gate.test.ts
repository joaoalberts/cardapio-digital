import { describe, expect, it } from "vitest";
import {
  EVENTS_PER_IP_PER_MIN,
  EVENT_DAILY_CAP,
  EVENT_DEVICE_GAP_MS,
  createEventGate,
  sharedEventGate,
} from "./event-gate";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DEV = U(1);
const IP = "203.0.113.7";
const SEC = 1_000;
const DAY = 24 * 60 * 60 * SEC;

function setup() {
  let t = 5_000_000;
  const gate = createEventGate(() => t);
  return { gate, add: (ms: number) => (t += ms) };
}

describe("createEventGate", () => {
  it("constantes do lote de segurança", () => {
    expect(EVENT_DEVICE_GAP_MS).toBe(10 * SEC);
    expect(EVENTS_PER_IP_PER_MIN).toBe(60);
    expect(EVENT_DAILY_CAP).toBe(50);
  });

  it("1 lote a cada 10 s por device e slug; outro slug conta separado", () => {
    const s = setup();
    expect(s.gate.admit("forno", DEV, IP, { open: 1 })).toEqual({ open: 1 });
    s.add(9_999);
    expect(s.gate.admit("forno", DEV, IP, { open: 1 })).toBeNull();
    expect(s.gate.admit("outro", DEV, IP, { open: 1 })).toEqual({ open: 1 });
    s.add(1);
    expect(s.gate.admit("forno", DEV, IP, { open: 1 })).toEqual({ open: 1 });
  });

  it("60 lotes por minuto por IP, somando todos os devices; outro IP conta separado", () => {
    const s = setup();
    for (let i = 0; i < 60; i++) expect(s.gate.admit("forno", U(100 + i), IP, { open: 1 })).toEqual({ open: 1 });
    expect(s.gate.admit("forno", U(500), IP, { open: 1 })).toBeNull();
    expect(s.gate.admit("outro", U(501), IP, { open: 1 })).toBeNull();
    expect(s.gate.admit("forno", U(502), "198.51.100.9", { open: 1 })).toEqual({ open: 1 });
    s.add(60 * SEC);
    expect(s.gate.admit("forno", U(503), IP, { open: 1 })).toEqual({ open: 1 });
  });

  it("lote recusado pelo IP não gasta a vez do device", () => {
    const s = setup();
    for (let i = 0; i < 60; i++) s.gate.admit("forno", U(100 + i), IP, { open: 1 });
    expect(s.gate.admit("forno", DEV, IP, { open: 1 })).toBeNull();
    // O mesmo device, logo depois, por outra rede: passa (a vez dele não foi gasta).
    expect(s.gate.admit("forno", DEV, "198.51.100.9", { open: 1 })).toEqual({ open: 1 });
  });

  it("teto diário de 50 por device e contador: corta o que passa e depois descarta", () => {
    const s = setup();
    expect(s.gate.admit("forno", DEV, IP, { open: 20, share: 2 })).toEqual({ open: 20, share: 2 });
    s.add(10 * SEC);
    expect(s.gate.admit("forno", DEV, IP, { open: 20 })).toEqual({ open: 20 });
    s.add(10 * SEC);
    expect(s.gate.admit("forno", DEV, IP, { open: 20, share: 3 })).toEqual({ open: 10, share: 3 });
    s.add(10 * SEC);
    // open esgotado: o lote só com open não soma nada.
    expect(s.gate.admit("forno", DEV, IP, { open: 5 })).toBeNull();
    s.add(10 * SEC);
    // Os outros contadores seguem.
    expect(s.gate.admit("forno", DEV, IP, { open: 5, buy_tap: 1 })).toEqual({ buy_tap: 1 });
    // Outro device no mesmo restaurante tem o próprio teto.
    expect(s.gate.admit("forno", U(2), IP, { open: 20 })).toEqual({ open: 20 });
  });

  it("o teto diário volta 24 h depois", () => {
    const s = setup();
    for (let i = 0; i < 3; i++) {
      s.gate.admit("forno", DEV, IP, { qr: 20 });
      s.add(10 * SEC);
    }
    expect(s.gate.admit("forno", DEV, IP, { qr: 1 })).toBeNull();
    s.add(DAY);
    expect(s.gate.admit("forno", DEV, IP, { qr: 20 })).toEqual({ qr: 20 });
  });

  it("lote vazio: null, sem gastar a vez do device nem do IP", () => {
    const s = setup();
    expect(s.gate.admit("forno", DEV, IP, {})).toBeNull();
    expect(s.gate.admit("forno", DEV, IP, { open: 1 })).toEqual({ open: 1 });
  });

  it("mutação: 100 lotes seguidos do mesmo device somam no máximo 1 lote", () => {
    const s = setup();
    let summed = 0;
    for (let i = 0; i < 100; i++) {
      const r = s.gate.admit("forno", DEV, IP, { open: 20 });
      summed += r?.open ?? 0;
      s.add(50);
    }
    expect(summed).toBe(20);
  });
});

describe("sharedEventGate", () => {
  it("um portão por processo, no globalThis", () => {
    expect(sharedEventGate()).toBe(sharedEventGate());
    const g = globalThis as unknown as Record<symbol, unknown>;
    expect(g[Symbol.for("cardapio-digital.comunidade.eventos")]).toBe(sharedEventGate());
  });
});
