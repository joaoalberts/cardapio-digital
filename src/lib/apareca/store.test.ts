// Retrato da fila do Apareça com o banco e o Mux falsos: prova a memória de 5 s, que o vencido
// nunca aparece e é apagado uma vez só (asset no Mux, depois o relatório, depois a linha),
// e a soma do mês para o teto do Mux.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AparecaTallyRow, HouseVideoRow, VideoRow } from "./types";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  type Where = Record<string, unknown>;
  const store: Record<string, Row[]> = {};
  const log: string[] = [];
  const match = (r: Row, w: Where) => Object.entries(w).every(([k, v]) => (r[k] ?? null) === v);
  const db = {
    list: vi.fn(async (t: string, w: Where = {}) => {
      log.push(`list:${t}`);
      return (store[t] ?? []).filter((r) => match(r, w)).map((r) => ({ ...r }));
    }),
    first: vi.fn(async (t: string, w: Where) => {
      log.push(`first:${t}`);
      const r = (store[t] ?? []).find((x) => match(x, w));
      return r ? { ...r } : null;
    }),
    insert: vi.fn(async (t: string, rows: Row[]) => {
      log.push(`insert:${t}`);
      const full = rows.map((r) => ({ uid: crypto.randomUUID(), created_at: new Date().toISOString(), ...r }));
      (store[t] ??= []).push(...full);
      return full.map((r) => ({ ...r, id: r.uid }));
    }),
    removeIds: vi.fn(async (t: string, ids: number[]) => {
      log.push(`removeIds:${t}:${ids.join(",")}`);
      store[t] = (store[t] ?? []).filter((r) => !ids.includes(r.Id as number));
    }),
  };
  return { store, log, db };
});

vi.mock("@/lib/db/nocodb", () => h.db);

type Store = typeof import("./store");
let S: Store;

const RID = "00000000-0000-4000-8000-000000000001";
const RID2 = "00000000-0000-4000-8000-000000000002";
const T0 = new Date("2026-10-16T15:00:00.000Z");

let seq = 0;
function video(p: Partial<VideoRow> = {}): VideoRow {
  seq += 1;
  return {
    Id: seq, id: `v-${seq}`, restaurant_id: RID, kind: "cliente", table_id: null, zone_id: null,
    device_id: "d", name: null, consent_at: "2026-10-16T14:00:00.000Z", mux_upload_id: `up-${seq}`,
    mux_asset_id: `as-${seq}`, mux_playback_id: `pb-${seq}`, duration_ms: 6_000, status: "approved",
    decided_by: "equipe", decided_at: null, ai_reason: null, plays: 1, plays_target: 1, first_shown_at: null,
    downloads: 0, expires_at: "2026-10-16T20:00:00.000Z", created_at: "2026-10-16T14:00:00.000Z", ...p,
  };
}
const expired = (p: Partial<VideoRow> = {}) => video({ expires_at: "2026-10-16T14:59:00.000Z", ...p });

function house(p: Partial<HouseVideoRow> = {}): HouseVideoRow {
  seq += 1;
  return {
    Id: seq, id: `h-${seq}`, restaurant_id: RID, title: "casa", mux_upload_id: `hu-${seq}`, mux_asset_id: `ha-${seq}`,
    mux_playback_id: `hp-${seq}`, duration_ms: 30_000, aspect: "16:9", position: 0, active: true, status: "ready",
    created_at: "2026-09-01T00:00:00.000Z", ...p,
  };
}

function tally(p: Partial<AparecaTallyRow> & { counts: AparecaTallyRow["counts"] }): AparecaTallyRow {
  return { id: crypto.randomUUID(), restaurant_id: RID, day: "2026-10-10", month: "2026-10", hours: [], created_at: "", ...p };
}

function deps(
  over: { now?: () => Date; deleteAsset?: (id: string) => Promise<void>; releaseUpload?: (id: string) => Promise<void> } = {},
) {
  const deferred: (() => Promise<void>)[] = [];
  const deleteAsset = vi.fn(
    over.deleteAsset ??
      (async (id: string) => {
        h.log.push(`mux:${id}`);
      }),
  );
  const releaseUpload = vi.fn(
    over.releaseUpload ??
      (async (id: string) => {
        h.log.push(`upload:${id}`);
      }),
  );
  const d = {
    db: h.db as unknown as import("./store").StoreDb,
    mux: { deleteAsset, releaseUpload },
    now: over.now ?? (() => T0),
    defer: (fn: () => Promise<void>) => void deferred.push(fn),
  };
  return { d, deferred, deleteAsset, releaseUpload, runDeferred: () => Promise.all(deferred.splice(0).map((f) => f())) };
}

