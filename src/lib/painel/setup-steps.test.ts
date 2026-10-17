import { describe, expect, it } from "vitest";
import { setupDone, setupSteps, type SetupInput } from "./setup-steps";

const ZERO: SetupInput = { items: 0, tables: 0, communityOn: false, tvs: 0, houseReady: 0, aparecaAllowed: false, aparecaOn: false, isOwner: true };

describe("setupSteps", () => {
  it("restaurante zerado e sem liberação tem 4 passos pendentes", () => {
    const s = setupSteps(ZERO);
    expect(s.map((x) => x.id)).toEqual(["cardapio", "mesas", "comunidade", "tv"]);
    expect(s.every((x) => !x.done)).toBe(true);
  });

  it("com o Apareça liberado tem 6 passos, na ordem, com rótulo e destino", () => {
    const s = setupSteps({ ...ZERO, aparecaAllowed: true });
    expect(s.map((x) => [x.id, x.label, x.href])).toEqual([
      ["cardapio", "Montar o cardápio", "/painel/cardapio"],
      ["mesas", "Cadastrar as mesas e imprimir os QR", "/painel/mesas"],
      ["comunidade", "Ligar a Comunidade", "/painel/comunidade"],
      ["tv", "Ligar a primeira TV", "/painel/tvs"],
      ["casa", "Enviar um vídeo da casa", "/painel/apareca#casa"],
      ["apareca", "Ligar o Apareça na TV", "/painel/apareca#ajustes"],
    ]);
    expect(s.filter((x) => x.ownerOnly).map((x) => x.id)).toEqual(["comunidade", "apareca"]);
  });

  it("marca cada passo pelo seu dado", () => {
    const s = setupSteps({ items: 1, tables: 2, communityOn: true, tvs: 1, houseReady: 1, aparecaAllowed: true, aparecaOn: true, isOwner: true });
    expect(s.every((x) => x.done)).toBe(true);
    expect(setupSteps({ ...ZERO, items: 1 }).find((x) => x.id === "cardapio")!.done).toBe(true);
    expect(setupSteps({ ...ZERO, aparecaAllowed: true, houseReady: 1 }).find((x) => x.id === "casa")!.done).toBe(true);
  });

  it("funcionário: passo só do dono fica travado enquanto não está feito", () => {
    const off = setupSteps({ ...ZERO, isOwner: false, aparecaAllowed: true });
    expect(off.find((x) => x.id === "comunidade")!.blocked).toBe(true);
    expect(off.find((x) => x.id === "apareca")!.blocked).toBe(true);
    expect(off.find((x) => x.id === "cardapio")!.blocked).toBe(false);
    const on = setupSteps({ ...ZERO, isOwner: false, communityOn: true });
    expect(on.find((x) => x.id === "comunidade")!.blocked).toBe(false);
  });

  it("dono nunca fica travado", () => {
    expect(setupSteps({ ...ZERO, aparecaAllowed: true }).some((x) => x.blocked)).toBe(false);
  });

  it("setupDone só é verdadeiro com todos feitos", () => {
    expect(setupDone(setupSteps(ZERO))).toBe(false);
    expect(setupDone(setupSteps({ ...ZERO, items: 1, tables: 1, communityOn: true }))).toBe(false);
    expect(setupDone(setupSteps({ ...ZERO, items: 1, tables: 1, communityOn: true, tvs: 1 }))).toBe(true);
  });
});
