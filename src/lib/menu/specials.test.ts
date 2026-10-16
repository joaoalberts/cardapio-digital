import { describe, expect, it } from "vitest";
import { specialInfo } from "./specials";

describe("specialInfo", () => {
  it("sem nada preenchido usa os padrões (a cada 2 h, 6 s, limite 1, todos os dias, o dia todo)", () => {
    expect(specialInfo({})).toEqual({ every_h: 2, show_s: 6, days: [], from: null, to: null, limit: 1, times: [] });
  });

  it("segura os números dentro das faixas do painel", () => {
    const s = specialInfo({ special_show_s: 40, special_every_h: 0.1, special_limit: 99 });
    expect(s.show_s).toBe(15);
    expect(s.every_h).toBe(0.5);
    expect(s.limit).toBe(10);
  });

  it("guarda só dias válidos (0 a 6)", () => {
    expect(specialInfo({ special_days: [1, 3, 9, "x"] }).days).toEqual([1, 3]);
  });

  it("aceita horário HH:MM e descarta horário inválido", () => {
    const ok = specialInfo({ special_from: "19:00", special_to: "22:30" });
    expect(ok.from).toBe("19:00");
    expect(ok.to).toBe("22:30");
    expect(specialInfo({ special_from: "25:00" }).from).toBeNull();
  });
});

describe("horários marcados", () => {
  it("guarda horários válidos, sem repetir e em ordem", () => {
    expect(specialInfo({ special_times: ["20:00", "12:30", "20:00", "25:00", "x"] }).times).toEqual(["12:30", "20:00"]);
  });
  it("sem horários marcados, a lista fica vazia (modo a cada X horas)", () => {
    expect(specialInfo({}).times).toEqual([]);
  });
});
