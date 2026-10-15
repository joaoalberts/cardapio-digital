import { describe, expect, it } from "vitest";
import {
  CART_TTL, addLine, cartCount, cartTotal, lineKey, parseStoredCart, parseStoredRef, removeLine, replaceLine, restoreLine, serializeCart, setQty,
  type NewLine,
} from "./cart";

const smash: NewLine = { item: "smash", option: null, half: null, qty: 1, note: "" };
const pizza: NewLine = { item: "margherita", option: "Grande", half: "calabresa", qty: 1, note: "sem azeitona" };

describe("carrinho", () => {
  it("junta linhas iguais e separa observações diferentes", () => {
    let c = addLine([], smash);
    c = addLine(c, { ...smash, qty: 2 });
    c = addLine(c, { ...smash, note: "sem picles" });
    expect(c.map((l) => [l.item, l.qty, l.note])).toEqual([["smash", 3, ""], ["smash", 1, "sem picles"]]);
  });
  it("caractere | na observação ou na opção não faz linhas diferentes parecerem iguais", () => {
    const a = { item: "x", option: null, half: null, qty: 1, note: "|a" };
    const b = { item: "x", option: "|", half: null, qty: 1, note: "a" };
    expect(addLine(addLine([], a), b)).toHaveLength(2);
  });
  it("meio a meio com os sabores em ordem invertida é a mesma pizza", () => {
    const inv: NewLine = { ...pizza, item: "calabresa", half: "margherita" };
    const c = addLine(addLine([], pizza), inv);
    expect(c).toHaveLength(1);
    expect(c[0].qty).toBe(2);
    expect([c[0].item, c[0].half]).toEqual(["margherita", "calabresa"]); // fica como foi pedida primeiro
    expect(lineKey(inv)).toBe(lineKey(pizza));
    expect(lineKey({ ...pizza, half: null })).not.toBe(lineKey({ ...pizza, item: "calabresa", half: null })); // inteiras seguem diferentes
  });
  it("observação com espaços nas pontas conta como a mesma", () => {
    const c = addLine(addLine([], { ...smash, note: "sem picles" }), { ...smash, note: "  sem picles " });
    expect(c).toHaveLength(1);
    expect(c[0].qty).toBe(2);
  });
  it("não passa de 20 unidades", () => {
    expect(addLine([], { ...smash, qty: 50 })[0].qty).toBe(20);
    const c = addLine([], { ...smash, qty: 15 });
    expect(addLine(c, { ...smash, qty: 15 })[0].qty).toBe(20);
  });
  it("editar troca a linha no mesmo lugar", () => {
    const c = addLine(addLine([], smash), pizza);
    const r = replaceLine(c, c[0].key, { ...smash, note: "bem passado" });
    expect(r.map((l) => l.note)).toEqual(["bem passado", "sem azeitona"]);
    expect(r[0].key).toBe(lineKey({ ...smash, note: "bem passado" }));
  });
  it("editar só a quantidade mantém a linha no lugar, com a quantidade nova", () => {
    const c = addLine([], smash);
    const r = replaceLine(c, c[0].key, { ...smash, qty: 4 });
    expect(r).toHaveLength(1);
    expect(r[0].qty).toBe(4);
  });
  it("editar até ficar igual a outra linha junta as duas", () => {
    const c = addLine(addLine([], smash), { ...smash, note: "sem picles", qty: 2 });
    const r = replaceLine(c, c[1].key, { ...smash, qty: 2 });
    expect(r).toHaveLength(1);
    expect(r[0].qty).toBe(3);
  });
  it("quantidade zero remove; remover e desfazer volta ao mesmo lugar", () => {
    const c = addLine(addLine(addLine([], smash), pizza), { ...smash, note: "x" });
    expect(setQty(c, c[0].key, 0)).toHaveLength(2);
    const { cart, removed } = removeLine(c, c[1].key);
    expect(cart).toHaveLength(2);
    expect(restoreLine(cart, removed!).map((l) => l.item)).toEqual(["smash", "margherita", "smash"]);
  });
  it("conta itens e soma o total com o preço de cada linha", () => {
    const c = addLine(addLine([], { ...smash, qty: 2 }), pizza);
    expect(cartCount(c)).toBe(3);
    expect(cartTotal(c, (l) => (l.item === "smash" ? 3490 : l.item === "margherita" ? 5675 : null))).toBe(3490 * 2 + 5675);
    expect(cartTotal(c, () => null)).toBe(0);
  });
});

describe("limite de linhas", () => {
  it("não cria a 31ª linha, mas soma em uma linha existente", () => {
    let c: ReturnType<typeof addLine> = [];
    for (let i = 0; i < 30; i++) c = addLine(c, { ...smash, item: `p${i}` });
    expect(c).toHaveLength(30);
    expect(addLine(c, { ...smash, item: "novo" })).toBe(c);
    const sum = addLine(c, { ...smash, item: "p0", qty: 2 });
    expect(sum).toHaveLength(30);
    expect(sum[0].qty).toBe(3);
  });
});

describe("armazenamento", () => {
  it("guarda e recupera o ref de envio pendente junto do carrinho", () => {
    const c = addLine([], pizza);
    const raw = serializeCart(c, 1000, "ref-1");
    expect(parseStoredRef(raw, 1000 + CART_TTL - 1)).toBe("ref-1");
    expect(parseStoredCart(raw, 1000)).toEqual(c);
    expect(parseStoredRef(raw, 1000 + CART_TTL + 1)).toBeNull();
  });
  it("carrinho salvo antes (sem ref) continua carregando", () => {
    const old = JSON.stringify({ v: 1, savedAt: 0, lines: [{ ...smash, key: "x" }] });
    expect(parseStoredCart(old, 0)).toHaveLength(1);
    expect(parseStoredRef(old, 0)).toBeNull();
    expect(parseStoredRef(serializeCart(addLine([], smash), 0), 0)).toBeNull();
    expect(parseStoredRef("{oi", 0)).toBeNull();
    expect(parseStoredRef(null, 0)).toBeNull();
    expect(parseStoredRef(JSON.stringify({ v: 1, savedAt: 0, lines: [], ref: 5 }), 0)).toBeNull();
  });
  it("volta o que foi salvo dentro de 6 h", () => {
    const c = addLine([], pizza);
    expect(parseStoredCart(serializeCart(c, 1000), 1000 + CART_TTL - 1)).toEqual(c);
  });
  it("descarta depois de 6 h, lixo e linhas malformadas", () => {
    const c = addLine([], pizza);
    expect(parseStoredCart(serializeCart(c, 1000), 1000 + CART_TTL + 1)).toEqual([]);
    expect(parseStoredCart("{oi", 0)).toEqual([]);
    expect(parseStoredCart(null, 0)).toEqual([]);
    const bad = JSON.stringify({ v: 1, savedAt: 0, lines: [{ item: 5, qty: "a" }, { ...smash, key: "x" }] });
    expect(parseStoredCart(bad, 0).map((l) => [l.item, l.key])).toEqual([["smash", lineKey(smash)]]);
  });
});
