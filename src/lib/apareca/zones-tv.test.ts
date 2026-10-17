import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "./config";
import { withTvZone } from "./panel-logic";
import type { AparecaConfig } from "./types";

const SALAO = "11111111-1111-4111-8111-111111111111";
const VARANDA = "22222222-2222-4222-8222-222222222222";
const TV1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TV2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MESA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const cfg = (): AparecaConfig => ({
  ...DEFAULT_CONFIG,
  zones: [{ id: SALAO, name: "Salão" }, { id: VARANDA, name: "Varanda" }],
  table_zones: { [MESA]: VARANDA },
  tv_zones: { [TV2]: SALAO },
});

describe("withTvZone", () => {
  it("põe a zona numa TV sem zona", () => {
    const out = withTvZone(cfg(), TV1, VARANDA);
    expect("error" in out).toBe(false);
    expect((out as AparecaConfig).tv_zones[TV1]).toBe(VARANDA);
  });

  it("troca a zona de uma TV que já tinha", () => {
    const out = withTvZone(cfg(), TV2, VARANDA) as AparecaConfig;
    expect(out.tv_zones[TV2]).toBe(VARANDA);
  });

  it("null tira a zona (a TV passa a tocar todas)", () => {
    const out = withTvZone(cfg(), TV2, null) as AparecaConfig;
    expect(out.tv_zones).not.toHaveProperty(TV2);
  });

  it("zona que não existe devolve erro e não muda nada", () => {
    const base = cfg();
    const out = withTvZone(base, TV1, "33333333-3333-4333-8333-333333333333");
    expect(out).toEqual({ error: expect.any(String) });
    expect(base.tv_zones).toEqual({ [TV2]: SALAO });
  });

  it("não mexe nas mesas, nas zonas nem nas outras TVs", () => {
    const base = cfg();
    const out = withTvZone(base, TV1, SALAO) as AparecaConfig;
    expect(out.table_zones).toEqual({ [MESA]: VARANDA });
    expect(out.zones).toEqual(base.zones);
    expect(out.tv_zones[TV2]).toBe(SALAO);
    expect(base.tv_zones).not.toHaveProperty(TV1); // não altera o objeto de entrada
  });
});
