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
      status: "rejected", by: null, reason: "duração acima de 7 s", deleteAsset: true,
    });
    expect(onAssetReady({ duration_s: 6.4 }, "manual", false)).toEqual({ status: "pending" });
  });
  it("a duração reprova em qualquer modo, com ou sem IA; 7 s exatos passam", () => {
    for (const mode of ["manual", "hibrido", "automatico"] as ModMode[]) {
      for (const ai of [false, true]) expect(onAssetReady({ duration_s: 7.01 }, mode, ai).status).toBe("rejected");
    }
    expect(onAssetReady({ duration_s: 7 }, "manual", false)).toEqual({ status: "pending" });
  });
  it("item 6: duração 0 ou desconhecida → pending (equipe), nunca ai_review", () => {
    for (const duration_s of [0, -1, Number.NaN]) {
      expect(onAssetReady({ duration_s }, "automatico", true)).toEqual({ status: "pending" });
      expect(onAssetReady({ duration_s }, "hibrido", true)).toEqual({ status: "pending" });
    }
  });
  it("duração infinita reprova", () => {
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
  it("item 5: prazo da IA + 15 s: ai_review há 46 s → pending; há 44 s (veredito ainda pode chegar) → null", () => {
    const v = { status: "ai_review" as const, decided_at: T0.toISOString() };
    expect(resolveStuck(v, at(46_000))).toBe("pending");
    expect(resolveStuck(v, at(44_000))).toBeNull();
    expect(resolveStuck(v, at(31_000))).toBeNull();
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
    enabled: true, config: { ...DEFAULT_CONFIG, mode: "automatico", ...config }, logo_path: null,
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

const applyRows = async (_t: string, ps: Row[]) => {
  for (const p of ps) Object.assign(rows.find((x) => x.Id === p.Id) ?? {}, p);
};

beforeEach(() => {
  rows = [];
  now = T0;
  vi.clearAllMocks();
  db.updateRows.mockImplementation(applyRows);
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
    expect(urls).toHaveLength(6);
    for (const [k, t] of [0.5, 1.5, 2.5, 3.5, 4.5, 5.5].entries()) expect(urls[k]).toContain(`/pb1/thumbnail.jpg?time=${t}&`);
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

  it("ai_review já parado há mais de 45 s → pending sem chamar a IA", async () => {
    const v = vrow();
    rows = [{ ...v }];
    now = new Date(T0.getTime() + 46_000);
    const { d, fetch } = mk(say('{"aprovado":true,"motivo":""}'));
    await runModeration(d, v, mkHead());
    expect(fetch).not.toHaveBeenCalled();
    expect(row().status).toBe("pending");
  });

  it("item 3: vídeo curto usa os quadros que couberem (até duração − 0,2 s), no mínimo 1", async () => {
    for (const [ms, want] of [
      [2_000, [0.5, 1.5, 1.8]],
      [5_000, [0.5, 1.5, 2.5, 3.5, 4.5, 4.8]],
      [6_400, [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]],
      [300, [0.1]],
      [100, [0]],
    ] as [number, number[]][]) {
      const v = vrow({ duration_ms: ms });
      rows = [{ ...v }];
      const { d, fetch } = mk(say('{"aprovado":true,"motivo":""}'));
      await runModeration(d, v, mkHead());
      const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
      const times = body.messages[0].content
        .filter((c: { type: string }) => c.type === "image")
        .map((c: { source: { url: string } }) => Number(new URL(c.source.url).searchParams.get("time")));
      expect(times, `${ms} ms`).toEqual(want);
    }
  });

  it("item 6: duração 0 ou desconhecida → pending sem chamar a IA", async () => {
    for (const duration_ms of [0, null]) {
      const v = vrow({ duration_ms });
      rows = [{ ...v }];
      const { d, fetch } = mk(say('{"aprovado":true,"motivo":""}'));
      await runModeration(d, v, mkHead());
      expect(fetch).not.toHaveBeenCalled();
      expect(row().status).toBe("pending");
    }
  });

  it("item 1: o restaurante virou manual durante a chamada → o aprovado da IA termina pending", async () => {
    const v = vrow();
    rows = [{ ...v }];
    const freshHead = vi.fn(async () => mkHead({ mode: "manual" }));
    const { d } = mk(say('{"aprovado":true,"motivo":""}'), { freshHead });
    await runModeration(d, v, mkHead({ mode: "automatico" }));
    expect(freshHead).toHaveBeenCalledWith(RID);
    expect(row()).toMatchObject({ status: "pending", decided_by: null });
  });

  it("item 1: IA desligada no restaurante durante a chamada, ou leitura falhou → pending", async () => {
    for (const freshHead of [
      vi.fn(async () => mkHead({}, { ai_allowed: false })),
      vi.fn(async () => null),
      vi.fn(async () => {
        throw new Error("nocodb 500");
      }),
    ]) {
      const v = vrow();
      rows = [{ ...v }];
      const { d, deleteAsset } = mk(say('{"aprovado":false,"motivo":"arma"}'), { freshHead });
      await runModeration(d, v, mkHead({ mode: "automatico" }));
      expect(row()).toMatchObject({ status: "pending", decided_by: null });
      expect(deleteAsset).not.toHaveBeenCalled();
    }
  });

  it("item 1: híbrido virou automático durante a chamada → o aprovado vale como automático", async () => {
    const v = vrow();
    rows = [{ ...v }];
    const { d } = mk(say('{"aprovado":true,"motivo":""}'), { freshHead: async () => mkHead({ mode: "automatico" }) });
    await runModeration(d, v, mkHead({ mode: "hibrido" }));
    expect(row()).toMatchObject({ status: "approved", decided_by: "ia" });
  });

  it("item 4: a equipe reprova entre a releitura e a gravação da IA → a reprovação da equipe prevalece", async () => {
    const v = vrow();
    rows = [{ ...v }];
    const { d, deleteAsset } = mk(say('{"aprovado":true,"motivo":""}'));
    const teamAt = new Date(T0.getTime() + 5_000).toISOString();
    // O PATCH da equipe chega ao banco logo depois do da IA (corrida entre os dois pedidos).
    db.updateRows.mockImplementation(async (_t: string, ps: Row[]) => {
      for (const p of ps) Object.assign(rows.find((x) => x.Id === p.Id) ?? {}, p);
      if (ps[0]?.status === "approved" && ps[0]?.decided_by === "ia") {
        Object.assign(rows[0], { status: "rejected", decided_by: "equipe", decided_at: teamAt, ai_reason: null });
      }
    });
    now = new Date(T0.getTime() + 1_000);
    await runModeration(d, v, mkHead());
    expect(row()).toMatchObject({ status: "rejected", decided_by: "equipe", decided_at: teamAt });
    const last = db.updateRows.mock.calls.at(-1)?.[1] as Row[];
    expect(last[0]).toMatchObject({ status: "rejected", decided_by: "equipe", decided_at: teamAt }); // regravado
    expect(deleteAsset).not.toHaveBeenCalled(); // a equipe apaga pelo painel
  });

  it("item 4: a IA reprova e a equipe aprova no meio → fica aprovado e o asset não é apagado", async () => {
    const v = vrow();
    rows = [{ ...v }];
    const { d, deleteAsset } = mk(say('{"aprovado":false,"motivo":"arma"}'));
    const teamAt = new Date(T0.getTime() + 5_000).toISOString();
    db.updateRows.mockImplementation(async (_t: string, ps: Row[]) => {
      for (const p of ps) Object.assign(rows.find((x) => x.Id === p.Id) ?? {}, p);
      if (ps[0]?.status === "rejected" && ps[0]?.decided_by === "ia") {
        Object.assign(rows[0], { status: "approved", decided_by: "equipe", decided_at: teamAt, ai_reason: null });
      }
    });
    await runModeration(d, v, mkHead());
    expect(row()).toMatchObject({ status: "approved", decided_by: "equipe" });
    expect(deleteAsset).not.toHaveBeenCalled();
  });

  it("item 4: outra gravação da IA aprovou por cima da reprovação → volta para rejected", async () => {
    const v = vrow();
    rows = [{ ...v }];
    const { d, deleteAsset } = mk(say('{"aprovado":false,"motivo":"arma"}'));
    let once = true;
    db.updateRows.mockImplementation(async (_t: string, ps: Row[]) => {
      for (const p of ps) Object.assign(rows.find((x) => x.Id === p.Id) ?? {}, p);
      if (once && ps[0]?.status === "rejected") {
        once = false;
        Object.assign(rows[0], { status: "approved", decided_by: "ia", ai_reason: null }); // instância atrasada
      }
    });
    await runModeration(d, v, mkHead());
    expect(row()).toMatchObject({ status: "rejected", decided_by: "ia", ai_reason: "arma" });
    expect(deleteAsset).toHaveBeenCalledWith("asset1");
  });

  it("correção T10: data da equipe no formato do NocoDB (espaço, +00:00) mais nova que a da IA → a equipe é regravada", async () => {
    const v = vrow();
    rows = [{ ...v }];
    const { d } = mk(say('{"aprovado":false,"motivo":"arma"}'));
    // A equipe também reprovou, 5 s depois; o NocoDB devolve a data sem "T" e sem milissegundos.
    const teamAt = "2026-10-16 22:00:05+00:00";
    db.updateRows.mockImplementation(async (_t: string, ps: Row[]) => {
      for (const p of ps) Object.assign(rows.find((x) => x.Id === p.Id) ?? {}, p);
      if (ps[0]?.status === "rejected" && ps[0]?.decided_by === "ia") {
        Object.assign(rows[0], { status: "rejected", decided_by: "equipe", decided_at: teamAt, ai_reason: null });
      }
    });
    await runModeration(d, v, mkHead());
    const last = db.updateRows.mock.calls.at(-1)?.[1] as Row[];
    expect(last[0]).toMatchObject({ status: "rejected", decided_by: "equipe", decided_at: teamAt });
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