const listCalls = (t: string) => h.db.list.mock.calls.filter((c) => c[0] === t).length;

beforeEach(async () => {
  for (const k of Object.keys(h.store)) delete h.store[k];
  h.log.length = 0;
  vi.clearAllMocks();
  vi.resetModules();
  S = await import("./store");
});

describe("readSnapshot", () => {
  it("lista apareca_videos do restaurante uma vez em 5 s; depois de 5 s ou com forgetSnapshot, lista de novo", async () => {
    h.store.apareca_videos = [video(), video({ restaurant_id: RID2 })];
    let now = T0;
    const { d } = deps({ now: () => now });

    const a = await S.readSnapshot(d, RID);
    const b = await S.readSnapshot(d, RID);
    expect(listCalls("apareca_videos")).toBe(1);
    expect(h.db.list).toHaveBeenCalledWith("apareca_videos", { restaurant_id: RID });
    expect(a.videos.map((v) => v.restaurant_id)).toEqual([RID]);
    expect(b.at).toBe(a.at);

    now = new Date(T0.getTime() + 4_999);
    await S.readSnapshot(d, RID);
    expect(listCalls("apareca_videos")).toBe(1);

    now = new Date(T0.getTime() + 5_000);
    await S.readSnapshot(d, RID);
    expect(listCalls("apareca_videos")).toBe(2);

    S.forgetSnapshot(RID);
    await S.readSnapshot(d, RID);
    expect(listCalls("apareca_videos")).toBe(3);
  });

  it("aplica resolveStuck: ai_review há mais de 45 s aparece pending; há menos, continua ai_review", async () => {
    const stuck = video({ status: "ai_review", decided_by: null, decided_at: "2026-10-16T14:59:14.000Z" });
    const fresh = video({ status: "ai_review", decided_by: null, decided_at: "2026-10-16T14:59:16.000Z" });
    h.store.apareca_videos = [stuck, fresh];
    const { d } = deps();
    const snap = await S.readSnapshot(d, RID);
    expect(snap.videos.find((v) => v.id === stuck.id)?.status).toBe("pending");
    expect(snap.videos.find((v) => v.id === fresh.id)?.status).toBe("ai_review");
  });

  it("leituras concorrentes dividem a mesma consulta", async () => {
    h.store.apareca_videos = [video()];
    const { d } = deps();
    await Promise.all([S.readSnapshot(d, RID), S.readSnapshot(d, RID), S.readSnapshot(d, RID)]);
    expect(listCalls("apareca_videos")).toBe(1);
  });

  it("nunca devolve vencido e manda o vencido para defer -> purge", async () => {
    const ok = video();
    const old = expired();
    h.store.apareca_videos = [ok, old];
    const { d, deferred, runDeferred, deleteAsset } = deps();

    const snap = await S.readSnapshot(d, RID);
    expect(snap.videos.map((v) => v.id)).toEqual([ok.id]);
    expect(deferred).toHaveLength(1);
    expect(deleteAsset).not.toHaveBeenCalled(); // nada apagado antes do defer

    await runDeferred();
    expect(deleteAsset).toHaveBeenCalledWith(old.mux_asset_id);
    expect(h.store.apareca_videos.map((r) => r.id)).toEqual([ok.id]);
  });

  it("envio parado há mais de 1 h também sai do retrato e é apagado", async () => {
    const stuck = video({ status: "uploading", mux_asset_id: null, created_at: "2026-10-16T13:00:00.000Z" });
    h.store.apareca_videos = [stuck];
    const { d, runDeferred } = deps();
    expect((await S.readSnapshot(d, RID)).videos).toEqual([]);
    await runDeferred();
    expect(h.store.apareca_videos).toEqual([]);
  });

  it("duas leituras concorrentes com o mesmo vencido chamam purge para ele uma vez só", async () => {
    const old = expired();
    h.store.apareca_videos = [old];
    const { d, deferred, runDeferred, deleteAsset } = deps();

    await Promise.all([S.readSnapshot(d, RID), S.readSnapshot(d, RID)]);
    S.forgetSnapshot(RID); // mesmo relendo do banco, o vencido ainda está sendo apagado
    await S.readSnapshot(d, RID);
    expect(deferred).toHaveLength(1);

    await runDeferred();
    expect(deleteAsset).toHaveBeenCalledTimes(1);
    expect(h.log.filter((l) => l.startsWith("insert:apareca_tally"))).toHaveLength(1);
  });

  it("vencido cujo asset não apagou volta a ser tentado na leitura seguinte", async () => {
    const old = expired();
    h.store.apareca_videos = [old];
    let fail = true;
    const { d, deferred, runDeferred, deleteAsset } = deps({
      deleteAsset: async () => {
        if (fail) throw new Error("mux 500");
      },
    });
    await S.readSnapshot(d, RID);
    await runDeferred();
    expect(h.store.apareca_videos).toHaveLength(1);

    fail = false;
    await S.readSnapshot(d, RID);
    expect(deferred).toHaveLength(1);
    await runDeferred();
    expect(deleteAsset).toHaveBeenCalledTimes(2);
    expect(h.store.apareca_videos).toHaveLength(0);
  });

  it("leitura iniciada antes do fim do purge não apaga de novo nem grava outro tally", async () => {
    const old = expired();
    h.store.apareca_videos = [old];
    const { d, deferred, runDeferred } = deps();
    await S.readSnapshot(d, RID);
    expect(deferred).toHaveLength(1);

    // Leitura X começa enquanto o purge ainda não terminou e só volta depois dele.
    let release!: (rows: unknown[]) => void;
    h.db.list.mockImplementationOnce(() => new Promise((r) => (release = r as (rows: unknown[]) => void)));
    S.forgetSnapshot(RID);
    const x = S.readSnapshot(d, RID);
    await runDeferred();
    release([{ ...old }]);
    const snap = await x;
    expect(snap.videos).toEqual([]);
    await runDeferred();

    expect(h.log.filter((l) => l === "insert:apareca_tally")).toHaveLength(1);
    expect(h.db.removeIds).toHaveBeenCalledTimes(1);
  });
});

