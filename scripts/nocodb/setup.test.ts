import { describe, expect, it } from "vitest";
import { TABLES } from "./setup.mjs";

// O esquema do NocoDB é a fonte das tabelas da Comunidade (spec, seção "Dados").
type Col = { column_name: string; uidt: string };
const tables = TABLES as unknown as Record<string, Col[]>;
const cols = (t: string) => Object.fromEntries((tables[t] ?? []).map((c) => [c.column_name, c.uidt]));

const TEXT = "SingleLineText", LONG = "LongText", BOOL = "Checkbox", JSONT = "JSON", DATE = "DateTime";

describe("setup.mjs: esquema da Comunidade", () => {
  it("importar não roda o script (nem pede o token)", () => {
    expect(Object.keys(tables)).toContain("restaurants");
  });

  it("tem as 5 tabelas novas", () => {
    for (const t of ["community_polls", "community_votes", "community_posts", "community_tvs", "community_tally"]) {
      expect(tables[t], t).toBeDefined();
    }
  });

  it("restaurants ganha o interruptor e a hora do dia; orders ganha discarded", () => {
    expect(cols("restaurants")).toMatchObject({ community_enabled: BOOL, community_day_start: TEXT, community_tv_simple: BOOL });
    expect(cols("orders")).toMatchObject({ discarded: BOOL });
  });

  it("community_polls", () => {
    expect(cols("community_polls")).toEqual({
      uid: TEXT, restaurant_id: TEXT, template: TEXT, question: LONG, options: JSONT,
      starts_at: DATE, ends_at: DATE, closed_at: DATE, created_at: DATE, result: JSONT,
    });
  });

  it("community_votes", () => {
    expect(cols("community_votes")).toEqual({
      uid: TEXT, restaurant_id: TEXT, poll_id: TEXT, option_id: TEXT, device_id: TEXT, table_id: TEXT, created_at: DATE,
    });
  });

  it("community_posts", () => {
    expect(cols("community_posts")).toEqual({
      uid: TEXT, restaurant_id: TEXT, item_id: TEXT, photo_path: TEXT, thumb_path: TEXT, source: TEXT, status: TEXT,
      on_tv: BOOL, hidden_at: DATE, created_at: DATE,
    });
  });

  it("community_tvs guarda só o hash do segredo e o código curto", () => {
    expect(cols("community_tvs")).toEqual({
      uid: TEXT, restaurant_id: TEXT, label: TEXT, pair_code: TEXT, pair_expires_at: DATE, secret_hash: TEXT,
      paired_at: DATE, last_seen_at: DATE, revoked: BOOL, created_at: DATE,
    });
  });

  it("community_tally com as listas de mesas em JSON", () => {
    expect(cols("community_tally")).toEqual({
      uid: TEXT, restaurant_id: TEXT, day: TEXT, counts: JSONT, tables_qr: JSONT, tables_open: JSONT, created_at: DATE,
    });
  });
});
