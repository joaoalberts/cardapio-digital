import { describe, expect, it } from "vitest";
import { tvStatus } from "./tv-status";

const NOW = new Date("2026-10-17T22:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

describe("tvStatus", () => {
  it("nunca vista", () => {
    expect(tvStatus(null, NOW)).toEqual({ on: false, text: "nunca ligada" });
    expect(tvStatus("lixo", NOW)).toEqual({ on: false, text: "nunca ligada" });
  });
  it("vista há pouco está ligada", () => {
    expect(tvStatus(ago(2), NOW)).toEqual({ on: true, text: "ligada" });
  });
  it("sem sinal em minutos", () => {
    expect(tvStatus(ago(15), NOW)).toEqual({ on: false, text: "sem sinal há 15 min" });
  });
  it("sem sinal em horas inteiras, arredondando para baixo", () => {
    expect(tvStatus(ago(180), NOW).text).toBe("sem sinal há 3 h");
    expect(tvStatus(ago(119), NOW).text).toBe("sem sinal há 1 h");
    expect(tvStatus(ago(60), NOW).text).toBe("sem sinal há 1 h");
  });
  it("o limite é de 10 min", () => {
    expect(tvStatus(ago(9), NOW).on).toBe(true);
    expect(tvStatus(ago(10), NOW).on).toBe(false);
  });
  it("aceita o formato do NocoDB", () => {
    expect(tvStatus("2026-10-17 21:58:00+00:00", NOW)).toEqual({ on: true, text: "ligada" });
    expect(tvStatus("2026-10-17 21:30:00+00:00", NOW).text).toBe("sem sinal há 30 min");
  });
});
