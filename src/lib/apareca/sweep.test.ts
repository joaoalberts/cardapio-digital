// Varredura do cron diário (rede de segurança): lista a tabela inteira, sem olhar se o Apareça
// está ligado, e passa vencidos e envios presos ao purge. Banco e Mux falsos.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoRow } from "./types";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const store: Record<string, Row[]> = {};
  const match = (r: Row, w: Record<string, unknown>) => Object.entries(w).every(([k, v]) => (r[k] ?? null) === v);
  const db = {
    list: vi.fn(async (t: string, w: Record<string, unknown> = {}) =>
      (store[t] ?? []).filter((r) => match(r, w)).map((r) => ({ ...r })),
    ),
    first: vi.fn(async (t: string, w: Record<string, unknown>) => {
      const r = (store[t] ?? []).find((x) => match(x, w));
      return r ? { ...r } : null;
    }),
    insert: vi.fn(async (t: string, rows: Row[]) => {
      (store[t] ??= []).push(...rows);
      return rows;
    }),
    removeIds: vi.fn(async (t: string, ids: number[]) => {
      store[t] = (store[t] ?? []).filter((r) => !ids.includes(r.Id as number));
    }),
  };
  return { store, db };
});

vi.mock("@/lib/db/nocodb", () => h.db);

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

function deps(deleteAsset: (id: string) => Promise<void> = async () => {}) {
  return {
    db: h.db as unknown as import("./store").StoreDb,
    mux: { deleteAsset: vi.fn(deleteAsset), releaseUpload: vi.fn(async () => {}) },
    now: () => T0,
  };
}

let sweep: typeof import("./sweep");
beforeEach(async () => {
  for (const k of Object.keys(h.store)) delete h.store[k];
  vi.clearAllMocks();
  vi.resetModules();
  sweep = await import("./sweep");
});

describe("runAparecaSweep", () => {
  it("apaga o vencido de restaurante com o Apareça desligado e deixa o aprovado no prazo", async () => {
    // O restaurante RID2 nem tem o Apareça ligado: o prazo vale para todo dado coletado.
    h.store.restaurants = [{ uid: RID2, apareca_enabled: false, apareca_allowed: false }];
    const velho = expired({ restaurant_id: RID2 });
    const novo = video();
    h.store.apareca_videos = [velho, novo];
    const d = deps();

    const r = await sweep.runAparecaSweep(d);

    expect(r).toEqual({ deleted: 1, failed: 0 });
    expect(d.mux.deleteAsset).toHaveBeenCalledTimes(1);
    expect(d.mux.deleteAsset).toHaveBeenCalledWith(velho.mux_asset_id);
    expect(h.store.apareca_videos.map((v) => v.Id)).toEqual([novo.Id]);
  });

  it("lista a tabela inteira, sem where", async () => {
    h.store.apareca_videos = [video(), video({ restaurant_id: RID2 })];
    await sweep.runAparecaSweep(deps());
    expect(h.db.list).toHaveBeenCalledWith("apareca_videos");
  });

  it("envio parado sem asset também sai, e o upload é liberado no Mux", async () => {
    const preso = video({
      status: "uploading", mux_asset_id: null, created_at: "2026-10-16T10:00:00.000Z",
      expires_at: "2026-10-16T20:00:00.000Z",
    });
    h.store.apareca_videos = [preso];
    const d = deps();
    const r = await sweep.runAparecaSweep(d);
    expect(r).toEqual({ deleted: 1, failed: 0 });
    expect(d.mux.releaseUpload).toHaveBeenCalledWith(preso.mux_upload_id);
    expect(h.store.apareca_videos).toEqual([]);
  });

  it("falha no Mux de uma casa não segura as outras; a que falhou fica para amanhã", async () => {
    const ruim = expired({ restaurant_id: RID2, mux_asset_id: "ruim" });
    const bom1 = expired();
    const bom2 = expired();
    h.store.apareca_videos = [ruim, bom1, bom2];
    const d = deps(async (id) => {
      if (id === "ruim") throw new Error("mux 500");
    });

    const r = await sweep.runAparecaSweep(d);

    expect(r).toEqual({ deleted: 2, failed: 1 });
    expect(h.store.apareca_videos.map((v) => v.Id)).toEqual([ruim.Id]);
  });

  it("tabela vazia ou só com vídeos no prazo: nada a apagar", async () => {
    const d = deps();
    expect(await sweep.runAparecaSweep(d)).toEqual({ deleted: 0, failed: 0 });
    h.store.apareca_videos = [video()];
    expect(await sweep.runAparecaSweep(d)).toEqual({ deleted: 0, failed: 0 });
    expect(d.mux.deleteAsset).not.toHaveBeenCalled();
  });
});
