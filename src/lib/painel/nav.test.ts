import { describe, expect, it } from "vitest";
import { BOTTOM_NAV, MAIS_GROUPS, NAV_GROUPS } from "./nav";

const all = NAV_GROUPS.flatMap((g) => g.items);
const hrefs = all.map((i) => i.href);

describe("nav", () => {
  it("a barra de baixo e o Mais só usam destinos do menu (exceto /painel/mais)", () => {
    const used = [...BOTTOM_NAV, ...MAIS_GROUPS.flatMap((g) => g.items)].filter((i) => i.href !== "/painel/mais");
    for (const i of used) expect(hrefs).toContain(i.href);
  });
  it("mantém Pedidos e Produtos especiais", () => {
    expect(hrefs).toContain("/painel/pedidos");
    expect(hrefs).toContain("/painel/especiais");
  });
  it("a barra de baixo tem 4 itens e termina em Mais", () => {
    expect(BOTTOM_NAV.map((i) => i.href)).toEqual(["/painel/pedidos", "/painel/agora", "/painel/cardapio", "/painel/mais"]);
  });
  it("sem destinos repetidos e todo item tem ícone", () => {
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const i of [...all, ...BOTTOM_NAV]) expect(i.icon.length).toBeGreaterThan(0);
  });
  it("não usa os rótulos antigos", () => {
    const labels = [...all, ...BOTTOM_NAV].map((i) => i.label);
    for (const l of ["Adicionar/Editar", "Editar Perfil"]) expect(labels).not.toContain(l);
  });
});
