import { describe, expect, it } from "vitest";
import { csvCell } from "./csv";

describe("csvCell", () => {
  it("texto comum só ganha aspas, com aspas internas dobradas", () => {
    expect(csvCell("Pizza")).toBe('"Pizza"');
    expect(csvCell('Pão "da casa"')).toBe('"Pão ""da casa"""');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell(12)).toBe('"12"');
  });

  it("neutraliza fórmula: = + - @ tab e CR no começo ganham apóstrofo", () => {
    for (const c of ["=", "+", "-", "@", "\t", "\r"]) expect(csvCell(`${c}1+1`)).toBe(`"'${c}1+1"`);
    expect(csvCell('=HYPERLINK("http://x","a")')).toBe('"\'=HYPERLINK(""http://x"",""a"")"');
  });

  it("os símbolos no meio do texto não mudam", () => {
    expect(csvCell("Combo 1 + 1 = 2 @ casa")).toBe('"Combo 1 + 1 = 2 @ casa"');
  });
});
