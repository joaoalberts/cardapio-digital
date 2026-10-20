import { describe, expect, it } from "vitest";
import { TABLES } from "./setup.mjs";

// O esquema do NocoDB é a fonte das tabelas das TVs e do Apareça.
type Col = { column_name: string; uidt: string };
const tables = TABLES as unknown as Record<string, Col[]>;
const cols = (t: string) => Object.fromEntries((tables[t] ?? []).map((c) => [c.column_name, c.uidt]));

const TEXT = "SingleLineText", LONG = "LongText", BOOL = "Checkbox", JSONT = "JSON", DATE = "DateTime";

describe("setup.mjs: esquema", () => {
  it("importar não roda o script (nem pede o token)", () => {
    expect(Object.keys(tables)).toContain("restaurants");
  });

  it("restaurants guarda o modo simples do telão; orders ganha discarded", () => {
    expect(cols("restaurants")).toMatchObject({ community_tv_simple: BOOL });
    expect(cols("orders")).toMatchObject({ discarded: BOOL });
  });

  it("items ganha subgroup (Cardápio em lista)", () => {
    expect(cols("items")).toMatchObject({ subgroup: TEXT });
  });

  it("categories ganha doughs (massa da pizza)", () => {
    expect(cols("categories")).toMatchObject({ doughs: JSONT });
  });

  it("community_tvs guarda só o hash do segredo e o código curto", () => {
    expect(cols("community_tvs")).toEqual({
      uid: TEXT, restaurant_id: TEXT, label: TEXT, pair_code: TEXT, pair_expires_at: DATE, secret_hash: TEXT,
      paired_at: DATE, last_seen_at: DATE, revoked: BOOL, created_at: DATE,
    });
  });

  it("Apareça na TV: tabelas novas", () => {
    expect(cols("apareca_videos")).toEqual({
      uid: TEXT, restaurant_id: TEXT, kind: TEXT, table_id: TEXT, zone_id: TEXT, device_id: TEXT, name: TEXT,
      consent_at: DATE, mux_upload_id: TEXT, mux_asset_id: TEXT, mux_playback_id: TEXT, duration_ms: "Number",
      status: TEXT, decided_by: TEXT, decided_at: DATE, ai_reason: LONG, plays: "Number", plays_target: "Number",
      first_shown_at: DATE, downloads: "Number", expires_at: DATE, created_at: DATE,
    });
    expect(cols("apareca_house_videos")).toEqual({
      uid: TEXT, restaurant_id: TEXT, title: TEXT, mux_upload_id: TEXT, mux_asset_id: TEXT, mux_playback_id: TEXT,
      duration_ms: "Number", aspect: TEXT, position: "Number", active: BOOL, status: TEXT, created_at: DATE,
    });
    expect(cols("apareca_tally")).toEqual({
      uid: TEXT, restaurant_id: TEXT, day: TEXT, month: TEXT, counts: JSONT, hours: JSONT, created_at: DATE,
    });
  });

  it("restaurants ganha os interruptores do Apareça", () => {
    expect(cols("restaurants")).toMatchObject({
      apareca_allowed: BOOL, apareca_ai_allowed: BOOL, apareca_enabled: BOOL, apareca_config: JSONT,
    });
  });
});
