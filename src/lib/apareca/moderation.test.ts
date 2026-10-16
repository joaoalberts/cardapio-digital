// Máquina de moderação do Apareça: duração acima de 7 s reprova sozinha (Foco 1), o modo vira manual
// sem IA, o veredito da IA só decide no automático (e no híbrido só reprova), erro vira fila manual,
// ai_review parado há mais de 30 s vira pending, e runModeration nunca grava sobre uma decisão já tomada.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "./config";
import type { AparecaConfig, AparecaHead, ModMode, VideoRow } from "./types";

vi.mock("server-only", () => ({}));

import { applyVerdict, onAssetReady, resolveStuck, runModeration, type ModerationDeps } from "./moderation";

const RID = "00000000-0000-4000-8000-000000000001";
const T0 = new Date("2026-10-16T22:00:00.000Z");

describe("onAssetReady", () => {
  it("Foco 1: 30 s → rejected com deleteAsset e motivo interno; 6,4 s → pending", () => {
    expect(onAssetReady({ duration_s: 30 }, "manual", false)).toEqual({
      status: "rejected", by: "ia", reason: "duração acima de 7 s", deleteAsset: true,
    });
    expect(onAssetReady({ duration_s: 6.4 }, "manual", false)).toEqual({ status: "pending" });
  });
  it("a duração reprova em qualquer modo, com ou sem IA; 7 s exatos passam", () => {
    for (const mode of ["manual", "hibrido", "automatico"] as ModMode[]) {
      for (const ai of [false, true]) expect(onAssetReady({ duration_s: 7.01 }, mode, ai).status).toBe("rejected");
    }
    expect(onAssetReady({ duration_s: 7 }, "manual", false)).toEqual({ status: "pending" });
  });
  it("duração inválida (NaN, infinita) reprova", () => {
    expect(onAssetReady({ duration_s: Number.NaN }, "manual", false).status).toBe("rejected");
    expect(onAssetReady({ duration_s: Number.POSITIVE_INFINITY }, "automatico", true).status).toBe("rejected");
  });
  it("híbrido/automático sem IA → pending; com IA → ai_review; manual com IA → pending", () => {
    expect(onAssetReady({ duration_s: 6 }, "hibrido", false)).toEqual({ status: "pending" });
    expect(onAssetReady({ duration_s: 6 }, "automatico", false)).toEqual({ status: "pending" });
    expect(onAssetReady({ duration_s: 6 }, "hibrido", true)).toEqual({ status: "ai_review" });
    expect(onAssetReady({ duration_s: 6 }, "automatico", true)).toEqual({ status: "ai_review" });
    expect(onAssetReady({ duration_s: 6 }, "manual", true)).toEqual({ status: "pending" });
  });
});

describe("applyVerdict", () => {
  const ok = { aprovado: true, motivo: "" };
  const bad = { aprovado: false, motivo: "arma" };
  it("automático: aprovado → approved por ia; reprovado → rejected por ia", () => {
    expect(applyVerdict("automatico", ok)).toEqual({ status: "approved", by: "ia", reason: null });
    expect(applyVerdict("automatico", bad)).toEqual({ status: "rejected", by: "ia", reason: "arma" });
  });
  it("híbrido: reprovado → rejected; aprovado → pending (vai para a equipe)", () => {
    expect(applyVerdict("hibrido", bad)).toEqual({ status: "rejected", by: "ia", reason: "arma" });
    expect(applyVerdict("hibrido", ok)).toEqual({ status: "pending", by: null, reason: null });
  });
  it("manual nunca deixa a IA decidir", () => {
    expect(applyVerdict("manual", ok).status).toBe("pending");
    expect(applyVerdict("manual", bad).status).toBe("pending");
  });
  it("qualquer modo + null (erro) → pending", () => {
    for (const mode of ["manual", "hibrido", "automatico"] as ModMode[]) {
      expect(applyVerdict(mode, null)).toEqual({ status: "pending", by: null, reason: null });
    }
  });
  it("reprovado sem motivo ganha um motivo interno", () => {
    expect(applyVerdict("automatico", { aprovado: false, motivo: "  " }).reason).toBeTruthy();
  });
});

describe("resolveStuck", () => {
  const at = (ms: number) => new Date(T0.getTime() + ms);
  it("ai_review há 31 s → pending; há 29 s → null", () => {
    const v = { status: "ai_review" as const, decided_at: T0.toISOString() };
    expect(resolveStuck(v, at(31_000))).toBe("pending");
    expect(resolveStuck(v, at(29_000))).toBeNull();
  });
  it("ai_review sem carimbo (ou inválido) → pending", () => {
    expect(resolveStuck({ status: "ai_review", decided_at: null }, T0)).toBe("pending");
    expect(resolveStuck({ status: "ai_review", decided_at: "xx" }, T0)).toBe("pending");
  });
  it("outros estados nunca mudam", () => {
    for (const status of ["pending", "approved", "rejected", "uploading"] as const) {
      expect(resolveStuck({ status, decided_at: "2026-10-16T00:00:00.000Z" }, at(3_600_000))).toBeNull();
    }
  });
});

