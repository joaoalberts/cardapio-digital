// Rotas do cliente sem o Next: envio (aceite, mesa, horário, teto, limites), "meu vídeo"
// (estados, Mux consultado com calma, vencido apagado) e download. Banco, Mux e relógio falsos.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLimiter } from "@/lib/comunidade/limiter";
import { DEFAULT_CONFIG } from "./config";
import type { AparecaConfig, AparecaHead, VideoRow } from "./types";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock("@/lib/db/nocodb", () => ({ list: vi.fn(), first: vi.fn(), insert: vi.fn(), removeIds: vi.fn() }));

import { forgetSnapshot } from "./store";
import {
  countDownload, downloadTarget, myStatus, publicHead, startSubmission, type SubmitDeps, type SubmitLimits,
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
    enabled: true, community_enabled: true, config: { ...DEFAULT_CONFIG, ...config }, logo_path: null, brand_color: null, instagram: null, ...p,
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
  const byMax = new Map<number, ReturnType<typeof createLimiter>>();
  return {
    ip: createLimiter({ max: 10, windowMs: HOUR, now: clock }),
    device: (max) => {
      let l = byMax.get(max);
      if (!l) byMax.set(max, (l = createLimiter({ max, windowMs: HOUR, now: clock })));
      return l;
    },
    download: createLimiter({ max: 5, windowMs: HOUR, now: clock }),
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

const body = (p: Record<string, unknown> = {}) => ({ mesa: "ABC234", device: DEV, name: "  @Ana ", consent: true, consent_at: "2026-10-16T21:58:00.000Z", ...p });
const videos = () => (tables.apareca_videos ?? []) as unknown as VideoRow[];

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables.dining_tables = [
    { Id: 1, id: TABLE_UID, uid: TABLE_UID, restaurant_id: RID, code: "ABC234", active: true },
    { Id: 2, id: "t-off", uid: "t-off", restaurant_id: RID, code: "OFF234", active: false },
    { Id: 3, id: "t-other", uid: "t-other", restaurant_id: OTHER_RID, code: "XYZ234", active: true },
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
    ["sem Comunidade", () => ({}), { community_enabled: false }],
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

  it("3º envio do mesmo device na mesma hora → too_many (device_per_hour 2); uma hora depois, passa", async () => {
    head = mkHead({ device_per_hour: 2 });
    const { d } = mk();
    expect((await startSubmission(d, SLUG, body())).ok).toBe(true);
    now = new Date(T0.getTime() + 60_000);
    expect((await startSubmission(d, SLUG, body())).ok).toBe(true);
    now = new Date(T0.getTime() + 120_000);
    expect(await startSubmission(d, SLUG, body())).toEqual({ ok: false, code: "too_many" });
    expect(videos()).toHaveLength(2);
    now = new Date(T0.getTime() + HOUR + 61_000);
    expect((await startSubmission(d, SLUG, body())).ok).toBe(true);
  });

  it("o limite do device vale mesmo em outra instância (linhas do banco na última hora)", async () => {
    head = mkHead({ device_per_hour: 2 });
    tables.apareca_videos = [video({ created_at: "2026-10-16T21:30:00.000Z" }), video({ created_at: "2026-10-16T21:40:00.000Z" })];
    const { d } = mk();
    expect(await startSubmission(d, SLUG, body())).toEqual({ ok: false, code: "too_many" });
  });

  it("11º envio do mesmo IP na mesma hora → too_many", async () => {
    const { d } = mk();
    for (let i = 0; i < 10; i++) {
      const dev = `00000000-0000-4000-8000-${String(900 + i).padStart(12, "0")}`;
      expect((await startSubmission(d, SLUG, body({ device: dev }))).ok).toBe(true);
    }
    expect(await startSubmission(d, SLUG, body({ device: DEV2 }))).toEqual({ ok: false, code: "too_many" });
    expect(videos()).toHaveLength(10);
  });

  it("Mux falhou → mux, sem linha, e a tentativa não gasta o limite", async () => {
    head = mkHead({ device_per_hour: 1 });
    const bad = mk();
    bad.createUpload.mockRejectedValueOnce(new Error("mux 500"));
    expect(await startSubmission(bad.d, SLUG, body())).toEqual({ ok: false, code: "mux" });
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

  it("approved → queue; com first_shown_at → on_tv; plays >= plays_target → shown", async () => {
    const q = video({ status: "approved", mux_asset_id: "a1", mux_playback_id: "p1" });
    const tv = video({ status: "approved", mux_asset_id: "a2", mux_playback_id: "p2", first_shown_at: "2026-10-16T21:59:00.000Z" });
    const done = video({ status: "approved", mux_asset_id: "a3", mux_playback_id: "p3", first_shown_at: "2026-10-16T21:59:00.000Z", plays: 1, plays_target: 1 });
    tables.apareca_videos = [q, tv, done];
    const { d } = mk();
    expect(await myStatus(d, SLUG, ask(q))).toMatchObject({ state: "queue", position: 1 });
    expect(await myStatus(d, SLUG, ask(tv))).toMatchObject({ state: "on_tv", first_shown_at: "2026-10-16T21:59:00.000Z" });
    expect(await myStatus(d, SLUG, ask(done))).toMatchObject({ state: "shown", position: null, eta_ms: null });
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
