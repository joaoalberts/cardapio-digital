import { beforeEach, describe, expect, it } from "vitest";
import { openStartGate, resetStartGate, startGateOpen } from "./start-gate";

describe("abertura: banner primeiro", () => {
  beforeEach(() => resetStartGate());
  it("começa fechada e abre uma vez só", () => {
    expect(startGateOpen()).toBe(false);
    openStartGate();
    expect(startGateOpen()).toBe(true);
    openStartGate();
    expect(startGateOpen()).toBe(true);
  });
});
