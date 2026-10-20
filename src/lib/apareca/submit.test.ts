// Rotas do cliente sem o Next: envio (aceite, mesa, horário, teto, limites), "meu vídeo"
// (estados, Mux consultado com calma, vencido apagado) e download. Banco, Mux e relógio falsos.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLimiter } from "@/lib/limiter";
import { DEFAULT_CONFIG } from "./config";
import type { AparecaConfig, AparecaHead, VideoRow } from "./types";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock("@/lib/db/nocodb", () => ({ list: vi.fn(), first: vi.fn(), insert: vi.fn(), removeIds: vi.fn() }));

import { purgePlan } from "./retention";
import { forgetSnapshot } from "./store";
import {
  countDownload, downloadTarget, myStatus, publicHead, READS_PER_HOUR, startSubmission, type SubmitDeps, type SubmitLimits,
} from "./submit";

const SLUG = "casa-da-ana";
const RID = "00000000-0000-4000-8000-000000000001";
const OTHER_RID = "00000000-0000-4000-8000-000000000009";
const TABLE_UID = "00000000-0000-4000-8000-0000000000c1";
const Z1 = "00000000-0000-4000-8000-0000000000a1";
const DEV = "11111111-1111-4111-8111-111111111111";
const DEV2 = "22222222-2222-4222-8222-222222222222";
const T0 = new Date("2026-10-16T22:00:00.000Z"); // 19:00 em São Paulo
const HOUR = 3_600_000;

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const match = (r: Row, w: Row) => Object.entries(w).every(([k, v]) => (r[k] ?? null) === v);
const db = {
  list: vi.fn(async (t: string, w: Row = {}) => (tables[t] ?? []).filter((r) => match(r, w)).map((r) => ({ ...r }))),
  first: vi.fn(async (t: string, w: Row) => {
    const r = (tables[t] ?? []).find((x) => match(x, w));
    return r ? { ...r } : null;
  }),
  insert: vi.fn(async (t: string, rows: Row[]) => {
    const full = rows.map((r) => ({ Id: (tables[t]?.length ?? 0) + 1, uid: crypto.randomUUID(), created_at: new Date().toISOString(), ...r }));
    (tables[t] ??= []).push(...full);
    return full.map((r) => ({ ...r, id: r.uid }));
  }),
  insertOne: vi.fn(async (t: string, row: Row) => (await db.insert(t, [row]))[0]),
  updateRows: vi.fn(async (t: string, rows: Row[]) => {
    for (const p of rows) {
      const r = (tables[t] ?? []).find((x) => x.Id === p.Id);
      if (r) Object.assign(r, p);
    }
  }),
  removeIds: vi.fn(async (t: string, ids: number[]) => {
    tables[t] = (tables[t] ?? []).filter((r) => !ids.includes(r.Id as number));
  }),
};

let now = T0;
let head: AparecaHead;
let seq = 100;

function mkHead(config: Partial<AparecaConfig> = {}, p: Partial<AparecaHead> = {}): AparecaHead {
  return {
    id: RID, slug: SLUG, name: "Casa da Ana", timezone: "America/Sao_Paulo", opening_hours: null, allowed: true, ai_allowed: false,
    enabled: true, config: { ...DEFAULT_CONFIG, ...config }, logo_path: null, brand_color: null, instagram: null, ...p,
  };
}

function video(p: Partial<VideoRow> = {}): VideoRow {
  seq += 1;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  return {
    Id: seq, id, uid: id, restaurant_id: RID, kind: "cliente", table_id: TABLE_UID, zone_id: null, device_id: DEV, name: "Ana",
    consent_at: "2026-10-16T21:50:00.000Z", mux_upload_id: `upload${seq}`, mux_asset_id: null, mux_playback_id: null, duration_ms: null,
    status: "uploading", decided_by: null, decided_at: null, ai_reason: null, plays: 0, plays_target: 1, first_shown_at: null, downloads: 0,
    expires_at: "2026-10-17T04:00:00.000Z", created_at: "2026-10-16T21:55:00.000Z", ...p,
  } as VideoRow;
}

function limits(): SubmitLimits {
  const clock = () => now.getTime();
  return {
    ip: createLimiter({ max: 60, windowMs: HOUR, now: clock }), // igual ao IP_PER_HOUR
    download: createLimiter({ max: 5, windowMs: HOUR, now: clock }),
    ipGlobal: createLimiter({ max: 120, windowMs: HOUR, now: clock }), // igual ao IP_PER_HOUR_GLOBAL
    reads: createLimiter({ max: READS_PER_HOUR, windowMs: HOUR, now: clock }),
  };
}

function mk(over: Partial<SubmitDeps> = {}) {
  const deferred: (() => Promise<void>)[] = [];
  const createUpload = vi.fn<(origin: string, passthrough: string) => Promise<{ id: string; url: string }>>(async () => ({
    id: "muxUp1",
    url: "https://storage.example/upload?sig=1",
  }));
  const assetInfo = vi.fn<(uploadId: string) => Promise<import("./mux-video").AssetInfo>>(async () => ({ status: "processing" }));
  const deleteAsset = vi.fn<(id: string) => Promise<void>>(async () => {});
  const releaseUpload = vi.fn<(id: string) => Promise<void>>(async () => {});
  const onReady = vi.fn<(v: VideoRow, h: AparecaHead) => Promise<void>>(async () => {});
  const d: SubmitDeps = {
    db: db as unknown as SubmitDeps["db"],
    store: { mux: { deleteAsset, releaseUpload }, now: () => now, defer: (fn) => void deferred.push(fn) },
    getHead: async (s) => (s === SLUG ? head : null),
    mux: { createUpload: createUpload as unknown as SubmitDeps["mux"]["createUpload"], assetInfo: assetInfo as unknown as SubmitDeps["mux"]["assetInfo"] },
    monthUsd: async () => 0,
    onReady,
    now: () => now,
    off: () => false,
    origin: "https://cardapio.test",
    ip: "1.2.3.4",
    limits: limits(),
    ...over,
  };
  return { d, createUpload, assetInfo, deleteAsset, releaseUpload, onReady, runDeferred: () => Promise.all(deferred.splice(0).map((f) => f())) };
}


