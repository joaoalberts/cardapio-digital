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