describe("purge", () => {
  it("apaga o asset no Mux, grava o tally e só então remove a linha", async () => {
    const a = expired({ downloads: 2 });
    const b = expired({ mux_asset_id: null, status: "uploading" });
    h.store.apareca_videos = [a, b];
    const { d } = deps();

    const r = await S.purge(d, [a, b]);
    expect(r).toEqual({ deleted: 2, failed: 0 });
    const order = h.log.filter((l) => /^(mux|insert|removeIds)/.test(l));
    expect(order).toEqual([`mux:${a.mux_asset_id}`, "insert:apareca_tally", `removeIds:apareca_videos:${a.Id},${b.Id}`]);
    const t = h.store.apareca_tally;
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ restaurant_id: RID, day: "2026-10-16", month: "2026-10" });
    expect(t[0].counts).toMatchObject({ sent: 2, downloads: 2, encoded_s: 12 });
  });

  it("se o Mux falha, a linha fica, conta em failed e não entra no tally", async () => {
    const a = expired();
    const b = expired();
    h.store.apareca_videos = [a, b];
    const { d } = deps({
      deleteAsset: async (id) => {
        if (id === a.mux_asset_id) throw new Error("mux 500");
      },
    });

    const r = await S.purge(d, [a, b]);
    expect(r).toEqual({ deleted: 1, failed: 1 });
    expect(h.store.apareca_videos.map((x) => x.id)).toEqual([a.id]);
    expect(h.store.apareca_tally[0].counts).toMatchObject({ sent: 1 });
  });

  it("envio parado sem asset: libera o upload no Mux antes de remover a linha", async () => {
    const a = video({ status: "uploading", mux_asset_id: null, created_at: "2026-10-16T13:00:00.000Z" });
    h.store.apareca_videos = [a];
    const { d, releaseUpload, deleteAsset } = deps();
    expect(await S.purge(d, [a])).toEqual({ deleted: 1, failed: 0 });
    expect(releaseUpload).toHaveBeenCalledWith(a.mux_upload_id);
    expect(deleteAsset).not.toHaveBeenCalled();
    const order = h.log.filter((l) => /^(upload|insert|removeIds)/.test(l));
    expect(order).toEqual([`upload:${a.mux_upload_id}`, "insert:apareca_tally", `removeIds:apareca_videos:${a.Id}`]);
  });

  it("envio parado: se o Mux não confirmar o upload, a linha fica e conta em failed", async () => {
    const a = video({ status: "uploading", mux_asset_id: null, created_at: "2026-10-16T13:00:00.000Z" });
    h.store.apareca_videos = [a];
    const { d } = deps({
      releaseUpload: async () => {
        throw new Error("mux 500");
      },
    });
    expect(await S.purge(d, [a])).toEqual({ deleted: 0, failed: 1 });
    expect(h.store.apareca_videos).toHaveLength(1);
    expect(h.db.insert).not.toHaveBeenCalled();
  });

  it("nunca apaga aprovado dentro do prazo, mesmo se pedirem", async () => {
    const ok = video();
    h.store.apareca_videos = [ok];
    const { d, deleteAsset } = deps();
    expect(await S.purge(d, [ok])).toEqual({ deleted: 0, failed: 0 });
    expect(deleteAsset).not.toHaveBeenCalled();
    expect(h.store.apareca_videos).toHaveLength(1);
    expect(h.db.insert).not.toHaveBeenCalled();
  });

  it("se gravar o tally falhar, a linha não é removida", async () => {
    const a = expired();
    h.store.apareca_videos = [a];
    const { d } = deps();
    h.db.insert.mockRejectedValueOnce(new Error("nocodb 500"));
    await expect(S.purge(d, [a])).rejects.toThrow("nocodb 500");
    expect(h.db.removeIds).not.toHaveBeenCalled();
    expect(h.store.apareca_videos).toHaveLength(1);
  });

  it("usa o fuso do restaurante para o dia do tally", async () => {
    h.store.restaurants = [{ uid: RID, id: RID, timezone: "Asia/Tokyo" }];
    // 20:00 UTC do dia 16 já é dia 17 em Tóquio.
    const a = expired({ created_at: "2026-10-16T20:00:00.000Z", expires_at: "2026-10-16T14:00:00.000Z" });
    h.store.apareca_videos = [a];
    const { d } = deps();
    await S.purge(d, [a]);
    expect(h.store.apareca_tally[0]).toMatchObject({ day: "2026-10-17" });
  });
});

