import { beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/comunidade/tv";
import { DEFAULT_CONFIG } from "./config";
import { programFor } from "./schedule";
import {
  heartbeat, identifyTv, reportPlay, resetTvMemory, type AparecaTvDeps, type TvAppDb, type TvIdentity,
} from "./tv";
import type { AparecaConfig, AparecaHead, HouseVideoRow, VideoRow } from "./types";

const RID = "11111111-1111-4111-8111-111111111111";
const OTHER_RID = "22222222-2222-4222-8222-222222222222";
const TV1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const TV2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const ZONE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const V1 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const H1 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const P = (n: number) => `eeeeeeee-eeee-4eee-8eee-${String(n).padStart(12, "0")}`;
const SECRET_A = "a".repeat(64);
const SECRET_B = "b".repeat(64);
const SECRET_C = "c".repeat(64);
const SECRET_D = "d".repeat(64);
const T0 = Date.parse("2026-10-16T22:00:00Z");

type Raw = Record<string, unknown>;
type Tables = Record<string, Raw[]>;

function fakeDb(tables: Tables) {
  const calls = { list: 0, writes: [] as { t: string; patch: Raw }[], inserts: [] as { t: string; rows: Raw[] }[] };
  const match = (r: Raw, w: Raw) => Object.entries(w).every(([k, v]) => (k === "uid" ? r.id === v : r[k] === v));
  const db: TvAppDb = {
    async list<T>(t: string, w: Raw) {
      calls.list += 1;
      return (tables[t] ?? []).filter((r) => match(r, w)).map((r) => ({ ...r })) as T[];
    },
    async update(t: string, w: Raw, p: Raw) {
      const rows = (tables[t] ?? []).filter((r) => match(r, w));
      for (const r of rows) Object.assign(r, p);
      calls.writes.push({ t, patch: p });
      return rows.length;
    },
    async updateRows(t: string, rows: ({ Id: number } & Raw)[]) {
      for (const p of rows) {
        const r = (tables[t] ?? []).find((x) => x.Id === p.Id);
        if (r) Object.assign(r, p);
        calls.writes.push({ t, patch: p });
      }
    },
    async insert(t: string, rows: Raw[]) {
      (tables[t] ??= []).push(...rows);
      calls.inserts.push({ t, rows });
      return rows;
    },
  };
  return { db, calls };
}

const cfg = (over: Partial<AparecaConfig> = {}): AparecaConfig => ({
  ...DEFAULT_CONFIG, zones: [{ id: ZONE, name: "Bar" }], tv_zones: { [TV1]: ZONE }, ...over,
});
const headOf = (over: Partial<AparecaHead> = {}): AparecaHead => ({
  id: RID, slug: "forno", name: "Forno", timezone: "America/Sao_Paulo", opening_hours: null, allowed: true,
  ai_allowed: false, enabled: true, community_enabled: true, config: cfg(), logo_path: null, brand_color: null,
  instagram: null, ...over,
});

async function tvRow(n: number, id: string, secret: string, over: Raw = {}): Promise<Raw> {
  return {
    Id: n, id, restaurant_id: RID, secret_hash: await sha256Hex(secret), pair_code: null,
    paired_at: "2026-10-16 20:00:00+00:00", revoked: false, ...over,
  };
}
const vid = (over: Partial<VideoRow> = {}): VideoRow => ({
  Id: 1, id: V1, restaurant_id: RID, kind: "cliente", table_id: null, zone_id: ZONE, device_id: "d", name: null,
  consent_at: "2026-10-16T21:00:00Z", mux_upload_id: "u1", mux_asset_id: "a1", mux_playback_id: "p1",
  duration_ms: 6000, status: "approved", decided_by: "equipe", decided_at: "2026-10-16T21:01:00Z", ai_reason: null,
  plays: 0, plays_target: 1, first_shown_at: null, downloads: 0, expires_at: "2026-10-17T04:00:00Z",
  created_at: "2026-10-16T21:00:00Z", ...over,
});
const house = (over: Partial<HouseVideoRow> = {}): HouseVideoRow => ({
  Id: 1, id: H1, restaurant_id: RID, title: "Casa", mux_upload_id: "hu", mux_asset_id: "ha", mux_playback_id: "hp",
  duration_ms: 30_000, aspect: "16:9", position: 1, active: true, status: "ready", created_at: "2026-10-01T00:00:00Z",
  ...over,
});

async function setup(o: { tvs?: Raw[]; videos?: Raw[]; head?: AparecaHead | null; houses?: HouseVideoRow[] } = {}) {
  const tables: Tables = {
    community_tvs: o.tvs ?? [await tvRow(1, TV1, SECRET_A), await tvRow(2, TV2, SECRET_B)],
    apareca_videos: o.videos ?? [vid() as unknown as Raw],
    apareca_tally: [],
  };
  const { db, calls } = fakeDb(tables);
  let t = T0;
  const forgot: string[] = [];
  const deps: AparecaTvDeps = {
    db,
    getHead: async (slug) => (slug === "forno" ? (o.head === undefined ? headOf() : o.head) : null),
    now: () => new Date(t),
    forget: (rid) => void forgot.push(rid),
    getHouse: async () => o.houses ?? [house()],
  };
  return { deps, calls, tables, forgot, advance: (ms: number) => void (t += ms) };
}

const tv1: TvIdentity = { tvId: TV1, restaurantId: RID, zone: ZONE };
const tv2: TvIdentity = { tvId: TV2, restaurantId: RID, zone: ZONE };

beforeEach(() => resetTvMemory());

describe("identifyTv", () => {
  it("TV pareada: identidade com a zona de tv_zones", async () => {
    const s = await setup();
    expect(await identifyTv(s.deps, "forno", SECRET_A)).toEqual({ tvId: TV1, restaurantId: RID, zone: ZONE });
    expect(await identifyTv(s.deps, "forno", SECRET_B)).toEqual({ tvId: TV2, restaurantId: RID, zone: null });
  });
  it("segredo de TV de outro restaurante → 401", async () => {
    const s = await setup({ tvs: [await tvRow(1, TV1, SECRET_A, { restaurant_id: OTHER_RID })] });
    expect(await identifyTv(s.deps, "forno", SECRET_A)).toEqual({ status: 401 });
  });
  it("TV revogada → 401", async () => {
    const s = await setup({ tvs: [await tvRow(1, TV1, SECRET_A, { revoked: true })] });
    expect(await identifyTv(s.deps, "forno", SECRET_A)).toEqual({ status: 401 });
  });
  it("TV pendente (sem paired_at) → 401", async () => {
    const s = await setup({ tvs: [await tvRow(1, TV1, SECRET_A, { paired_at: null, pair_code: "ABCDEF" })] });
    expect(await identifyTv(s.deps, "forno", SECRET_A)).toEqual({ status: 401 });
  });
  it("mutação: o hash guardado no lugar do segredo → 401", async () => {
    const s = await setup();
    expect(await identifyTv(s.deps, "forno", await sha256Hex(SECRET_A))).toEqual({ status: 401 });
  });
  it("sem segredo, segredo torto ou desconhecido → 401", async () => {
    const s = await setup();
    expect(await identifyTv(s.deps, "forno", null)).toEqual({ status: 401 });
    expect(await identifyTv(s.deps, "forno", "xyz")).toEqual({ status: 401 });
    expect(await identifyTv(s.deps, "forno", SECRET_C)).toEqual({ status: 401 });
  });
  it("slug sem restaurante → 404", async () => {
    const s = await setup();
    expect(await identifyTv(s.deps, "outro", SECRET_A)).toEqual({ status: 404 });
  });
  it("a segunda identificação em 5 min não chama o banco; depois de 5 min, chama", async () => {
    const s = await setup();
    await identifyTv(s.deps, "forno", SECRET_A);
    const before = s.calls.list;
    s.advance(4 * 60_000);
    expect(await identifyTv(s.deps, "forno", SECRET_A)).toEqual(tv1);
    expect(s.calls.list).toBe(before);
    s.advance(61_000);
    await identifyTv(s.deps, "forno", SECRET_A);
    expect(s.calls.list).toBe(before + 1);
  });
  it("a zona vem da config de agora, mesmo com a identidade em cache", async () => {
    let head = headOf();
    const s = await setup();
    s.deps.getHead = async () => head;
    await identifyTv(s.deps, "forno", SECRET_A);
    head = headOf({ config: cfg({ tv_zones: {} }) });
    expect(await identifyTv(s.deps, "forno", SECRET_A)).toEqual({ tvId: TV1, restaurantId: RID, zone: null });
  });
  it("não guarda 401: TV pareada depois responde na hora", async () => {
    const s = await setup({ tvs: [await tvRow(1, TV1, SECRET_D, { paired_at: null })] });
    expect(await identifyTv(s.deps, "forno", SECRET_D)).toEqual({ status: 401 });
    s.tables.community_tvs[0].paired_at = "2026-10-16 22:00:00+00:00";
    expect(await identifyTv(s.deps, "forno", SECRET_D)).toEqual(tv1);
  });
});

describe("heartbeat", () => {
  it("12 vezes em 60 s grava 1 vez; aos 61 s grava de novo", async () => {
    const s = await setup();
    for (let i = 0; i < 12; i++) {
      await heartbeat(s.deps, tv1);
      s.advance(5_000);
    }
    const seen = () => s.calls.writes.filter((w) => w.t === "community_tvs");
    expect(seen()).toHaveLength(1);
    expect(s.tables.community_tvs[0].last_seen_at).toBe(new Date(T0).toISOString());
    s.advance(1_000); // agora T0 + 61 s
    await heartbeat(s.deps, tv1);
    expect(seen()).toHaveLength(2);
    expect(s.tables.community_tvs[0].last_seen_at).toBe(new Date(T0 + 61_000).toISOString());
  });
  it("cada TV tem o seu relógio", async () => {
    const s = await setup();
    await heartbeat(s.deps, tv1);
    await heartbeat(s.deps, tv2);
    expect(s.calls.writes.filter((w) => w.t === "community_tvs")).toHaveLength(2);
  });
  it("gravação que falhou tenta de novo na próxima", async () => {
    const s = await setup();
    const real = { update: s.deps.db.update, updateRows: s.deps.db.updateRows };
    s.deps.db.update = async () => { throw new Error("nocodb"); };
    s.deps.db.updateRows = async () => { throw new Error("nocodb"); };
    await expect(heartbeat(s.deps, tv1)).rejects.toThrow();
    Object.assign(s.deps.db, real);
    await heartbeat(s.deps, tv1);
    expect(s.tables.community_tvs[0].last_seen_at).toBe(new Date(T0).toISOString());
  });
});

describe("reportPlay", () => {
  const row = (s: Awaited<ReturnType<typeof setup>>) => s.tables.apareca_videos[0] as unknown as VideoRow;

  it("soma plays e grava first_shown_at só na primeira vez", async () => {
    const s = await setup({ videos: [vid({ plays_target: 3 }) as unknown as Raw] });
    expect(await reportPlay(s.deps, tv1, { video: V1, play: P(1) })).toEqual({ ok: true });
    expect(row(s).plays).toBe(1);
    expect(row(s).first_shown_at).toBe(new Date(T0).toISOString());
    s.advance(30_000);
    expect(await reportPlay(s.deps, tv1, { video: V1, play: P(2) })).toEqual({ ok: true });
    expect(row(s).plays).toBe(2);
    expect(row(s).first_shown_at).toBe(new Date(T0).toISOString());
    expect(s.forgot).toEqual([RID, RID]);
  });
  it("o mesmo play repetido (nova tentativa de rede) conta 1 vez", async () => {
    const s = await setup({ videos: [vid({ plays_target: 3 }) as unknown as Raw] });
    await reportPlay(s.deps, tv1, { video: V1, play: P(1) });
    expect(await reportPlay(s.deps, tv1, { video: V1, play: P(1) })).toEqual({ ok: true });
    expect(row(s).plays).toBe(1);
  });
  it("relê a linha antes de gravar (outra instância já somou)", async () => {
    const s = await setup({ videos: [vid({ plays_target: 3 }) as unknown as Raw] });
    await reportPlay(s.deps, tv1, { video: V1, play: P(1) });
    row(s).plays = 5; // outra instância gravou nesse meio-tempo
    await reportPlay(s.deps, tv2, { video: V1, play: P(2) });
    expect(row(s).plays).toBe(6);
  });
  it("duas TVs da zona com plays_target 1: plays 2 é aceito e o vídeo sai da próxima programação", async () => {
    const s = await setup();
    expect(await reportPlay(s.deps, tv1, { video: V1, play: P(1) })).toEqual({ ok: true });
    expect(await reportPlay(s.deps, tv2, { video: V1, play: P(2) })).toEqual({ ok: true });
    expect(row(s).plays).toBe(2);
    const p = programFor({ cfg: cfg(), tvZone: ZONE, videos: [row(s)], house: [] });
    expect(p.clients).toEqual([]);
  });
  it("vídeo não approved → {ok:false} e nada gravado", async () => {
    for (const status of ["pending", "ai_review", "rejected", "removed", "failed", "processing", "uploading"] as const) {
      const s = await setup({ videos: [vid({ status }) as unknown as Raw] });
      expect(await reportPlay(s.deps, tv1, { video: V1, play: P(1) })).toEqual({ ok: false });
      expect(s.calls.writes).toEqual([]);
      expect(row(s).plays).toBe(0);
      expect(s.forgot).toEqual([]);
    }
  });
  it("vídeo de outro restaurante → {ok:false} e nada gravado", async () => {
    const s = await setup({ videos: [vid({ restaurant_id: OTHER_RID }) as unknown as Raw] });
    expect(await reportPlay(s.deps, tv1, { video: V1, play: P(1) })).toEqual({ ok: false });
    expect(s.calls.writes).toEqual([]);
  });
  it("corpo torto → {ok:false} sem ler o banco", async () => {
    const s = await setup();
    for (const body of [null, "x", {}, { video: V1 }, { video: "v1", play: P(1) }, { video: V1, play: "1" }, [V1, P(1)]]) {
      expect(await reportPlay(s.deps, tv1, body)).toEqual({ ok: false });
    }
    expect(s.calls.list).toBe(0);
  });
  it("play recusado não fica marcado: se o vídeo for aprovado, o mesmo play conta", async () => {
    const s = await setup({ videos: [vid({ status: "pending" }) as unknown as Raw] });
    expect(await reportPlay(s.deps, tv1, { video: V1, play: P(1) })).toEqual({ ok: false });
    row(s).status = "approved";
    expect(await reportPlay(s.deps, tv1, { video: V1, play: P(1) })).toEqual({ ok: true });
    expect(row(s).plays).toBe(1);
  });
});

describe("reportPlay: institucional soma no uso do mês", () => {
  it("acumula a duração e grava uma linha de tally sem dado pessoal a cada 10 min", async () => {
    const s = await setup();
    await identifyTv(s.deps, "forno", SECRET_A); // guarda o fuso do restaurante
    expect(await reportPlay(s.deps, tv1, { video: H1, play: P(1), kind: "house" })).toEqual({ ok: true });
    s.advance(30_000);
    await reportPlay(s.deps, tv1, { video: H1, play: P(2), kind: "house" });
    await reportPlay(s.deps, tv1, { video: H1, play: P(2), kind: "house" }); // repetido
    expect(s.calls.inserts).toEqual([]);
    s.advance(10 * 60_000);
    await reportPlay(s.deps, tv1, { video: H1, play: P(3), kind: "house" });
    expect(s.calls.inserts).toEqual([{
      t: "apareca_tally",
      rows: [{ restaurant_id: RID, day: "2026-10-16", month: "2026-10", counts: { played_s: 90 }, hours: Array(24).fill(0) }],
    }]);
    expect(s.tables.apareca_videos[0].plays).toBe(0); // institucional não mexe nos vídeos de clientes
  });
  it("institucional inexistente, inativo ou de outro restaurante → {ok:false}", async () => {
    for (const houses of [[], [house({ active: false })], [house({ restaurant_id: OTHER_RID })]]) {
      const s = await setup({ houses });
      expect(await reportPlay(s.deps, tv1, { video: H1, play: P(1), kind: "house" })).toEqual({ ok: false });
    }
  });
});
