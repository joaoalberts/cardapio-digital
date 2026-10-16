import { describe, expect, it } from "vitest";
import { CMU_LANGS, CMU_TEXTS, ct, ctf } from "./i18n";

const keys = Object.keys(CMU_TEXTS) as (keyof typeof CMU_TEXTS)[];

describe("textos da Comunidade", () => {
  it("são as 6 línguas do cardápio", () => {
    expect(CMU_LANGS).toEqual(["pt-BR", "en", "es", "fr", "it", "de"]);
  });

  it("toda chave tem as 6 línguas, nenhuma vazia", () => {
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) {
      for (const l of CMU_LANGS) {
        const s = CMU_TEXTS[k][l];
        expect(typeof s, `${k}/${l}`).toBe("string");
        expect(s.trim(), `${k}/${l}`).not.toBe("");
      }
    }
  });

  it("pt-BR sem seta no fim de botão e sem CAIXA ALTA", () => {
    for (const k of keys) {
      const s = CMU_TEXTS[k]["pt-BR"];
      expect(s, k).not.toContain("→");
      expect(s, k).not.toMatch(/\b[A-ZÀ-Ú]{3,}\b/);
    }
  });

  it("as variáveis existem em todas as línguas", () => {
    for (const k of keys) {
      const vars = (CMU_TEXTS[k]["pt-BR"].match(/\{\w+\}/g) ?? []).sort();
      for (const l of CMU_LANGS) expect((CMU_TEXTS[k][l].match(/\{\w+\}/g) ?? []).sort(), `${k}/${l}`).toEqual(vars);
    }
  });

  it("tem os modelos de enquete", () => {
    expect(ct("tplDessert", "pt-BR")).toBe("Qual sobremesa sai hoje?");
    expect(ct("tplDrink", "pt-BR")).toBeTruthy();
    expect(ct("tplMusic", "pt-BR")).toBe("Qual a próxima música?");
  });

  it("ct cai no pt-BR para língua desconhecida e usa o prefixo (en-US → en)", () => {
    expect(ct("buyAlso", "ja")).toBe("Pedir também");
    expect(ct("buyAlso", "en-US")).toBe(ct("buyAlso", "en"));
  });

  it("ctf troca as variáveis", () => {
    expect(ctf("muralCount", "pt-BR", { n: 5 })).toBe("5 fotos da casa");
    expect(ctf("relMin", "pt-BR", { n: 5 })).toBe("há 5 min");
    expect(ctf("nextAt", "pt-BR", { t: "21h" })).toBe("A seguir, às 21h");
  });
});
