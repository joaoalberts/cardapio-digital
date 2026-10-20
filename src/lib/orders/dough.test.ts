import { describe, expect, it } from "vitest";
import type { MenuItem } from "@/lib/menu/types";
import { parseDoughs, resolveDough, validateDoughs } from "./dough";

const pizza = (doughs: MenuItem["doughs"]) => ({ id: "p", doughs }) as MenuItem;
const base = [{ label: "Tradicional", extra_cents: 0 }, { label: "Fina", extra_cents: 500 }];

describe("parseDoughs", () => {
  it("aceita de 2 a 4 massas e completa extra_cents ausente com 0", () => {
    expect(parseDoughs([{ label: "Tradicional" }, { label: "Fina", extra_cents: 500 }])).toEqual(base);
    expect(parseDoughs(["a", "b", "c", "d"].map((label) => ({ label })))).toHaveLength(4);
  });
  it("apara o nome", () => {
    expect(parseDoughs([{ label: " Fina " }, { label: "Grossa" }])?.[0].label).toBe("Fina");
  });
  it("nome repetido (sem diferenciar maiúsculas) anula tudo", () => {
    expect(parseDoughs([{ label: "Fina" }, { label: "fina" }])).toBeNull();
  });
  it("menos de 2, mais de 4 ou formato errado: sem escolha de massa", () => {
    expect(parseDoughs([{ label: "Fina" }])).toBeNull();
    expect(parseDoughs([])).toBeNull();
    expect(parseDoughs("Fina")).toBeNull();
    expect(parseDoughs(null)).toBeNull();
    expect(parseDoughs(undefined)).toBeNull();
    expect(parseDoughs(["a", "b", "c", "d", "e"].map((label) => ({ label })))).toBeNull();
    expect(parseDoughs([{ label: "Fina" }, null])).toBeNull();
    expect(parseDoughs([{ label: "Fina" }, { label: 3 }])).toBeNull();
  });
  it("nome de 20 letras vale, de 25 não", () => {
    expect(parseDoughs([{ label: "a".repeat(20) }, { label: "b" }])).not.toBeNull();
    expect(parseDoughs([{ label: "a".repeat(25) }, { label: "b" }])).toBeNull();
    expect(parseDoughs([{ label: "  " }, { label: "b" }])).toBeNull();
  });
  it("extra_cents inteiro de 0 a 5000", () => {
    const one = (extra_cents: unknown) => parseDoughs([{ label: "A", extra_cents }, { label: "B" }]);
    expect(one(0)).not.toBeNull();
    expect(one(5000)).not.toBeNull();
    expect(one(-1)).toBeNull();
    expect(one(5001)).toBeNull();
    expect(one(2.5)).toBeNull();
    expect(one("500")).toBeNull();
  });
});

describe("resolveDough", () => {
  it("sem massa escolhida vale a primeira", () => {
    expect(resolveDough(pizza(base), undefined)).toEqual({ ok: true, dough: "Tradicional", extra: 0 });
    expect(resolveDough(pizza(base), null)).toEqual({ ok: true, dough: "Tradicional", extra: 0 });
  });
  it("massa existente devolve o extra dela", () => {
    expect(resolveDough(pizza(base), "Fina")).toEqual({ ok: true, dough: "Fina", extra: 500 });
  });
  it("massa que não existe é recusada", () => {
    expect(resolveDough(pizza(base), "Grossa")).toEqual({ ok: false });
  });
  it("prato sem massas só aceita ausente", () => {
    expect(resolveDough(pizza(null), undefined)).toEqual({ ok: true, dough: null, extra: 0 });
    expect(resolveDough(pizza(undefined), null)).toEqual({ ok: true, dough: null, extra: 0 });
    expect(resolveDough(pizza(null), "Fina")).toEqual({ ok: false });
  });
});

describe("validateDoughs (cadastro pelo dono)", () => {
  const ok = [{ label: "Tradicional", extra_cents: 0 }, { label: "Fina", extra_cents: 500 }];
  it("aceita de 2 a 4 massas e ignora linhas sem nome", () => {
    expect(validateDoughs([...ok, { label: "  ", extra_cents: 0 }])).toEqual({ doughs: ok });
  });
  it("menos de 2 nomes válidos ou nomes repetidos: erro dos tipos", () => {
    const msg = "Informe de 2 a 4 tipos de massa, com nomes diferentes.";
    expect(validateDoughs([ok[0], { label: "", extra_cents: 0 }])).toEqual({ error: msg });
    expect(validateDoughs([ok[0], { label: "tradicional", extra_cents: 0 }])).toEqual({ error: msg });
    expect(validateDoughs([...ok, ...["A", "B", "C"].map((label) => ({ label, extra_cents: 0 }))])).toEqual({ error: msg });
  });
  it("extra fora de R$ 0 a R$ 50: erro do valor", () => {
    const msg = "O valor extra da massa vai de R$ 0 a R$ 50.";
    expect(validateDoughs([ok[0], { label: "Fina", extra_cents: 5001 }])).toEqual({ error: msg });
    expect(validateDoughs([ok[0], { label: "Fina", extra_cents: -1 }])).toEqual({ error: msg });
    expect(validateDoughs([ok[0], { label: "Fina", extra_cents: 5000 }])).toHaveProperty("doughs");
  });
  it("lixo (não lista) vira erro", () => {
    expect(validateDoughs("x")).toHaveProperty("error");
  });
});
