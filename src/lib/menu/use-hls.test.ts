import { describe, expect, it } from "vitest";
import { startLevelFor } from "./use-hls";

describe("qualidade inicial do vídeo", () => {
  it("começa no menor nível que chega a 720p", () => {
    expect(startLevelFor([{ height: 270 }, { height: 360 }, { height: 540 }, { height: 720 }, { height: 1080 }])).toBe(3);
    expect(startLevelFor([{ height: 1080 }, { height: 480 }, { height: 576 }, { height: 800 }])).toBe(3);
  });
  it("sem nível de 540p para cima, fica com o maior que houver", () => {
    expect(startLevelFor([{ height: 270 }, { height: 480 }, { height: 360 }])).toBe(1);
    expect(startLevelFor([{ height: 540 }, { height: 1080 }], 540)).toBe(0);
  });
  it("lista vazia deixa o player decidir", () => {
    expect(startLevelFor([])).toBe(-1);
  });
});
