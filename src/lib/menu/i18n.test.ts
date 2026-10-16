import { describe, expect, it } from "vitest";
import { tf } from "./i18n";

describe("tf", () => {
  it("troca a variável numérica no pt-BR", () => {
    expect(tf("oInOrder", "pt-BR", { n: 2 })).toBe("2 no pedido");
  });

  it("troca várias variáveis no en", () => {
    expect(tf("oHalfAvg", "en", { a: "1", b: "2", c: "3" })).toBe("Average of 1 and 2 = 3");
  });
});

describe("textos da oferta relâmpago", () => {
  it("aviso de oferta pega com o preço", () => {
    expect(tf("oSpecialGot", "pt-BR", { price: "R$ 69" })).toBe("Pegou! R$ 69 garantido no seu pedido.");
  });
  it("limite por oferta troca o número em todas as línguas", () => {
    for (const l of ["pt-BR", "en", "es", "fr", "it", "de"]) expect(tf("oSpecialMax", l, { n: 2 })).not.toContain("{n}");
  });
});
