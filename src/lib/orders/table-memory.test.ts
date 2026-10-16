import { describe, expect, it } from "vitest";
import { TABLE_MEMORY_MS, readTableMemory, tableMemoryKey, writeTableMemory } from "./table-memory";

const T0 = Date.parse("2026-10-16T22:00:00Z");
const MIN = 60_000;
const mesa = { code: "E74B9X", label: "Mesa 7" };

describe("mesa lembrada", () => {
  it("são 4 h, numa chave por restaurante", () => {
    expect(TABLE_MEMORY_MS).toBe(4 * 60 * MIN);
    expect(tableMemoryKey("depot")).toBe("cardapio-mesa:depot");
    expect(tableMemoryKey("depot")).not.toBe(tableMemoryKey("forno"));
  });
  it("lê a mesa gravada há 3 h 59 min", () => {
    const raw = writeTableMemory(mesa, T0);
    expect(readTableMemory(raw, T0 + 3 * 60 * MIN + 59 * MIN)).toEqual(mesa);
  });
  it("devolve null com 4 h 1 min", () => {
    expect(readTableMemory(writeTableMemory(mesa, T0), T0 + 4 * 60 * MIN + MIN)).toBeNull();
  });
  it("guarda só código, nome e hora", () => {
    const raw = writeTableMemory({ ...mesa, extra: "x" } as typeof mesa, T0);
    expect(JSON.parse(raw)).toEqual({ code: "E74B9X", label: "Mesa 7", at: T0 });
  });
  it("devolve null com JSON inválido, vazio ou código fora do formato", () => {
    expect(readTableMemory(null, T0)).toBeNull();
    expect(readTableMemory("", T0)).toBeNull();
    expect(readTableMemory("{oi", T0)).toBeNull();
    expect(readTableMemory("null", T0)).toBeNull();
    expect(readTableMemory("[1]", T0)).toBeNull();
    const at = (o: Record<string, unknown>) => JSON.stringify({ code: "E74B9X", label: "Mesa 7", at: T0, ...o });
    expect(readTableMemory(at({ code: "e74b9x" }), T0)).toBeNull();
    expect(readTableMemory(at({ code: "E74B9" }), T0)).toBeNull();
    expect(readTableMemory(at({ code: "E04B9X" }), T0)).toBeNull(); // 0 não existe no código do QR
    expect(readTableMemory(at({ code: "E74B9X,(" }), T0)).toBeNull();
    expect(readTableMemory(at({ label: 5 }), T0)).toBeNull();
    expect(readTableMemory(at({ label: "" }), T0)).toBeNull();
    expect(readTableMemory(at({ at: "ontem" }), T0)).toBeNull();
  });
  it("hora gravada no futuro (relógio mexido) não estende a memória", () => {
    expect(readTableMemory(writeTableMemory(mesa, T0 + 10 * MIN), T0)).toBeNull();
  });
});