// ---------------------------------------------------------------- runModeration

type Row = Record<string, unknown>;
let rows: Row[] = [];
const db = {
  first: vi.fn(async (_t: string, w: Row) => {
    const r = rows.find((x) => Object.entries(w).every(([k, v]) => x[k] === v));
    return r ? { ...r } : null;
  }),
  updateRows: vi.fn(async (_t: string, ps: Row[]) => {
    for (const p of ps) Object.assign(rows.find((x) => x.Id === p.Id) ?? {}, p);
  }),
};
let now = T0;

function mkHead(config: Partial<AparecaConfig> = {}, p: Partial<AparecaHead> = {}): AparecaHead {
  return {
    id: RID, slug: "casa", name: "Casa", timezone: "America/Sao_Paulo", opening_hours: null, allowed: true, ai_allowed: true,
    enabled: true, community_enabled: true, config: { ...DEFAULT_CONFIG, mode: "automatico", ...config }, logo_path: null,
    brand_color: null, instagram: null, ...p,
  };
}

function vrow(p: Partial<VideoRow> = {}): VideoRow {
  const id = "00000000-0000-4000-8000-000000000101";
  return {
    Id: 7, id, uid: id, restaurant_id: RID, kind: "cliente", table_id: null, zone_id: null, device_id: "d", name: null,
    consent_at: T0.toISOString(), mux_upload_id: "up1", mux_asset_id: "asset1", mux_playback_id: "pb1", duration_ms: 6_000,
    status: "ai_review", decided_by: null, decided_at: T0.toISOString(), ai_reason: null, plays: 0, plays_target: 1,
    first_shown_at: null, downloads: 0, expires_at: "2026-10-17T04:00:00.000Z", created_at: T0.toISOString(), ...p,
  } as VideoRow;
}

function mk(fetchImpl: () => Promise<Response>, over: Partial<ModerationDeps> = {}) {
  const deleteAsset = vi.fn<(id: string) => Promise<void>>(async () => {});
  const forget = vi.fn();
  const fetch = vi.fn(fetchImpl);
  const d: ModerationDeps = {
    db: db as unknown as ModerationDeps["db"],
    deleteAsset,
    key: "sk-test",
    model: "modelo-x",
    fetch: fetch as unknown as typeof globalThis.fetch,
    now: () => now,
    forget,
    off: () => false,
    ...over,
  };
  return { d, deleteAsset, forget, fetch };
}
const say = (text: string) => async () => new Response(JSON.stringify({ content: [{ type: "text", text }] }));
const row = () => rows[0] as unknown as VideoRow;

beforeEach(() => {
  rows = [];
  now = T0;
  vi.clearAllMocks();
});