// 40 envios do mesmo IP em cada um de 3 restaurantes (abaixo dos 60 por casa) e o 121º barrado.
const RIDS3 = [RID, "00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000004"];
async function spread3(base: SubmitDeps) {
  const heads = RIDS3.map((id, k) => mkHead({}, { id, slug: `casa-${k}` }));
  for (const [k, id] of RIDS3.entries()) {
    const uid = `00000000-0000-4000-8000-0000000000d${k}`;
    tables.dining_tables.push({ Id: 10 + k, id: uid, uid, restaurant_id: id, code: `MES${k + 2}AA`, active: true });
  }
  const d: SubmitDeps = { ...base, getHead: async (s) => heads.find((h) => h.slug === s) ?? null };
  let n = 0;
  const dev = () => `00000000-0000-4000-8000-${String(7000 + n++).padStart(12, "0")}`;
  for (let i = 0; i < 120; i++) {
    const k = i % 3;
    expect((await startSubmission(d, `casa-${k}`, body({ mesa: `MES${k + 2}AA`, device: dev() }))).ok).toBe(true);
  }
  expect(await startSubmission(d, "casa-0", body({ mesa: "MES2AA", device: dev() }))).toEqual({ ok: false, code: "too_many" });
  expect(videos()).toHaveLength(120);
}

const body = (p: Record<string, unknown> = {}) => ({ mesa: "ABC234", device: DEV, name: "  @Ana ", consent: true, consent_at: "2026-10-16T21:58:00.000Z", ...p });
const videos = () => (tables.apareca_videos ?? []) as unknown as VideoRow[];

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables.dining_tables = [
    { Id: 1, id: TABLE_UID, uid: TABLE_UID, restaurant_id: RID, code: "ABC234", active: true },
    { Id: 2, id: "t-off", uid: "t-off", restaurant_id: RID, code: "OFF234", active: false },
    { Id: 3, id: "00000000-0000-4000-8000-0000000000c9", uid: "00000000-0000-4000-8000-0000000000c9", restaurant_id: OTHER_RID, code: "XYZ234", active: true },
  ];
  now = T0;
  head = mkHead();
  vi.clearAllMocks();
  forgetSnapshot(RID);
});

// ---------------------------------------------------------------- startSubmission

