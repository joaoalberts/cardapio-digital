import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { HOUSE_MP4, mediaDuration } from "./fake-mux.mjs";
import { HOUSE_MUX, RESTAURANT_FIELDS, SEED_IDS, TRACKED, assertLocalNocodb, buildSeed, run, undoPlan } from "./seed-local.mjs";

// O seed do Apareça só mexe no NocoDB do Docker: qualquer outro endereço é recusado antes de
// qualquer chamada. O que ele liga e cria, o --desfazer devolve.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RID = "3a5d9359-aa1a-4065-996a-2105d88a802f";
const TABLE = "9a287527-f493-4837-ac2a-ba062e09dabf";
const NOW = new Date("2026-10-17T21:30:20.456Z");
const SECRETS = { bar: "a".repeat(64), salao: "b".repeat(64) };
const seed = () => buildSeed({ rid: RID, tableId: TABLE, now: NOW, houseMs: 8_000, secrets: SECRETS });

describe("recusa NocoDB que não é local", () => {
  it("assertLocalNocodb recusa a nuvem e aceita só http://localhost", () => {
    expect(() => assertLocalNocodb("https://app.nocodb.com")).toThrow(/Recusado/);
    expect(() => assertLocalNocodb("http://127.0.0.1:8080")).toThrow();
    expect(assertLocalNocodb("http://localhost:8080")).toBe("http://localhost:8080");
  });

  it("run com https://app.nocodb.com lança sem nenhuma chamada de rede", async () => {
    const fetchSpy = vi.fn();
    await expect(run({ NOCODB_URL: "https://app.nocodb.com", NOCODB_API_TOKEN: "x" }, [], fetchSpy, () => {})).rejects.toThrow(/Recusado/);
    await expect(run({ NOCODB_URL: "https://app.nocodb.com", NOCODB_API_TOKEN: "x" }, ["--desfazer"], fetchSpy, () => {})).rejects.toThrow(/Recusado/);
    await expect(run({ NOCODB_API_TOKEN: "x" }, [], fetchSpy, () => {})).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("buildSeed", () => {
  it("liga o Apareça e cria as zonas Salão e Bar com a mesa no Bar", () => {
    const s = seed();
    expect(s.restaurant).toMatchObject({ apareca_allowed: true, apareca_enabled: true });
    const cfg = s.restaurant.apareca_config;
    expect(cfg.zones).toEqual([
      { id: SEED_IDS.zoneSalao, name: "Salão" },
      { id: SEED_IDS.zoneBar, name: "Bar" },
    ]);
    expect(cfg.table_zones).toEqual({ [TABLE]: SEED_IDS.zoneBar });
    expect(cfg.tv_zones).toEqual({ [SEED_IDS.tvBar]: SEED_IDS.zoneBar, [SEED_IDS.tvSalao]: SEED_IDS.zoneSalao });
    expect(cfg).toMatchObject({ mode: "manual", plays: 1, retention_h: 6, device_per_hour: 2, hours: null }); // padrão 1, como o painel (A1)
    expect(cfg.rule).toEqual({ kind: "intercalar", house_every: 1, clients_max: 3 });
  });

  it("2 institucionais ready, ativos, na ordem, apontando para o Mux falso", () => {
    const { house } = seed();
    expect(house).toHaveLength(2);
    house.forEach((h, k) => {
      expect(h).toMatchObject({ restaurant_id: RID, status: "ready", active: true, position: k + 1, duration_ms: 8_000 });
      expect(h.mux_playback_id).toBe(HOUSE_MUX[k].playback);
      expect(h.mux_playback_id).toMatch(/^[A-Za-z0-9]+$/);
    });
  });

  it("2 TVs pareadas com o hash do segredo (nunca o segredo)", () => {
    const { tvs } = seed();
    expect(tvs.map((t) => t.uid)).toEqual([SEED_IDS.tvBar, SEED_IDS.tvSalao]);
    expect(tvs[0].secret_hash).toBe(createHash("sha256").update(SECRETS.bar).digest("hex"));
    for (const t of tvs) {
      expect(t).toMatchObject({ restaurant_id: RID, revoked: false, pair_code: null });
      expect(t.paired_at).toMatch(/:\d\dZ$/);
      expect(JSON.stringify(t)).not.toContain(SECRETS.bar);
      expect(JSON.stringify(t)).not.toContain(SECRETS.salao);
    }
  });

  it("uids fixos e válidos; mantém chaves desconhecidas da config de antes; exibições de 1 a 3", () => {
    const ids = [SEED_IDS.zoneSalao, SEED_IDS.zoneBar, ...SEED_IDS.house, SEED_IDS.tvBar, SEED_IDS.tvSalao];
    for (const id of ids) expect(id).toMatch(UUID);
    expect(new Set(ids).size).toBe(ids.length);
    const kept = buildSeed({ rid: RID, tableId: TABLE, now: NOW, houseMs: 1, secrets: SECRETS, config: { futuro: 1, mode: "automatico" } });
    expect(kept.restaurant.apareca_config).toMatchObject({ futuro: 1, mode: "manual" });
    expect(buildSeed({ rid: RID, tableId: TABLE, now: NOW, houseMs: 1, secrets: SECRETS, plays: 2 }).restaurant.apareca_config.plays).toBe(2);
    expect(() => buildSeed({ rid: RID, tableId: TABLE, now: NOW, houseMs: 1, secrets: SECRETS, plays: 4 })).toThrow();
  });
});

describe("undoPlan", () => {
  it("devolve os interruptores e a config de antes e apaga só as linhas novas", () => {
    const before = {
      restaurant: { apareca_allowed: false, apareca_enabled: false, apareca_config: null },
      ids: { apareca_videos: [], community_tvs: [1, 2, 3] },
    };
    const current = {
      apareca_videos: [{ Id: 10 }, { Id: 11 }],
      community_tvs: [{ Id: 1 }, { Id: 2 }, { Id: 3 }, { Id: 40 }, { Id: 41 }],
      apareca_house_videos: [{ Id: 5 }],
    };
    const plan = undoPlan({ before, current });
    expect(plan.restaurant).toEqual({ apareca_allowed: false, apareca_enabled: false, apareca_config: null });
    expect(Object.keys(plan.restaurant)).toEqual(RESTAURANT_FIELDS);
    expect(plan.remove).toEqual({ apareca_videos: [10, 11], community_tvs: [40, 41], apareca_house_videos: [5] });
    expect(TRACKED).toContain("apareca_tally");
  });
});

describe("mediaDuration (Mux falso)", () => {
  it("lê a duração do MP4 dos institucionais e recusa lixo", () => {
    expect(mediaDuration(readFileSync(HOUSE_MP4))).toBeGreaterThan(1);
    expect(mediaDuration(Buffer.from("isto não é vídeo nenhum"))).toBeNull();
    expect(mediaDuration(Buffer.alloc(4))).toBeNull();
  });

  it("lê WebM do MediaRecorder (tamanho desconhecido, sem Duration) pelos blocos", () => {
    // EBML mínimo: cabeçalho, Segment e Cluster de tamanho desconhecido, Timecode 5000 e um SimpleBlock +970 ms.
    const ebmlHeader = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80]);
    const segment = Buffer.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    const cluster = Buffer.from([0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    const timecode = Buffer.from([0xe7, 0x82, 0x13, 0x88]); // 5000
    const block = Buffer.from([0xa3, 0x85, 0x81, 0x03, 0xca, 0x80, 0x00]); // trilha 1, +970
    const s = mediaDuration(Buffer.concat([ebmlHeader, segment, cluster, timecode, block]));
    expect(s).toBeCloseTo(5.97, 2);
  });
});