describe("runModeration", () => {
  it("fetch que lança → a linha termina pending, sem decisão da IA", async () => {
    const v = vrow();
    rows = [{ ...v }];
    const { d, deleteAsset, forget } = mk(async () => {
      throw new Error("rede");
    });
    await runModeration(d, v, mkHead());
    expect(row()).toMatchObject({ status: "pending", decided_by: null });
    expect(deleteAsset).not.toHaveBeenCalled();
    expect(forget).toHaveBeenCalledWith(RID);
  });

  it("grava ai_review com decided_at = agora antes da chamada", async () => {
    const v = vrow({ decided_at: "2026-10-16T21:59:55.000Z" });
    rows = [{ ...v }];
    now = new Date(T0.getTime() + 1_000);
    let seen: Row | null = null;
    const { d } = mk(async () => {
      seen = { ...rows[0] };
      return new Response(JSON.stringify({ content: [{ type: "text", text: '{"aprovado":true,"motivo":""}' }] }));
    });
    await runModeration(d, v, mkHead());
    expect(seen).toMatchObject({ status: "ai_review", decided_at: now.toISOString() });
  });

  it("automático + reprovado → rejected por ia, ai_reason no banco e deleteMuxAsset chamado", async () => {
    const v = vrow();
    rows = [{ ...v }];
    const { d, deleteAsset, fetch } = mk(say('{"aprovado":false,"motivo":"gesto obsceno"}'));
    await runModeration(d, v, mkHead());
    expect(row()).toMatchObject({ status: "rejected", decided_by: "ia", ai_reason: "gesto obsceno" });
    expect(deleteAsset).toHaveBeenCalledWith("asset1");
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    const urls = body.messages[0].content.filter((c: { type: string }) => c.type === "image").map((c: { source: { url: string } }) => c.source.url);
    expect(urls).toHaveLength(3);
    for (const [k, t] of [0.5, 3, 5.5].entries()) expect(urls[k]).toContain(`/pb1/thumbnail.jpg?time=${t}`);
  });

  it("apagar o asset falhou: a linha continua rejected (a retenção apaga depois)", async () => {
    const v = vrow();
    rows = [{ ...v }];
    const { d, deleteAsset } = mk(say('{"aprovado":false,"motivo":"arma"}'));
    deleteAsset.mockRejectedValueOnce(new Error("mux 503"));
    await runModeration(d, v, mkHead());
    expect(row().status).toBe("rejected");
  });

  it("automático + aprovado → approved por ia", async () => {
    const v = vrow();
    rows = [{ ...v }];
    const { d } = mk(say('{"aprovado":true,"motivo":""}'));
    await runModeration(d, v, mkHead());
    expect(row()).toMatchObject({ status: "approved", decided_by: "ia" });
  });

  it("híbrido + aprovado → pending (a equipe decide)", async () => {
    const v = vrow();
    rows = [{ ...v }];
    const { d } = mk(say('{"aprovado":true,"motivo":""}'));
    await runModeration(d, v, mkHead({ mode: "hibrido" }));
    expect(row()).toMatchObject({ status: "pending", decided_by: null });
  });

  it("IA desligada no meio do caminho (ai_allowed false, sem chave ou off) → pending sem chamar a API", async () => {
    for (const [over, head] of [
      [{}, mkHead({}, { ai_allowed: false })],
      [{ key: undefined }, mkHead()],
      [{ off: () => true }, mkHead()],
    ] as [Partial<ModerationDeps>, AparecaHead][]) {
      const v = vrow();
      rows = [{ ...v }];
      const { d, fetch } = mk(say('{"aprovado":true,"motivo":""}'), over);
      await runModeration(d, v, head);
      expect(fetch).not.toHaveBeenCalled();
      expect(row().status).toBe("pending");
    }
  });

  it("decisão 2: linha já rejected ou approved → nada é gravado nem chamado", async () => {
    for (const status of ["rejected", "approved", "pending", "removed"] as const) {
      const v = vrow();
      rows = [{ ...v, status }];
      const { d, fetch, deleteAsset } = mk(say('{"aprovado":true,"motivo":""}'));
      await runModeration(d, v, mkHead());
      expect(fetch).not.toHaveBeenCalled();
      expect(db.updateRows).not.toHaveBeenCalled();
      expect(deleteAsset).not.toHaveBeenCalled();
      expect(row().status).toBe(status);
    }
  });

  it("decisão 2: a equipe decidiu durante a chamada → o veredito não sobrescreve", async () => {
    const v = vrow();
    rows = [{ ...v }];
    const { d, deleteAsset } = mk(async () => {
      rows[0].status = "rejected";
      rows[0].decided_by = "equipe";
      return new Response(JSON.stringify({ content: [{ type: "text", text: '{"aprovado":true,"motivo":""}' }] }));
    });
    await runModeration(d, v, mkHead());
    expect(row()).toMatchObject({ status: "rejected", decided_by: "equipe" });
    expect(deleteAsset).not.toHaveBeenCalled();
  });

  it("decisão 2: duas chamadas seguidas → a segunda não chama a IA nem grava", async () => {
    const v = vrow();
    rows = [{ ...v }];
    const { d, fetch } = mk(say('{"aprovado":true,"motivo":""}'));
    await runModeration(d, v, mkHead());
    const writes = db.updateRows.mock.calls.length;
    await runModeration(d, v, mkHead());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(db.updateRows.mock.calls.length).toBe(writes);
    expect(row().status).toBe("approved");
  });

  it("ai_review já parado há mais de 30 s → pending sem chamar a IA", async () => {
    const v = vrow();
    rows = [{ ...v }];
    now = new Date(T0.getTime() + 31_000);
    const { d, fetch } = mk(say('{"aprovado":true,"motivo":""}'));
    await runModeration(d, v, mkHead());
    expect(fetch).not.toHaveBeenCalled();
    expect(row().status).toBe("pending");
  });

  it("sem playback id → pending sem chamar a IA", async () => {
    const v = vrow({ mux_playback_id: null });
    rows = [{ ...v }];
    const { d, fetch } = mk(say('{"aprovado":true,"motivo":""}'));
    await runModeration(d, v, mkHead());
    expect(fetch).not.toHaveBeenCalled();
    expect(row().status).toBe("pending");
  });
});