describe("startSubmission: recusas", () => {
  it.each([
    ["mesa malformada", body({ mesa: "abc234" })],
    ["mesa com 1", body({ mesa: "ABC231" })],
    ["mesa curta", body({ mesa: "ABC23" })],
    ["device não uuid", body({ device: "abc" })],
    ["corpo nulo", null],
    ["corpo lista", [1]],
  ])("%s → invalid", async (_n, b) => {
    const { d, createUpload } = mk();
    expect(await startSubmission(d, SLUG, b)).toEqual({ ok: false, code: "invalid" });
    expect(createUpload).not.toHaveBeenCalled();
  });

  it("slug desconhecido → not_found", async () => {
    const { d } = mk();
    expect(await startSubmission(d, "outra-casa", body())).toEqual({ ok: false, code: "not_found" });
  });

  it.each([
    ["chave geral", () => ({ off: () => true }), {}],
    ["não liberado pelo João", () => ({}), { allowed: false }],
    ["desligado pelo dono", () => ({}), { enabled: false }],
  ])("%s → off", async (_n, over, h) => {
    head = mkHead({}, h as Partial<AparecaHead>);
    const { d, createUpload } = mk(over());
    expect(await startSubmission(d, SLUG, body())).toEqual({ ok: false, code: "off" });
    expect(createUpload).not.toHaveBeenCalled();
  });

  it.each([
    ["mesa de outro restaurante", "XYZ234"],
    ["mesa desativada", "OFF234"],
    ["mesa inexistente", "QQQ234"],
  ])("%s → table", async (_n, mesa) => {
    const { d } = mk();
    expect(await startSubmission(d, SLUG, body({ mesa }))).toEqual({ ok: false, code: "table" });
  });

  it("fora do horário do Apareça → closed", async () => {
    head = mkHead({ hours: { from: "10:00", to: "11:00" } });
    const { d } = mk();
    expect(await startSubmission(d, SLUG, body())).toEqual({ ok: false, code: "closed" });
  });

  it("gasto do mês ≥ 90% do teto → paused; 89% passa", async () => {
    const paused = mk({ monthUsd: async () => 13.5 });
    expect(await startSubmission(paused.d, SLUG, body())).toEqual({ ok: false, code: "paused" });
    expect(paused.createUpload).not.toHaveBeenCalled();
    const ok = mk({ monthUsd: async () => 13.4 });
    expect((await startSubmission(ok.d, SLUG, body())).ok).toBe(true);
  });

  it.each([[{ consent: false }], [{ consent: "true" }], [{ consent: undefined }]])("sem aceite %j → consent", async (p) => {
    const { d } = mk();
    expect(await startSubmission(d, SLUG, body(p))).toEqual({ ok: false, code: "consent" });
  });

  it("nome com palavrão ou longo → name", async () => {
    const { d } = mk();
    expect(await startSubmission(d, SLUG, body({ name: "p0rr4" }))).toEqual({ ok: false, code: "name" });
    expect(await startSubmission(d, SLUG, body({ name: "a".repeat(31) }))).toEqual({ ok: false, code: "name" });
    expect(videos()).toHaveLength(0);
  });

  it("sem limite por pessoa: o mesmo device manda vários vídeos seguidos", async () => {
    head = mkHead({ device_per_hour: 1 }); // valor antigo salvo na config não limita mais
    tables.apareca_videos = [video({ created_at: "2026-10-16T21:30:00.000Z" }), video({ created_at: "2026-10-16T21:40:00.000Z" })];
    const { d } = mk();
    for (let i = 0; i < 5; i++) {
      now = new Date(T0.getTime() + i * 60_000);
      expect((await startSubmission(d, SLUG, body())).ok).toBe(true);
    }
    expect(videos()).toHaveLength(7);
  });

  it("61º envio do mesmo IP no mesmo restaurante → too_many; o mesmo IP em outro restaurante não conta", async () => {
    const { d } = mk();
    const dev = (i: number) => `00000000-0000-4000-8000-${String(900 + i).padStart(12, "0")}`;
    for (let i = 0; i < 60; i++) expect((await startSubmission(d, SLUG, body({ device: dev(i) }))).ok).toBe(true);
    expect(await startSubmission(d, SLUG, body({ device: DEV2 }))).toEqual({ ok: false, code: "too_many" });
    expect(videos()).toHaveLength(60);

    // Outro restaurante, mesmo IP e mesmos limitadores: começa do zero.
    const other = mkHead({}, { id: OTHER_RID, slug: "outra-casa" });
    const d2: SubmitDeps = { ...d, getHead: async (s) => (s === "outra-casa" ? other : s === SLUG ? head : null) };
    expect((await startSubmission(d2, "outra-casa", body({ mesa: "XYZ234", device: DEV2 }))).ok).toBe(true);
  });

  it("limitadores padrão do processo: 60 por hora por IP e restaurante (IP_PER_HOUR)", async () => {
    const { d } = mk({ limits: undefined, ip: "203.0.113.77" });
    const dev = (i: number) => `00000000-0000-4000-8000-${String(5000 + i).padStart(12, "0")}`;
    for (let i = 0; i < 60; i++) expect((await startSubmission(d, SLUG, body({ device: dev(i) }))).ok).toBe(true);
    expect(await startSubmission(d, SLUG, body({ device: dev(60) }))).toEqual({ ok: false, code: "too_many" });
  });

  it("o mesmo IP espalhado por 3 restaurantes é barrado no 121º envio (teto global por IP)", async () => {
    await spread3(mk().d);
  });

  it("limitadores padrão do processo: teto global de 120 por hora por IP (IP_PER_HOUR_GLOBAL)", async () => {
    await spread3(mk({ limits: undefined, ip: "203.0.113.88" }).d);
  });

  it("Mux falhou → mux, sem linha, e a tentativa não gasta o limite", async () => {
    head = mkHead({ device_per_hour: 1 });
    const bad = mk();
    bad.createUpload.mockRejectedValueOnce(new Error("mux 500"));
    expect(await startSubmission(bad.d, SLUG, body())).toEqual({ ok: false, code: "mux", detail: "mux 500" });
    expect(videos()).toHaveLength(0);
    expect((await startSubmission(bad.d, SLUG, body())).ok).toBe(true);
  });
});

