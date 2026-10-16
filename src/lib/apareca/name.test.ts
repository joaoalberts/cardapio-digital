// Nome ou @ do cliente: até 30 caracteres, com filtro de palavrões que pega acento,
// maiúsculas e letras trocadas por números, sem barrar nomes comuns por pedaço de palavra.
import { describe, expect, it } from "vitest";
import { cleanName, NAME_MAX } from "./name";

describe("cleanName", () => {
  it("apara os espaços e guarda o @", () => {
    expect(cleanName("  @Ana_Souza ")).toEqual({ ok: true, name: "@Ana_Souza" });
  });

  it("vazio, só espaços ou ausente vira null", () => {
    expect(cleanName("")).toEqual({ ok: true, name: null });
    expect(cleanName("   ")).toEqual({ ok: true, name: null });
    expect(cleanName(undefined)).toEqual({ ok: true, name: null });
    expect(cleanName(null)).toEqual({ ok: true, name: null });
  });

  it("até 30 caracteres passa; 31 é long", () => {
    expect(NAME_MAX).toBe(30);
    expect(cleanName("a".repeat(30))).toEqual({ ok: true, name: "a".repeat(30) });
    expect(cleanName("a".repeat(31))).toEqual({ ok: false, error: "long" });
  });

  it("conta emoji como um caractere", () => {
    expect(cleanName("😀".repeat(30))).toEqual({ ok: true, name: "😀".repeat(30) });
  });

  it("junta espaços repetidos no meio", () => {
    expect(cleanName("Ana   Souza")).toEqual({ ok: true, name: "Ana Souza" });
  });

  it.each([
    "porra",
    "PORRA",
    "p0rr4",
    "Pôrra",
    "caralho",
    "c4r4lh0",
    "vai tomar no cu",
    "filho da puta",
    "@putaria",
    "merda",
    "M3RD4!",
    "buceta",
    "arrombado",
    "fdp",
    "p.o.r.r.a",
    "porrrrra",
    "p o r r a",
    "f.d.p",
    "otário",
    "BABACA",
    "b0st4",
    "nazista",
    "escroto",
    "bucetinha",
    "bucetuda",
    "escrotinho",
    "escrotão",
    "bostinha",
    "nazistinha",
    "otariozinho",
    "po rra",
    "fo da se",
    "Ana p o r r a",
    "Ana po rra",
  ])("%s é bad_word", (raw) => {
    expect(cleanName(raw)).toEqual({ ok: false, error: "bad_word" });
  });

  it.each(["Cassia", "Cássia", "Pescador", "Computador", "Temporada", "Picanha da Ana", "Ana Pinto", "@cuscuz_da_vo", "Maria Luiza", "Pedro Botari", "Ana Zisman", "Baba Cardoso", "Leonardo Tarifa", "Ana Bostani", "Escrotini Neto", "Homer Dantas", "Ana de Sá", "Jo da Silva", "Li Na", "Ana Notária", "Boston Ribeiro", "Babacar Diop"])(
    "%s passa (sem falso positivo por pedaço de palavra)",
    (raw) => {
      expect(cleanName(raw)).toEqual({ ok: true, name: raw });
    },
  );

  it("não-texto vira null", () => {
    expect(cleanName(42)).toEqual({ ok: true, name: null });
    expect(cleanName({ name: "x" })).toEqual({ ok: true, name: null });
  });
});