describe("monthUsage", () => {
  it("stored_min_month = institucionais ativos + clientes do mês (vivos e já apagados), de todas as casas", async () => {
    h.store.apareca_house_videos = [
      house({ duration_ms: 60_000 }), // 1 min
      house({ restaurant_id: RID2, duration_ms: 120_000 }), // 2 min
      house({ duration_ms: 600_000, active: false }), // inativo não conta
      house({ duration_ms: null, status: "processing" }),
    ];
    h.store.apareca_tally = [
      tally({ counts: { encoded_s: 120, played_s: 300, mp4_s: 120, sent: 20, downloads: 4 } }),
      tally({ restaurant_id: RID2, day: "2026-10-11", counts: { encoded_s: 60, played_s: 60, mp4_s: 60, sent: 10, downloads: 0 } }),
      tally({ day: "2026-09-30", month: "2026-09", counts: { encoded_s: 9999, played_s: 9999, mp4_s: 9999 } }),
    ];
    h.store.apareca_videos = [
      video({ duration_ms: 6_000, plays: 2, downloads: 1 }),
      video({ restaurant_id: RID2, duration_ms: 6_000, plays: 0, downloads: 0 }),
      video({ status: "uploading", mux_asset_id: null, duration_ms: null, plays: 0 }),
      video({ created_at: "2026-09-30T12:00:00.000Z", duration_ms: 6_000 }), // outro mês
    ];
    const { d } = deps();

    const u = await S.monthUsage(d, "2026-10");
    // clientes: 120 + 60 (apagados) + 6 + 6 (vivos) = 192 s = 3,2 min; institucionais: 3 min.
    expect(u.encoded_s).toBe(192);
    expect(u.stored_min_month).toBeCloseTo(3 + 192 / 60, 6);
    // tallies 300 + 60; downloads apagados: 4 × (120/20) = 24; vivo: 2 × 6 + 1 × 6 = 18.
    expect(u.played_s).toBeCloseTo(300 + 60 + 24 + 18, 6);
    expect(u.mp4_s).toBe(120 + 60 + 6 + 6);
    expect(u.house_min).toBe(0);
    expect(h.db.list).toHaveBeenCalledWith("apareca_tally", { month: "2026-10" });
  });

  it("institucionais exibidos (house_played_s do tally) vão para house_min, nunca para played_s", async () => {
    h.store.apareca_house_videos = [];
    h.store.apareca_videos = [];
    h.store.apareca_tally = [
      tally({ counts: { encoded_s: 60, played_s: 120, mp4_s: 60, sent: 10, downloads: 0 } }),
      tally({ counts: { house_played_s: 1_800 } }), // linha gravada pelo "tocou" da TV
      tally({ restaurant_id: RID2, counts: { house_played_s: 600 } }),
      tally({ day: "2026-09-30", month: "2026-09", counts: { house_played_s: 99_999 } }),
    ];
    const { d } = deps();
    const u = await S.monthUsage(d, "2026-10");
    expect(u.played_s).toBe(120);
    expect(u.house_min).toBeCloseTo((1_800 + 600) / 60, 6);
    // O teto conta os dois: entrega = 2 min de clientes + 40 min de institucionais.
    const { estimateUsd } = await import("./cost");
    const free = { ...(await import("./cost")).MUX_PRICES, delivery_free_min: 0 };
    expect(estimateUsd(u, free)).toBeCloseTo(estimateUsd({ ...u, house_min: 0 }, free) + 40 * free.delivery_per_min, 9);
  });

  it("guarda o resultado por 60 s", async () => {
    let now = T0;
    const { d } = deps({ now: () => now });
    await S.monthUsage(d, "2026-10");
    await S.monthUsage(d, "2026-10");
    expect(listCalls("apareca_tally")).toBe(1);
    now = new Date(T0.getTime() + 60_000);
    await S.monthUsage(d, "2026-10");
    expect(listCalls("apareca_tally")).toBe(2);
  });
});

