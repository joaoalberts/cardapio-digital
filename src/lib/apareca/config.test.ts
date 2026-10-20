import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, featureState, parseConfig, withinHours } from "./config";
import type { AparecaConfig, AparecaHead } from "./types";

const TZ = "America/Sao_Paulo";
// 2026-10-16 (sexta) em Brasília = UTC-3
const at = (hh: number, mm = 0) => new Date(Date.UTC(2026, 9, 16, hh + 3, mm));
const UUID = "0b9a0c1e-2f3d-4a5b-8c6d-7e8f9a0b1c2d";
const UUID2 = "1c0b1d2f-3a4e-4b6c-9d7e-8f9a0b1c2d3e";

const head = (over: Partial<AparecaHead> = {}): AparecaHead => ({
  id: UUID, slug: "casa", name: "Casa", timezone: TZ, opening_hours: null,
  allowed: true, ai_allowed: false, enabled: true,
  config: DEFAULT_CONFIG, logo_path: null, brand_color: null, instagram: null, ...over,
});

describe("parseConfig", () => {
  it("null vira o padrão", () => {
    expect(parseConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG).toEqual({
      mode: "manual", rule: { kind: "intercalar", house_every: 1, clients_max: 3 }, plays: 1,
      device_per_hour: 2, hours: null, retention_h: 6, zones: [], table_zones: {}, tv_zones: {},
    });
  });
  it("lixo não lança", () => {
    expect(parseConfig("xpto")).toEqual(DEFAULT_CONFIG);
    expect(parseConfig([1, 2])).toEqual(DEFAULT_CONFIG);
    expect(parseConfig({ zones: "x", table_zones: 5, rule: 3 })).toEqual(DEFAULT_CONFIG);
  });
  it("corrige faixas", () => {
    expect(parseConfig({ plays: 7 }).plays).toBe(3);
    expect(parseConfig({ plays: 0 }).plays).toBe(1);
    expect(parseConfig({ retention_h: 2 }).retention_h).toBe(6);
    expect(parseConfig({ retention_h: 500 }).retention_h).toBe(168);
    expect(parseConfig({ device_per_hour: 0 }).device_per_hour).toBe(1);
    expect(parseConfig({ mode: "xpto" }).mode).toBe("manual");
    expect(parseConfig({ mode: "hibrido" }).mode).toBe("hibrido");
    expect(parseConfig({ hours: { from: "25:00" } }).hours).toBeNull();
    expect(parseConfig({ hours: { from: "19:00", to: "02:00" } }).hours).toEqual({ from: "19:00", to: "02:00" });
    // Minor 1: início igual ao fim não é janela; vale o horário de funcionamento.
    expect(parseConfig({ hours: { from: "19:00", to: "19:00" } }).hours).toBeNull();
  });
  it("descarta zonas ruins e mapas com uuid inválido", () => {
    const c = parseConfig({
      zones: [{ id: UUID, name: "Salão" }, { id: UUID2, name: "" }, { id: "x", name: "Bar" }, { id: UUID2, name: "a".repeat(41) }],
      table_zones: { [UUID]: UUID, "nao-uuid": UUID, [UUID2]: "ruim" },
      tv_zones: { [UUID2]: UUID },
    });
    expect(c.zones).toEqual([{ id: UUID, name: "Salão" }]);
    expect(c.table_zones).toEqual({ [UUID]: UUID });
    expect(c.tv_zones).toEqual({ [UUID2]: UUID });
  });
});

describe("withinHours (Foco 5)", () => {
  const cfg = (hours: AparecaConfig["hours"]) => ({ ...DEFAULT_CONFIG, hours });
  const h = { opening_hours: null, timezone: TZ };
  it("janela que atravessa a meia-noite", () => {
    const c = cfg({ from: "19:00", to: "02:00" });
    expect(withinHours(c, h, at(1))).toBe(true);
    expect(withinHours(c, h, at(3))).toBe(false);
    expect(withinHours(c, h, at(19))).toBe(true);
  });
  it("sem janela usa o horário de funcionamento", () => {
    const sexta = [{ open: "18:00", close: "23:00" }];
    const oh = [[], [], [], [], [], sexta, []];
    expect(withinHours(cfg(null), { opening_hours: oh, timezone: TZ }, at(20))).toBe(true);
    expect(withinHours(cfg(null), { opening_hours: oh, timezone: TZ }, at(12))).toBe(false);
  });
  it("sem horário nenhum, sempre aberto", () => {
    expect(withinHours(cfg(null), h, at(4))).toBe(true);
  });
});

describe("featureState", () => {
  const o = { now: at(12), off: false, paused: false };
  it("tudo certo", () => expect(featureState(head(), o)).toEqual({ on: true }));
  it("sem restaurante", () => expect(featureState(null, o)).toEqual({ on: false, why: "disabled" }));
  it("off vence tudo", () => expect(featureState(head(), { ...o, off: true })).toEqual({ on: false, why: "off" }));
  it("não liberado mesmo com enabled", () =>
    expect(featureState(head({ allowed: false, enabled: true }), o)).toEqual({ on: false, why: "not_allowed" }));
  it("desligado pelo dono", () => expect(featureState(head({ enabled: false }), o)).toEqual({ on: false, why: "disabled" }));
  it("fora do horário", () => {
    const c = { ...DEFAULT_CONFIG, hours: { from: "19:00", to: "23:00" } };
    expect(featureState(head({ config: c }), o)).toEqual({ on: false, why: "closed" });
  });
  it("pausado pelo teto", () => expect(featureState(head(), { ...o, paused: true })).toEqual({ on: false, why: "paused" }));
});
