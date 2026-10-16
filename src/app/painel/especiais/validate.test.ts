import { describe, expect, it } from "vitest";
import { validateSpecial, type SpecialInput } from "./validate";

const ok: SpecialInput = {
  name: "Pizza da Rainha", description: "Molho, muçarela e manjericão", priceCents: 12000, promoCents: 6900,
  everyH: 2, showS: 6, days: [5, 6], from: "19:00", to: "23:00", limit: 1, active: true,
};
const err = (over: Partial<SpecialInput>) => {
  const r = validateSpecial({ ...ok, ...over });
  return r.ok ? null : r.error;
};

describe("validateSpecial", () => {
  it("nome é obrigatório", () => {
    expect(err({ name: "  " })).toBe("Dê um nome para o produto especial.");
  });
  it("preço da oferta precisa existir e ser menor que o normal", () => {
    const msg = "O preço da oferta precisa ser menor que o preço normal.";
    expect(err({ promoCents: null as unknown as number })).toBe(msg);
    expect(err({ promoCents: 12000 })).toBe(msg);
    expect(err({ promoCents: 13000 })).toBe(msg);
  });
  it("tempo na tela de 4 a 15 s", () => {
    expect(err({ showS: 3 })).toBe("O tempo na tela vai de 4 a 15 segundos.");
    expect(err({ showS: 16 })).toBe("O tempo na tela vai de 4 a 15 segundos.");
  });
  it("intervalo de meia hora a 24 h", () => {
    expect(err({ everyH: 0.4 })).toBe("O intervalo vai de meia hora a 24 horas.");
    expect(err({ everyH: 25 })).toBe("O intervalo vai de meia hora a 24 horas.");
  });
  it("limite de 1 a 10", () => {
    expect(err({ limit: 0 })).toBe("O limite vai de 1 a 10 por oferta.");
    expect(err({ limit: 11 })).toBe("O limite vai de 1 a 10 por oferta.");
  });
  it("horário com os dois lados ou nenhum", () => {
    const msg = "Preencha o horário de início e de fim, ou deixe os dois vazios.";
    expect(err({ from: "19:00", to: null })).toBe(msg);
    expect(err({ from: null, to: "23:00" })).toBe(msg);
    expect(err({ from: null, to: null })).toBeNull();
  });
  it("entrada válida vira a linha do banco", () => {
    const r = validateSpecial(ok);
    expect(r).toEqual({
      ok: true,
      row: {
        name: "Pizza da Rainha", description: "Molho, muçarela e manjericão", price_cents: 12000, promo_price_cents: 6900,
        special_every_h: 2, special_show_s: 6, special_days: [5, 6], special_from: "19:00", special_to: "23:00", special_limit: 1,
        active: true, price_options: null, featured: false, hide_price: false,
      },
    });
  });
});
