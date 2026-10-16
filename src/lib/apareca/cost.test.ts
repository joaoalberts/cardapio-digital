import { describe, expect, it } from "vitest";
import { estimateUsd, MUX_PRICES, tetoUsd, uploadGate, type MonthUsage } from "./cost";

const zero: MonthUsage = { encoded_s: 0, stored_min_month: 0, played_s: 0, mp4_s: 0, house_min: 0 };

describe("MUX_PRICES", () => {
  it("guarda fonte e data conferidas", () => {
    expect(MUX_PRICES.source).toContain("https://www.mux.com/docs/pricing/video");
    expect(MUX_PRICES.checked_at).toBe("2026-10-16");
    expect(MUX_PRICES.delivery_free_min).toBe(60000);
  });
});

describe("estimateUsd", () => {
  it("uso zero custa 0", () => expect(estimateUsd(zero)).toBe(0));
  it("entrega abaixo da franquia não custa", () => {
    expect(estimateUsd({ ...zero, played_s: 59_999 * 60 })).toBe(0);
    expect(estimateUsd({ ...zero, house_min: 60_000 })).toBe(0);
  });
  it("1 min acima da franquia custa delivery_per_min", () => {
    expect(estimateUsd({ ...zero, house_min: 60_001 })).toBeCloseTo(MUX_PRICES.delivery_per_min, 9);
    expect(estimateUsd({ ...zero, played_s: 60_000 * 60 + 60 })).toBeCloseTo(MUX_PRICES.delivery_per_min, 9);
  });
  it("entrega soma exibição dos clientes e loop dos institucionais antes da franquia", () => {
    expect(estimateUsd({ ...zero, played_s: 30_000 * 60, house_min: 30_010 })).toBeCloseTo(10 * MUX_PRICES.delivery_per_min, 9);
  });
  it("armazenamento e MP4 (pior caso) entram na conta", () => {
    const u = { ...zero, encoded_s: 600 * 60, stored_min_month: 600, mp4_s: 600 * 60 };
    expect(estimateUsd(u)).toBeCloseTo(600 * 0.003 + 600 * 0.00075, 6);
  });
  it("mínimo de 1 mês por asset: apagar em 6 h não baixa o armazenamento", () => {
    // 100 min codificados, mas só 1 min-mês proporcional (apagados cedo): cobra os 100 min inteiros.
    const u = { ...zero, encoded_s: 100 * 60, stored_min_month: 1 };
    expect(estimateUsd(u)).toBeCloseTo(100 * MUX_PRICES.storage_per_min_month, 6);
    // e quando o armazenado já é maior que o codificado (institucionais), vale o armazenado
    expect(estimateUsd({ ...zero, encoded_s: 60, stored_min_month: 20 })).toBeCloseTo(20 * MUX_PRICES.storage_per_min_month, 6);
  });
  it("reproduz o cenário normal da conta (~US$ 2,31 + institucionais)", () => {
    const u = { encoded_s: 600 * 60, stored_min_month: 620, played_s: 4800 * 60, mp4_s: 600 * 60, house_min: 36_000 };
    expect(estimateUsd(u)).toBeCloseTo(2.31, 2);
  });
});

describe("uploadGate", () => {
  it("ok abaixo de 75%, warn de 75% a 90%, paused a partir de 90%", () => {
    expect(uploadGate(14.9, 20)).toBe("ok");
    expect(uploadGate(15, 20)).toBe("warn");
    expect(uploadGate(17.99, 20)).toBe("warn");
    expect(uploadGate(18, 20)).toBe("paused");
    expect(uploadGate(30, 20)).toBe("paused");
  });
  it("teto inválido pausa por segurança", () => {
    expect(uploadGate(0, 0)).toBe("paused");
  });
});

describe("tetoUsd", () => {
  it("padrão 15; inválido 15; número válido vale", () => {
    expect(tetoUsd(undefined)).toBe(15);
    expect(tetoUsd("")).toBe(15);
    expect(tetoUsd("abc")).toBe(15);
    expect(tetoUsd("0")).toBe(15);
    expect(tetoUsd("-3")).toBe(15);
    expect(tetoUsd("12")).toBe(12);
    expect(tetoUsd("12,5")).toBe(15);
    expect(tetoUsd("12.5")).toBe(12.5);
  });
});