describe("startSubmission: sucesso", () => {
  it("grava a linha uploading com restaurante do slug, zona da mesa, plays e retenção da config", async () => {
    head = mkHead({ table_zones: { [TABLE_UID]: Z1 }, zones: [{ id: Z1, name: "Salão" }], plays: 2, retention_h: 8 });
    const { d, createUpload } = mk();
    const r = await startSubmission(d, SLUG, body({ restaurant_id: OTHER_RID, zone_id: "x", status: "approved" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r).sort()).toEqual(["expires_at", "id", "ok", "upload_url"]);
    expect(r.upload_url).toBe("https://storage.example/upload?sig=1");
    expect(r.expires_at).toBe(new Date(T0.getTime() + 8 * HOUR).toISOString());

    const [row] = videos();
    expect(row).toMatchObject({
      uid: r.id, restaurant_id: RID, kind: "cliente", table_id: TABLE_UID, zone_id: Z1, device_id: DEV, name: "@Ana",
      consent_at: "2026-10-16T21:58:00.000Z", mux_upload_id: "muxUp1", status: "uploading", plays: 0, plays_target: 2,
      downloads: 0, expires_at: r.expires_at, created_at: T0.toISOString(), mux_asset_id: null, mux_playback_id: null,
      ai_reason: null, first_shown_at: null,
    });
    expect(createUpload).toHaveBeenCalledWith("https://cardapio.test", `apareca:${RID}:${TABLE_UID}:${r.id}`);
  });

  it("mesa sem zona grava zone_id null; nome vazio grava null", async () => {
    const { d } = mk();
    await startSubmission(d, SLUG, body({ name: "" }));
    expect(videos()[0]).toMatchObject({ zone_id: null, name: null });
  });

  it("consent_at fora de ±10 min do servidor (ou inválido) vira a hora do servidor", async () => {
    const { d } = mk();
    await startSubmission(d, SLUG, body({ consent_at: "2026-10-16T21:49:00.000Z", device: DEV }));
    await startSubmission(d, SLUG, body({ consent_at: "ontem", device: DEV2 }));
    expect(videos().map((v) => v.consent_at)).toEqual([T0.toISOString(), T0.toISOString()]);
  });

  it("a fila vê o envio novo na hora (retrato esquecido)", async () => {
    const { d } = mk();
    const first = await startSubmission(d, SLUG, body());
    const second = await startSubmission(d, SLUG, body({ device: DEV2 }));
    if (!first.ok || !second.ok) throw new Error("falhou");
    expect(videos()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------- myStatus

const ask = (v: VideoRow, device = DEV) => ({ id: v.id, device });

describe("myStatus", () => {
  it("corpo inválido → invalid; slug desconhecido → not_found", async () => {
    const { d } = mk();
    expect(await myStatus(d, SLUG, { id: "x", device: DEV })).toEqual({ error: "invalid" });
    expect(await myStatus(d, SLUG, { id: DEV, device: "x" })).toEqual({ error: "invalid" });
    expect(await myStatus(d, SLUG, null)).toEqual({ error: "invalid" });
    const v = video();
    tables.apareca_videos = [v];
    expect(await myStatus(d, "outra-casa", ask(v))).toEqual({ error: "not_found" });
  });

  it("Foco 2: linha vencida → gone, sem download, e o vídeo é apagado (Mux e banco)", async () => {
    const v = video({ status: "approved", mux_asset_id: "assetX", mux_playback_id: "pbX", expires_at: "2026-10-16T21:59:00.000Z" });
    tables.apareca_videos = [v];
    const { d, deleteAsset, runDeferred } = mk();
    const r = await myStatus(d, SLUG, ask(v));
    expect(r).toEqual({ state: "gone", position: null, eta_ms: null, first_shown_at: null, download: null });
    await runDeferred();
    expect(deleteAsset).toHaveBeenCalledWith("assetX");
    expect(videos()).toHaveLength(0);
  });

  it("linha vencida de outro device → not_found", async () => {
    const v = video({ expires_at: "2026-10-16T21:59:00.000Z" });
    tables.apareca_videos = [v];
    const { d } = mk();
    expect(await myStatus(d, SLUG, ask(v, DEV2))).toEqual({ error: "not_found" });
  });

  it("device diferente do dono ou id inexistente → not_found (não revela que existe)", async () => {
    const v = video({ status: "approved" });
    tables.apareca_videos = [v];
    const { d } = mk();
    expect(await myStatus(d, SLUG, ask(v, DEV2))).toEqual({ error: "not_found" });
    expect(await myStatus(d, SLUG, { id: DEV2, device: DEV })).toEqual({ error: "not_found" });
  });

  it("vídeo de outro restaurante → not_found", async () => {
    const v = video({ restaurant_id: OTHER_RID, status: "approved" });
    tables.apareca_videos = [v];
    const { d } = mk();
    expect(await myStatus(d, SLUG, ask(v))).toEqual({ error: "not_found" });
  });

  it("uploading → sending; consulta o Mux no máximo 1 vez a cada 5 s por vídeo", async () => {
    const v = video({ status: "uploading" });
    tables.apareca_videos = [v];
    const { d, assetInfo } = mk();
    expect((await myStatus(d, SLUG, ask(v))) as { state: string }).toMatchObject({ state: "sending" });
    now = new Date(T0.getTime() + 4_999);
    await myStatus(d, SLUG, ask(v));
    expect(assetInfo).toHaveBeenCalledTimes(1);
    expect(assetInfo).toHaveBeenCalledWith(v.mux_upload_id);
    now = new Date(T0.getTime() + 5_000);
    await myStatus(d, SLUG, ask(v));
    expect(assetInfo).toHaveBeenCalledTimes(2);
  });

  it("processing → preparing", async () => {
    const v = video({ status: "processing" });
    tables.apareca_videos = [v];
    const { d } = mk();
    expect(await myStatus(d, SLUG, ask(v))).toMatchObject({ state: "preparing" });
  });

  it("asset pronto: grava asset, playback e duração, passa a pending e chama onReady uma vez", async () => {
    const v = video({ status: "uploading" });
    tables.apareca_videos = [v];
    const { d, assetInfo, onReady, runDeferred } = mk();
    assetInfo.mockResolvedValue({ status: "ready", assetId: "assetA", playbackId: "pbA", durationS: 6.2, mp4: false });
    const r = await myStatus(d, SLUG, ask(v));
    expect(r).toMatchObject({ state: "review", download: null });
    expect(db.updateRows).toHaveBeenCalledWith("apareca_videos", [
      { Id: v.Id, status: "pending", mux_asset_id: "assetA", mux_playback_id: "pbA", duration_ms: 6200 },
    ]);
    await runDeferred();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady.mock.calls[0][0]).toMatchObject({ id: v.id, status: "pending", mux_asset_id: "assetA", mux_playback_id: "pbA", duration_ms: 6200 });
    expect(onReady.mock.calls[0][1]).toBe(head);
    expect(JSON.stringify(r)).not.toContain("pbA");
  });

  it("Foco 1: asset pronto com 30 s → rejected e deleteMuxAsset chamado; nunca fica pending", async () => {
    const v = video({ status: "uploading" });
    tables.apareca_videos = [v];
    const { d, assetInfo, deleteAsset, onReady, runDeferred } = mk();
    assetInfo.mockResolvedValue({ status: "ready", assetId: "assetLong", playbackId: "pbLong", durationS: 30, mp4: true });
    const r = await myStatus(d, SLUG, ask(v));
    await runDeferred();
    expect(r).toEqual({ state: "not_shown", position: null, eta_ms: null, first_shown_at: null, download: null });
    expect(videos()[0]).toMatchObject({ status: "rejected", decided_by: null, ai_reason: "duração acima de 7 s", mux_asset_id: "assetLong" });
    // Item 2 da correção 1: regra do sistema não conta como reprovação da IA no relatório.
    const { tally } = purgePlan([{ ...videos()[0], expires_at: "2026-10-16T21:00:00.000Z" }], T0, () => "America/Sao_Paulo");
    expect(tally[0].counts).toMatchObject({ rejected: 1, ai_rejected: 0 });
    expect(deleteAsset).toHaveBeenCalledWith("assetLong");
    const statuses = db.updateRows.mock.calls.flatMap((c) => (c[1] as Row[]).map((p) => p.status));
    expect(statuses).not.toContain("pending");
    expect(onReady).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain("duração");
  });

  it("Foco 1: apagar o asset longo falhou → a linha continua rejected", async () => {
    const v = video({ status: "uploading" });
    tables.apareca_videos = [v];
    const { d, assetInfo, deleteAsset } = mk();
    deleteAsset.mockRejectedValue(new Error("mux 503"));
    assetInfo.mockResolvedValue({ status: "ready", assetId: "assetLong", playbackId: "pbLong", durationS: 120, mp4: false });
    expect(await myStatus(d, SLUG, ask(v))).toMatchObject({ state: "not_shown" });
    expect(videos()[0].status).toBe("rejected");
  });

  it("item 6: duração 0 (o Mux não informou) com IA e modo automático → pending, nunca ai_review", async () => {
    head = mkHead({ mode: "automatico" }, { ai_allowed: true });
    const v = video({ status: "uploading" });
    tables.apareca_videos = [v];
    const { d, assetInfo } = mk({ aiOn: () => true });
    assetInfo.mockResolvedValue({ status: "ready", assetId: "a0", playbackId: "pb0", durationS: 0, mp4: false });
    await myStatus(d, SLUG, ask(v));
    expect(videos()[0].status).toBe("pending");
  });

  it("IA disponível e modo híbrido → ai_review com decided_at e onReady chamado", async () => {
    head = mkHead({ mode: "hibrido" }, { ai_allowed: true });
    const v = video({ status: "uploading" });
    tables.apareca_videos = [v];
    const { d, assetInfo, onReady, runDeferred } = mk({ aiOn: (h) => h.ai_allowed });
    assetInfo.mockResolvedValue({ status: "ready", assetId: "aH", playbackId: "pbH", durationS: 6, mp4: false });
    expect(await myStatus(d, SLUG, ask(v))).toMatchObject({ state: "review" });
    expect(videos()[0]).toMatchObject({ status: "ai_review", decided_at: T0.toISOString() });
    await runDeferred();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady.mock.calls[0][0]).toMatchObject({ status: "ai_review" });
  });

  it("sem aiOn, a IA fica desligada: híbrido com ai_allowed vira pending", async () => {
    head = mkHead({ mode: "hibrido" }, { ai_allowed: true });
    const v = video({ status: "uploading" });
    tables.apareca_videos = [v];
    const { d, assetInfo } = mk();
    assetInfo.mockResolvedValue({ status: "ready", assetId: "aH", playbackId: "pbH", durationS: 6, mp4: false });
    await myStatus(d, SLUG, ask(v));
    expect(videos()[0].status).toBe("pending");
  });

  it("decisão 2: linha já rejected no banco (retrato velho com uploading) → não volta a pending", async () => {
    const v = video({ status: "uploading" });
    tables.apareca_videos = [{ ...v, status: "rejected", decided_by: "equipe" }];
    const { d, assetInfo, onReady, runDeferred } = mk();
    assetInfo.mockResolvedValue({ status: "ready", assetId: "aX", playbackId: "pbX", durationS: 6, mp4: true });
    vi.mocked(db.list).mockImplementationOnce(async () => [{ ...v }]); // outra instância ainda vê uploading
    const r = await myStatus(d, SLUG, ask(v));
    await runDeferred();
    expect(r).toMatchObject({ state: "not_shown" });
    expect(db.updateRows).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
    expect(videos()[0]).toMatchObject({ status: "rejected", decided_by: "equipe" });
  });

  it("decisão 2: duas leituras seguidas com o asset pronto (retrato velho) gravam uma vez só", async () => {
    const v = video({ status: "uploading" });
    tables.apareca_videos = [v];
    const { d, assetInfo, onReady, runDeferred } = mk();
    assetInfo.mockResolvedValue({ status: "ready", assetId: "aY", playbackId: "pbY", durationS: 6, mp4: true });
    const stale = { ...v }; // cópia: a linha da tabela é o próprio v e muda com o updateRows
    vi.mocked(db.list).mockImplementationOnce(async () => [{ ...stale }]).mockImplementationOnce(async () => [{ ...stale }]);
    await myStatus(d, SLUG, ask(v));
    now = new Date(T0.getTime() + 5_000);
    forgetSnapshot(RID);
    await myStatus(d, SLUG, ask(v));
    await runDeferred();
    const writes = db.updateRows.mock.calls.filter((c) => c[0] === "apareca_videos");
    expect(writes).toHaveLength(1);
    expect(videos()[0].status).toBe("pending");
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("upload com erro no Mux → failed e not_shown", async () => {
    const v = video({ status: "uploading" });
    tables.apareca_videos = [v];
    const { d, assetInfo } = mk();
    assetInfo.mockResolvedValue({ status: "failed" });
    expect(await myStatus(d, SLUG, ask(v))).toMatchObject({ state: "not_shown", download: null });
    expect(db.updateRows).toHaveBeenCalledWith("apareca_videos", [{ Id: v.Id, status: "failed" }]);
  });

  it("erro ao consultar o Mux não derruba o status", async () => {
    const v = video({ status: "uploading" });
    tables.apareca_videos = [v];
    const { d, assetInfo } = mk();
    assetInfo.mockRejectedValue(new Error("mux 503"));
    expect(await myStatus(d, SLUG, ask(v))).toMatchObject({ state: "sending" });
  });

  it.each(["rejected", "removed"] as const)("%s → not_shown, sem motivo e sem download", async (status) => {
    const v = video({ status, ai_reason: "nudez", decided_by: "ia", mux_asset_id: "aR", mux_playback_id: "pbR" });
    tables.apareca_videos = [v];
    const { d, assetInfo } = mk();
    assetInfo.mockResolvedValue({ status: "ready", assetId: "aR", playbackId: "pbR", durationS: 6, mp4: true });
    const r = await myStatus(d, SLUG, ask(v));
    expect(r).toEqual({ state: "not_shown", position: null, eta_ms: null, first_shown_at: null, download: null });
  });

  it("pending/ai_review → review com posição e tempo, sem download", async () => {
    const a = video({ status: "approved", mux_asset_id: "a1", mux_playback_id: "p1", created_at: "2026-10-16T21:50:00.000Z" });
    const mine = video({ status: "ai_review", mux_asset_id: "a2", mux_playback_id: "p2", created_at: "2026-10-16T21:56:00.000Z" });
    tables.apareca_videos = [a, mine];
    const { d, assetInfo } = mk();
    assetInfo.mockResolvedValue({ status: "ready", assetId: "a2", playbackId: "p2", durationS: 6, mp4: true });
    const r = await myStatus(d, SLUG, ask(mine));
    expect(r).toMatchObject({ state: "review", position: 2, download: null });
    expect((r as { eta_ms: number }).eta_ms).toBeGreaterThan(0);
  });

  it("approved sem exibição → queue com a posição", async () => {
    const q = video({ status: "approved", mux_asset_id: "a1", mux_playback_id: "p1" });
    tables.apareca_videos = [q];
    const { d } = mk();
    expect(await myStatus(d, SLUG, ask(q))).toMatchObject({ state: "queue", position: 1, first_shown_at: null });
  });

  // A1: o "tocou" sobe plays no INÍCIO do clipe; com alvo 1, plays >= alvo já no primeiro quadro.
  // "on_tv" é a janela de 0 a 20 s desde first_shown_at; fora dela, shown (alvo cumprido) ou queue.
  describe("A1: janela do \"Olhe para a TV agora!\"", () => {
    const ago = (ms: number) => new Date(T0.getTime() - ms).toISOString();
    const nocoAgo = (ms: number) => ago(ms).replace("T", " ").replace(/\.\d+Z$/, "+00:00"); // formato do NocoDB
    it("alvo 1, exibido há 3 s → on_tv (também no formato do NocoDB)", async () => {
      const a = video({ status: "approved", mux_asset_id: "a1", mux_playback_id: "p1", plays: 1, plays_target: 1, first_shown_at: ago(3_000) });
      const b = video({ status: "approved", mux_asset_id: "a2", mux_playback_id: "p2", plays: 1, plays_target: 1, first_shown_at: nocoAgo(3_000), device_id: DEV2 });
      tables.apareca_videos = [a, b];
      const { d } = mk();
      expect(await myStatus(d, SLUG, ask(a))).toMatchObject({ state: "on_tv", position: null, first_shown_at: ago(3_000) });
      expect(await myStatus(d, SLUG, { id: b.id, device: DEV2 })).toMatchObject({ state: "on_tv" });
    });
    it("alvo 1, exibido há 60 s → shown", async () => {
      const v = video({ status: "approved", mux_asset_id: "a1", mux_playback_id: "p1", plays: 1, plays_target: 1, first_shown_at: ago(60_000) });
      tables.apareca_videos = [v];
      const { d } = mk();
      expect(await myStatus(d, SLUG, ask(v))).toMatchObject({ state: "shown", position: null, eta_ms: null, first_shown_at: ago(60_000) });
    });
    it("alvo 2, com 1 exibição há 60 s → queue (vai passar de novo)", async () => {
      const v = video({ status: "approved", mux_asset_id: "a1", mux_playback_id: "p1", plays: 1, plays_target: 2, first_shown_at: ago(60_000) });
      tables.apareca_videos = [v];
      const { d } = mk();
      expect(await myStatus(d, SLUG, ask(v))).toMatchObject({ state: "queue", position: 1 });
    });
    it("bordas: 20 s ainda on_tv, 21 s fora; data no futuro ou ilegível fora", async () => {
      const at20 = video({ status: "approved", plays: 1, plays_target: 1, first_shown_at: ago(20_000) });
      const at21 = video({ status: "approved", plays: 1, plays_target: 1, first_shown_at: ago(21_000) });
      const fut = video({ status: "approved", plays: 1, plays_target: 1, first_shown_at: ago(-5_000) });
      const bad = video({ status: "approved", plays: 1, plays_target: 1, first_shown_at: "ontem" });
      tables.apareca_videos = [at20, at21, fut, bad];
      const { d } = mk();
      expect(await myStatus(d, SLUG, ask(at20))).toMatchObject({ state: "on_tv" });
      expect(await myStatus(d, SLUG, ask(at21))).toMatchObject({ state: "shown" });
      expect(await myStatus(d, SLUG, ask(fut))).toMatchObject({ state: "shown" });
      expect(await myStatus(d, SLUG, ask(bad))).toMatchObject({ state: "shown" });
    });
  });

  it("download só com o MP4 pronto e vídeo aprovado e vivo", async () => {
    const v = video({ status: "approved", mux_asset_id: "aD", mux_playback_id: "pbD" });
    tables.apareca_videos = [v];
    const { d, assetInfo } = mk();
    assetInfo.mockResolvedValue({ status: "ready", assetId: "aD", playbackId: "pbD", durationS: 6, mp4: false });
    expect(await myStatus(d, SLUG, ask(v))).toMatchObject({ download: null });
    assetInfo.mockResolvedValue({ status: "ready", assetId: "aD", playbackId: "pbD", durationS: 6, mp4: true });
    now = new Date(T0.getTime() + 5_000);
    const r = (await myStatus(d, SLUG, ask(v))) as { download: string };
    expect(r.download).toBe(`/api/apareca/${SLUG}/baixar?id=${v.id}`);
    // Depois de saber que o MP4 está pronto, não consulta mais o Mux por isso.
    now = new Date(T0.getTime() + 20_000);
    await myStatus(d, SLUG, ask(v));
    expect(assetInfo).toHaveBeenCalledTimes(2);
  });

  it("mutação: nunca devolve ai_reason, device_id, table_id, upload, asset nem playback", async () => {
    const secrets = { ai_reason: "nudez explícita na cena", mux_upload_id: "muxUploadSecret", mux_asset_id: "assetSecret" };
    const cases: Partial<VideoRow>[] = [
      { status: "rejected", mux_playback_id: "pbSecret" },
      { status: "removed", mux_playback_id: "pbSecret" },
      { status: "pending", mux_playback_id: "pbSecret" },
      { status: "ai_review", mux_playback_id: "pbSecret" },
      { status: "approved", mux_playback_id: "pbSecret" },
      { status: "approved", mux_playback_id: "pbSecret", first_shown_at: "2026-10-16T21:59:00.000Z" },
      { status: "uploading", mux_playback_id: null },
    ];
    for (const c of cases) {
      const v = video({ ...secrets, ...c, zone_id: Z1 });
      tables.apareca_videos = [v];
      forgetSnapshot(RID);
      const { d, assetInfo } = mk();
      assetInfo.mockResolvedValue({ status: "ready", assetId: "assetSecret", playbackId: "pbSecret", durationS: 6, mp4: true });
      const s = JSON.stringify(await myStatus(d, SLUG, ask(v)));
      for (const bad of ["ai_reason", "device_id", "table_id", "zone_id", "mux_", "nudez", DEV, TABLE_UID, Z1, "muxUploadSecret", "assetSecret", "pbSecret"]) {
        expect(s, `${c.status}: ${bad}`).not.toContain(bad);
      }
    }
  });
});

// ---------------------------------------------------------------- download

describe("downloadTarget e countDownload", () => {
  it("dono com vídeo aprovado e MP4 pronto → endereço do MP4; senão null", async () => {
    const v = video({ status: "approved", mux_asset_id: "aD", mux_playback_id: "pbD" });
    const p = video({ status: "pending", mux_asset_id: "aP", mux_playback_id: "pbP" });
    tables.apareca_videos = [v, p];
    const { d, assetInfo } = mk();
    assetInfo.mockResolvedValue({ status: "ready", assetId: "x", playbackId: "x", durationS: 6, mp4: true });
    expect(await downloadTarget(d, SLUG, v.id, DEV)).toMatch(/\/pbD\/highest\.mp4$/);
    expect(await downloadTarget(d, SLUG, v.id, DEV2)).toBeNull();
    expect(await downloadTarget(d, SLUG, p.id, DEV)).toBeNull();
    expect(await downloadTarget(d, SLUG, "lixo", DEV)).toBeNull();
    expect(await downloadTarget(d, "outra-casa", v.id, DEV)).toBeNull();
  });

  it("MP4 ainda não pronto → null", async () => {
    const v = video({ status: "approved", mux_asset_id: "aD", mux_playback_id: "pbD" });
    tables.apareca_videos = [v];
    const { d, assetInfo } = mk();
    assetInfo.mockResolvedValue({ status: "ready", assetId: "aD", playbackId: "pbD", durationS: 6, mp4: false });
    expect(await downloadTarget(d, SLUG, v.id, DEV)).toBeNull();
  });

  it("vencido → null", async () => {
    const v = video({ status: "approved", mux_asset_id: "aD", mux_playback_id: "pbD", expires_at: "2026-10-16T21:00:00.000Z" });
    tables.apareca_videos = [v];
    const { d, assetInfo } = mk();
    assetInfo.mockResolvedValue({ status: "ready", assetId: "aD", playbackId: "pbD", durationS: 6, mp4: true });
    expect(await downloadTarget(d, SLUG, v.id, DEV)).toBeNull();
  });

  it("countDownload soma 1 só para o dono de vídeo aprovado, até 5 por hora", async () => {
    const v = video({ status: "approved", mux_asset_id: "aD", mux_playback_id: "pbD", downloads: 2 });
    const p = video({ status: "pending" });
    tables.apareca_videos = [v, p];
    const { d } = mk();
    await countDownload(d, SLUG, { id: v.id, device: DEV2 });
    await countDownload(d, SLUG, { id: p.id, device: DEV });
    await countDownload(d, SLUG, { id: "x", device: DEV });
    expect(db.updateRows).not.toHaveBeenCalled();
    await countDownload(d, SLUG, { id: v.id, device: DEV });
    expect(db.updateRows).toHaveBeenCalledWith("apareca_videos", [{ Id: v.Id, downloads: 3 }]);
    for (let i = 0; i < 6; i++) {
      forgetSnapshot(RID);
      await countDownload(d, SLUG, { id: v.id, device: DEV });
    }
    expect(db.updateRows).toHaveBeenCalledTimes(5);
  });
});

// ---------------------------------------------------------------- publicHead

describe("limite por IP em meu, baixar e baixou", () => {
  it("o limite é 5.000/h (cerca de 10 celulares no mesmo Wi-Fi, um \"meu\" a cada 8 s)", () => {
    expect(READS_PER_HOUR).toBe(5_000);
  });
  it(`até ${READS_PER_HOUR}/h por IP e restaurante; o ${READS_PER_HOUR + 1}º pedido recebe too_many sem tocar no banco`, async () => {
    const v = video({ status: "approved", mux_asset_id: "aD", mux_playback_id: "pbD" });
    tables.apareca_videos = [v];
    const { d, assetInfo } = mk();
    assetInfo.mockResolvedValue({ status: "ready", assetId: "aD", playbackId: "pbD", durationS: 6, mp4: true });
    for (let i = 0; i < READS_PER_HOUR - 2; i++) {
      expect(await myStatus(d, SLUG, ask(v))).toMatchObject({ state: "queue" });
    }
    expect(await downloadTarget(d, SLUG, v.id, DEV)).toMatch(/highest\.mp4$/);
    expect(await countDownload(d, SLUG, ask(v))).toBeUndefined();
    // Passou do limite: as três recusam sem ler a fila nem o banco.
    db.list.mockClear();
    db.first.mockClear();
    db.updateRows.mockClear();
    forgetSnapshot(RID);
    expect(await myStatus(d, SLUG, ask(v))).toEqual({ error: "too_many" });
    expect(await downloadTarget(d, SLUG, v.id, DEV)).toBe("too_many");
    expect(await countDownload(d, SLUG, ask(v))).toBe("too_many");
    expect(db.list).not.toHaveBeenCalled();
    expect(db.first).not.toHaveBeenCalled();
    expect(db.updateRows).not.toHaveBeenCalled();
    // Outro IP no mesmo restaurante, ou o mesmo IP em outra casa, não é afetado.
    expect(await myStatus({ ...d, ip: "5.6.7.8" }, SLUG, ask(v))).toMatchObject({ state: "queue" });
    // Uma hora depois, volta.
    now = new Date(T0.getTime() + HOUR + 1);
    expect(await myStatus(d, SLUG, ask(v))).not.toEqual({ error: "too_many" });
  });
  it("chave por restaurante: o mesmo IP em outra casa tem a própria conta", async () => {
    const lim = createLimiter({ max: 1, windowMs: HOUR, now: () => now.getTime() });
    const other = mkHead({}, { id: OTHER_RID, slug: "outra" });
    const v = video({ status: "approved" });
    tables.apareca_videos = [v];
    const { d } = mk();
    const d2: SubmitDeps = { ...d, limits: { ...d.limits!, reads: lim }, getHead: async (s) => (s === SLUG ? head : s === "outra" ? other : null) };
    expect(await myStatus(d2, SLUG, ask(v))).toMatchObject({ state: "queue" });
    expect(await myStatus(d2, SLUG, ask(v))).toEqual({ error: "too_many" });
    expect(await myStatus(d2, "outra", ask(v))).toEqual({ error: "not_found" }); // passou do limite? não: é de outra casa
  });
});

describe("publicHead", () => {
  it("ligado e aberto", async () => {
    const { d } = mk();
    expect(await publicHead(d, SLUG)).toEqual({ enabled: true, open: true, why: null });
  });
  it("slug desconhecido → null", async () => {
    const { d } = mk();
    expect(await publicHead(d, "outra-casa")).toBeNull();
  });
  it("desligado: enabled false com o motivo", async () => {
    head = mkHead({}, { allowed: false });
    expect(await publicHead(mk().d, SLUG)).toEqual({ enabled: false, open: false, why: "not_allowed" });
    head = mkHead();
    expect(await publicHead(mk({ off: () => true }).d, SLUG)).toEqual({ enabled: false, open: false, why: "off" });
  });
  it("fechado ou pausado: enabled true, open false", async () => {
    head = mkHead({ hours: { from: "10:00", to: "11:00" } });
    expect(await publicHead(mk().d, SLUG)).toEqual({ enabled: true, open: false, why: "closed" });
    head = mkHead();
    expect(await publicHead(mk({ monthUsd: async () => 14 }).d, SLUG)).toEqual({ enabled: true, open: false, why: "paused" });
  });
});

describe("revisão final: A4 (mutações sobreviventes)", () => {
  it("2ª camada da mesa: o banco devolve mesa de outro restaurante mesmo com o where → table, sem envio", async () => {
    const other = tables.dining_tables.find((t) => t.restaurant_id === OTHER_RID)!;
    // Banco "quebrado": ignora o where e devolve a mesa da outra casa com o código pedido.
    const first = vi.fn(async (t: string, w: Row) => (t === "dining_tables" ? { ...other, code: w.code } : db.first(t, w)));
    const { d, createUpload } = mk({ db: { ...db, first } as unknown as SubmitDeps["db"] });
    expect(await startSubmission(d, SLUG, body())).toEqual({ ok: false, code: "table" });
    expect(createUpload).not.toHaveBeenCalled();
    expect(videos()).toHaveLength(0);
  });

  it("erro ao somar o uso do mês → envios PAUSADOS (falha fechada), no envio e no convite", async () => {
    const boom = async () => {
      throw new Error("nocodb 500");
    };
    const { d, createUpload } = mk({ monthUsd: boom });
    expect(await startSubmission(d, SLUG, body())).toEqual({ ok: false, code: "paused" });
    expect(createUpload).not.toHaveBeenCalled();
    expect(videos()).toHaveLength(0);
    expect(await publicHead(d, SLUG)).toEqual({ enabled: true, open: false, why: "paused" });
  });
});
