import { describe, expect, it } from "vitest";
import { TV_LANGS, TV_TEXTS, tt } from "./i18n";

const keys = Object.keys(TV_TEXTS) as (keyof typeof TV_TEXTS)[];

describe("textos do telão", () => {
  it("são as 6 línguas do cardápio", () => {
    expect(TV_LANGS).toEqual(["pt-BR", "en", "es", "fr", "it", "de"]);
  });

  it("toda chave tem as 6 línguas, nenhuma vazia", () => {
    for (const k of keys) {
      for (const l of TV_LANGS) {
        const s = TV_TEXTS[k][l];
        expect(typeof s, `${k}/${l}`).toBe("string");
        expect(s.trim(), `${k}/${l}`).not.toBe("");
      }
    }
  });

  it("pt-BR sem seta no fim e sem CAIXA ALTA", () => {
    for (const k of keys) {
      const s = TV_TEXTS[k]["pt-BR"];
      expect(s, k).not.toContain("→");
      expect(s, k).not.toMatch(/\b[A-ZÀ-Ú]{3,}\b/);
    }
  });

  it("as variáveis existem em todas as línguas", () => {
    for (const k of keys) {
      const vars = (TV_TEXTS[k]["pt-BR"].match(/\{\w+\}/g) ?? []).sort();
      for (const l of TV_LANGS) expect((TV_TEXTS[k][l].match(/\{\w+\}/g) ?? []).sort(), `${k}/${l}`).toEqual(vars);
    }
  });

  it("língua desconhecida cai no pt-BR; en-US usa o en", () => {
    expect(tt("tvPairTitle", "xx")).toBe("Parear esta TV");
    expect(tt("tvPairTitle", "en-US")).toBe("Pair this TV");
  });
});
