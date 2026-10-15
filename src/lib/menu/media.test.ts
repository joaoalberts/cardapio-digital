import { describe, expect, it } from "vitest";
import { formatPrice } from "./media";

// Intl usa espaço inquebrável entre "R$" e o número; o teste compara com espaço comum.
const fp = (c: number, l = "pt-BR") => formatPrice(c, l).replace(/\s/g, " ");

describe("preço", () => {
  it("valor fechado sai sem ,00", () => {
    expect(fp(6400)).toBe("R$ 64");
    expect(fp(100000)).toBe("R$ 1.000");
  });
  it("valor com centavos mantém as duas casas", () => {
    expect(fp(5740)).toBe("R$ 57,40");
    expect(fp(2995)).toBe("R$ 29,95");
    expect(fp(5)).toBe("R$ 0,05");
  });
  it("vale nos outros idiomas também", () => {
    expect(fp(6400, "en")).toBe("R$64");
    expect(fp(5740, "en")).toBe("R$57.40");
  });
});
