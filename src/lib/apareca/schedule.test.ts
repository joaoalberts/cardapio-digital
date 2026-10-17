import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "./config";
import { nextSlot, programFor, zoneOf, type Cursor, type Program } from "./schedule";
import type { AparecaConfig, HouseVideoRow, VideoRow, VideoStatus } from "./types";

const vid = (n: number, over: Partial<VideoRow> = {}): VideoRow => ({
  Id: n, id: `v${n}`, restaurant_id: "r", kind: "cliente", table_id: null, zone_id: null, device_id: "d",
  name: null, consent_at: "2026-10-16T10:00:00Z", mux_upload_id: `u${n}`, mux_asset_id: `a${n}`,
  mux_playback_id: `p${n}`, duration_ms: 6000, status: "approved", decided_by: "equipe",
  decided_at: `2026-10-16T10:0${n}:00Z`, ai_reason: null, plays: 0, plays_target: 1, first_shown_at: null,
  downloads: 0, expires_at: "2026-10-16T16:00:00Z", created_at: "2026-10-16T10:00:00Z", ...over,
});
const hv = (n: number, over: Partial<HouseVideoRow> = {}): HouseVideoRow => ({
  Id: n, id: `h${n}`, restaurant_id: "r", title: `H${n}`, mux_upload_id: `hu${n}`, mux_asset_id: `ha${n}`,
  mux_playback_id: `hp${n}`, duration_ms: 10000, aspect: "16:9", position: n, active: true, status: "ready",
  created_at: "2026-10-16T09:00:00Z", ...over,
});
const cfg = (over: Partial<AparecaConfig> = {}): AparecaConfig => ({ ...DEFAULT_CONFIG, ...over });
const zonas = { zones: [{ id: "bar", name: "Bar" }, { id: "salao", name: "Salão" }] };

describe("programFor: nunca sem aprovação", () => {
  it("só approved entra", () => {
    const statuses: VideoStatus[] = ["pending", "ai_review", "rejected", "removed", "failed", "uploading", "processing"];
    const videos = [...statuses.map((s, i) => vid(i + 1, { status: s })), vid(9)];
    const p = programFor({ cfg: cfg(), tvZone: null, videos, house: [] });
    expect(p.clients.map((c) => c.id)).toEqual(["v9"]);
  });
  it("approved sem mux_playback_id fica de fora", () => {
    const p = programFor({ cfg: cfg(), tvZone: null, videos: [vid(1, { mux_playback_id: null }), vid(2)], house: [] });
    expect(p.clients.map((c) => c.id)).toEqual(["v2"]);
  });
  it("plays_left e esgotados", () => {
    const p = programFor({
      cfg: cfg(), tvZone: null, house: [],
      videos: [vid(1, { plays: 1, plays_target: 3 }), vid(2, { plays: 3, plays_target: 3 }), vid(3, { plays: 4, plays_target: 3 })],
    });
    expect(p.clients).toEqual([expect.objectContaining({ id: "v1", plays_left: 2, playback: "p1" })]);
  });
  it("devolve regra e plays do cfg", () => {
    const p = programFor({ cfg: cfg({ plays: 2 }), tvZone: null, videos: [], house: [] });
    expect(p.plays).toBe(2);
    expect(p.rule).toEqual(DEFAULT_CONFIG.rule);
  });
});