describe("getAparecaHead", () => {
  it("monta a cabeça a partir de restaurants pelo slug, com a config corrigida", async () => {
    h.store.restaurants = [
      {
        uid: RID, id: RID, slug: "casa", name: "Casa", timezone: "America/Sao_Paulo", show_hours: false,
        opening_hours: [], apareca_allowed: true, apareca_ai_allowed: false, apareca_enabled: true,
        community_enabled: true, apareca_config: { retention_h: 2, plays: 9 }, logo_path: null, brand_color: "#f00",
        instagram: "casa",
      },
    ];
    const head = await S.getAparecaHead("CASA");
    expect(h.db.first).toHaveBeenCalledWith("restaurants", { slug: "casa" });
    expect(head).toMatchObject({
      id: RID, slug: "casa", name: "Casa", allowed: true, ai_allowed: false, enabled: true, community_enabled: true,
      opening_hours: null, brand_color: "#f00", instagram: "casa",
    });
    expect(head?.config.retention_h).toBe(6);
    expect(head?.config.plays).toBe(3);
    const { cacheTag } = await import("next/cache");
    expect(cacheTag).toHaveBeenCalledWith(S.aparecaTags.slug("casa"));
  });

  it("slug inválido ou inexistente devolve null sem erro", async () => {
    expect(await S.getAparecaHead("../x")).toBeNull();
    expect(await S.getAparecaHead("nada")).toBeNull();
  });
});

describe("readAparecaHeadFresh", () => {
  it("lê o restaurante pelo uid direto do banco a cada chamada (sem memória), com o modo de agora", async () => {
    h.store.restaurants = [
      { uid: RID, id: RID, slug: "casa", name: "Casa", apareca_allowed: true, apareca_ai_allowed: true, apareca_config: { mode: "automatico" } },
    ];
    expect((await S.readAparecaHeadFresh(RID))?.config.mode).toBe("automatico");
    h.store.restaurants[0].apareca_config = { mode: "manual" };
    expect((await S.readAparecaHeadFresh(RID))?.config.mode).toBe("manual");
    expect(h.db.first).toHaveBeenCalledWith("restaurants", { uid: RID });
    expect(await S.readAparecaHeadFresh(RID2)).toBeNull();
  });
});

describe("aparecaTags", () => {
  it("slug e rid têm prefixos distintos", () => {
    expect(S.aparecaTags.slug("casa")).toBe("apareca:slug:casa");
    expect(S.aparecaTags.rid(RID)).toBe(`apareca:rid:${RID}`);
  });
});

describe("getHouseVideos", () => {
  it("lista os institucionais da casa em ordem de posição", async () => {
    h.store.apareca_house_videos = [house({ position: 2 }), house({ position: 1 }), house({ restaurant_id: RID2 })];
    const rows = await S.getHouseVideos(RID);
    expect(rows.map((r) => r.position)).toEqual([1, 2]);
  });
});