describe("zonas", () => {
  const c = cfg({ ...zonas, table_zones: { m1: "bar", m2: "salao", m3: "apagada" }, tv_zones: { t1: "bar", t2: "apagada" } });
  it("zoneOf", () => {
    expect(zoneOf(c, "table", "m1")).toBe("bar");
    expect(zoneOf(c, "tv", "t1")).toBe("bar");
    expect(zoneOf(c, "table", "m9")).toBeNull();
    expect(zoneOf(c, "table", null)).toBeNull();
  });
  it("Foco 3: zona apagada vale como sem zona", () => {
    expect(zoneOf(c, "table", "m3")).toBeNull();
    expect(zoneOf(c, "tv", "t2")).toBeNull();
  });
  it("TV do Bar recebe Bar e sem zona, não o Salão", () => {
    const videos = [vid(1, { zone_id: "bar" }), vid(2, { zone_id: "salao" }), vid(3, { zone_id: null })];
    const p = programFor({ cfg: c, tvZone: "bar", videos, house: [] });
    expect(p.clients.map((x) => x.id)).toEqual(["v1", "v3"]);
  });
  it("TV sem zona recebe todos", () => {
    const videos = [vid(1, { zone_id: "bar" }), vid(2, { zone_id: "salao" }), vid(3)];
    expect(programFor({ cfg: c, tvZone: null, videos, house: [] }).clients).toHaveLength(3);
  });
  it("Foco 3: vídeo com zona apagada aparece em todas as TVs", () => {
    const p = programFor({ cfg: c, tvZone: "salao", videos: [vid(1, { zone_id: "apagada" })], house: [] });
    expect(p.clients.map((x) => x.id)).toEqual(["v1"]);
  });
  it("TV com zona apagada recebe tudo", () => {
    const videos = [vid(1, { zone_id: "bar" }), vid(2, { zone_id: "salao" })];
    expect(programFor({ cfg: c, tvZone: "apagada", videos, house: [] }).clients).toHaveLength(2);
  });
});

describe("house", () => {
  it("só active e ready, por position", () => {
    const house = [
      hv(3, { position: 3 }), hv(1, { position: 1 }), hv(2, { active: false }),
      hv(4, { status: "processing" }), hv(5, { status: "failed" }), hv(6, { mux_playback_id: null }),
    ];
    const p = programFor({ cfg: cfg(), tvZone: null, videos: [], house });
    expect(p.house.map((h) => h.id)).toEqual(["h1", "h3"]);
    expect(p.house[0]).toEqual({ id: "h1", playback: "hp1", aspect: "16:9", duration_s: 10 });
  });
});

describe("nextSlot", () => {
  const start: Cursor = { houseIdx: 0, clientsSinceHouse: 0, playedHere: {} };
  const run = (p: Program, n: number) => {
    let cur = start;
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const s = nextSlot(p, cur);
      if (!s) break;
      out.push(s.clip.id);
      cur = s.cursor;
    }
    return out;
  };
  const prog = (nh: number, nc: number): Program =>
    programFor({
      cfg: cfg(), tvZone: null,
      house: Array.from({ length: nh }, (_, i) => hv(i + 1)),
      videos: Array.from({ length: nc }, (_, i) => vid(i + 1)),
    });

  it("regra padrão com 5 clientes: H, 3, H, 2, H", () => {
    expect(run(prog(1, 5), 9)).toEqual(["h1", "v1", "v2", "v3", "h1", "v4", "v5", "h1", "v1"]);
  });
  it("sem institucionais: só clientes em sequência", () => {
    expect(run(prog(0, 3), 5)).toEqual(["v1", "v2", "v3", "v1", "v2"]);
  });
  it("sem clientes: institucionais em loop", () => {
    expect(run(prog(2, 0), 5)).toEqual(["h1", "h2", "h1", "h2", "h1"]);
  });
  it("nada: null", () => {
    expect(nextSlot(prog(0, 0), start)).toBeNull();
  });
  it("não repete cliente antes de passar pelos outros (playedHere)", () => {
    const s = nextSlot(prog(0, 3), { houseIdx: 0, clientsSinceHouse: 0, playedHere: { v1: 1, v2: 0, v3: 1 } });
    expect(s?.clip.id).toBe("v2");
    expect(s?.cursor.playedHere.v2).toBe(1);
  });
  it("institucionais alternam pelo houseIdx", () => {
    expect(run(prog(2, 1), 6)).toEqual(["h1", "v1", "h2", "v1", "h1", "v1"]);
  });
  it("não muta o cursor recebido", () => {
    const cur: Cursor = { houseIdx: 0, clientsSinceHouse: 0, playedHere: {} };
    nextSlot(prog(1, 2), cur);
    expect(cur).toEqual({ houseIdx: 0, clientsSinceHouse: 0, playedHere: {} });
  });
  it("house_every 2 toca dois institucionais antes dos clientes", () => {
    const p = { ...prog(2, 2), rule: { kind: "intercalar", house_every: 2, clients_max: 3 } as const };
    expect(run(p, 6)).toEqual(["h1", "h2", "v1", "v2", "h1", "h2"]);
  });
});
