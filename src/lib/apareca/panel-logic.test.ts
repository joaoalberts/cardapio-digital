// Fila de moderação do painel (T10): aviso de vídeo novo (hasNew), vibração, montagem da fila e a
// decisão da equipe (aprovar, reprovar, remover), que confere o restaurante, só grava a partir dos
// estados permitidos, prevalece sobre a IA e apaga o asset do Mux ao reprovar ou remover.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoRow } from "./types";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => void fn(), connection: vi.fn() }));

const auth = vi.hoisted(() => ({ member: new Set<string>() }));
vi.mock("@/lib/auth", () => ({
  isMember: vi.fn(async (rid: string) => auth.member.has(rid)),
  isOwner: vi.fn(async () => false),
}));

// Banco falso: só igualdade, como o NocoDB; "uid" é o id público.
const fake = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[][],
  onUpdate: null as null | ((n: number) => void),
}));
vi.mock("@/lib/db/nocodb", () => {
  const match = (r: Record<string, unknown>, w: Record<string, unknown>) =>
    Object.entries(w).every(([k, v]) => (k === "uid" ? r.id === v : r[k] === v));
  return {
    first: vi.fn(async (_t: string, w: Record<string, unknown>) => {
      const r = fake.rows.find((x) => match(x, w));
      return r ? { ...r } : null;
    }),
    list: vi.fn(async (_t: string, w: Record<string, unknown> = {}) => fake.rows.filter((x) => match(x, w)).map((x) => ({ ...x }))),
    updateRows: vi.fn(async (_t: string, rows: Record<string, unknown>[]) => {
      fake.updates.push(rows);
      for (const p of rows) {
        const r = fake.rows.find((x) => x.Id === p.Id);
        if (r) Object.assign(r, p);
      }
      fake.onUpdate?.(fake.updates.length);
    }),
    insert: vi.fn(),
    removeIds: vi.fn(),
  };
});

const mux = vi.hoisted(() => ({ deleted: [] as string[], fail: false }));
vi.mock("@/lib/apareca/mux-video", () => ({
  deleteMuxAsset: vi.fn(async (id: string) => {
    if (mux.fail) throw new Error("mux 500");
    mux.deleted.push(id);
  }),
  hlsUrl: (p: string) => `https://stream.test/${p}.m3u8`,
  frameUrl: (p: string, t: number) => `https://image.test/${p}/thumbnail.jpg?time=${t}`,
}));

const store = vi.hoisted(() => ({ forgot: [] as string[] }));
vi.mock("@/lib/apareca/store", () => ({
  forgetSnapshot: vi.fn((rid: string) => store.forgot.push(rid)),
  readSnapshot: vi.fn(),
  readAparecaHeadFresh: vi.fn(async () => null),
  monthUsage: vi.fn(),
}));

import { approveVideo, rejectVideo, removeFromTv } from "@/app/painel/apareca/actions";
import {
  alertPattern, alertStep, hasNew, latestOnly, newestOf, NOTICE_MS, noticeOn, noticeText, queueItems, TEAM_ERRORS, type Notice, type QueueItem,
} from "./panel-logic";

const RID = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const VID = "11111111-1111-4111-8111-111111111111";

const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: VID, name: null, table_label: null, zone: null, status: "pending", hls: null, poster: null,
  created_at: "2026-10-16T22:00:00.000Z", plays: 0, plays_target: 1, ...over,
});

function video(over: Partial<VideoRow> = {}): VideoRow {
  return {
    Id: 1, id: VID, restaurant_id: RID, kind: "cliente", table_id: null, zone_id: null, device_id: "d".repeat(32), name: "Ana",
    consent_at: "2026-10-16T21:59:00.000Z", mux_upload_id: "up1", mux_asset_id: "asset1", mux_playback_id: "pb1",
    duration_ms: 6000, status: "pending", decided_by: null, decided_at: null, ai_reason: null, plays: 0, plays_target: 1,
    first_shown_at: null, downloads: 0, expires_at: "2026-10-17T04:00:00.000Z", created_at: "2026-10-16T22:00:00.000Z", ...over,
  };
}

beforeEach(() => {
  auth.member = new Set([RID]);
  fake.rows = [];
  fake.updates = [];
  fake.onUpdate = null;
  mux.deleted = [];
  mux.fail = false;
  store.forgot = [];
});

describe("hasNew", () => {
  const t1 = "2026-10-16T22:00:00.000Z";
  const t2 = "2026-10-16T22:00:05.000Z";
  it("primeira carga com pendente → true (o componente ignora a primeira resposta)", () => {
    expect(hasNew(null, [item({ created_at: t1 })])).toBe(true);
  });
  it("mesmo vídeo de antes → false; vídeo mais novo → true", () => {
    expect(hasNew(t1, [item({ created_at: t1 })])).toBe(false);
    expect(hasNew(t1, [item({ created_at: t1 }), item({ id: "x", created_at: t2 })])).toBe(true);
  });
  it("aprovado mais novo não avisa (só pendente pede ação)", () => {
    expect(hasNew(t1, [item({ status: "approved", created_at: t2 })])).toBe(false);
    expect(hasNew(null, [])).toBe(false);
  });
  it("data do NocoDB com espaço no lugar do T conta igual", () => {
    expect(hasNew(t1, [item({ created_at: "2026-10-16 22:00:05+00:00" })])).toBe(true);
    expect(hasNew(t1, [item({ created_at: "2026-10-16 22:00:00+00:00" })])).toBe(false);
  });
  it("newestOf: o pendente mais novo", () => {
    expect(newestOf([item({ created_at: t2 }), item({ created_at: t1 }), item({ status: "approved", created_at: "2026-10-17T00:00:00.000Z" })])).toBe(t2);
    expect(newestOf([])).toBeNull();
  });
});

describe("alertStep", () => {
  const t1 = "2026-10-16T22:00:00.000Z";
  const t2 = "2026-10-16T22:00:05.000Z";
  it("primeira leitura que falhou: a primeira consulta boa só define o newest, sem tocar", () => {
    const s = alertStep({ newest: null, primed: false }, [item({ created_at: t1 }), item({ id: "y", created_at: t2 })]);
    expect(s).toEqual({ newest: t2, primed: true, ring: false });
  });
  it("depois de pronta: vídeo novo toca e avança o newest; o mesmo não toca", () => {
    expect(alertStep({ newest: t1, primed: true }, [item({ created_at: t2 })])).toEqual({ newest: t2, primed: true, ring: true });
    expect(alertStep({ newest: t2, primed: true }, [item({ created_at: t2 })])).toEqual({ newest: t2, primed: true, ring: false });
  });
  it("o pendente mais novo foi aprovado: o newest não volta para trás (não toca de novo)", () => {
    expect(alertStep({ newest: t2, primed: true }, [item({ created_at: t1 })])).toEqual({ newest: t2, primed: true, ring: false });
  });
  it("carga inicial boa e vazia: o primeiro vídeo que chega toca", () => {
    expect(alertStep({ newest: null, primed: true }, [item({ created_at: t1 })]).ring).toBe(true);
  });
});

describe("noticeOn (mensagens da fila)", () => {
  const empty: Notice = { load: null, action: null };
  const decided = noticeOn(empty, { type: "action", text: TEAM_ERRORS.ai_rejected, at: 1_000 });
  it("a consulta que dá certo limpa o erro de leitura, nunca a mensagem da ação", () => {
    const n = noticeOn(decided, { type: "load_ok" });
    expect(noticeText(n)).toBe(TEAM_ERRORS.ai_rejected);
    const failed = noticeOn(empty, { type: "load_fail", text: "sem internet" });
    expect(noticeText(noticeOn(failed, { type: "load_ok" }))).toBeNull();
  });
  it("a mensagem da ação fica pelo menos 6 s (NOTICE_MS) e some depois do prazo", () => {
    expect(NOTICE_MS).toBeGreaterThanOrEqual(6_000);
    expect(noticeText(noticeOn(decided, { type: "tick", at: 1_000 + NOTICE_MS - 1 }))).toBe(TEAM_ERRORS.ai_rejected);
    expect(noticeText(noticeOn(decided, { type: "tick", at: 1_000 + NOTICE_MS }))).toBeNull();
  });
  it("tocar em fechar ou fazer outra ação que deu certo tira a mensagem", () => {
    expect(noticeText(noticeOn(decided, { type: "close" }))).toBeNull();
    expect(noticeText(noticeOn(decided, { type: "action", text: null, at: 2_000 }))).toBeNull();
  });
  it("mensagem da ação passa na frente do erro de leitura", () => {
    const both = noticeOn(noticeOn(empty, { type: "load_fail", text: "sem internet" }), { type: "action", text: TEAM_ERRORS.gone, at: 1 });
    expect(noticeText(both)).toBe(TEAM_ERRORS.gone);
    expect(noticeText(noticeOn(both, { type: "close" }))).toBe("sem internet");
  });
});

describe("latestOnly", () => {
  it("só a resposta do último pedido vale; uma em andamento bloqueia a consulta automática", () => {
    const q = latestOnly();
    expect(q.busy()).toBe(false);
    const a = q.begin();
    expect(q.busy()).toBe(true);
    const b = q.begin(); // run() pede uma leitura nova depois da ação
    q.end(b);
    expect(q.current(b)).toBe(true);
    expect(q.busy()).toBe(true); // a ainda não voltou
    q.end(a);
    expect(q.current(a)).toBe(false); // resposta antiga: descartada
    expect(q.busy()).toBe(false);
  });
  it("bump invalida o que já estava em andamento (ação local mais nova que a consulta)", () => {
    const q = latestOnly();
    const a = q.begin();
    q.bump();
    q.end(a);
    expect(q.current(a)).toBe(false);
  });
});

describe("alertPattern", () => {
  it("vibração curta: [150, 80, 150]", () => {
    expect(alertPattern()).toEqual([150, 80, 150]);
  });
});

describe("queueItems", () => {
  const ctx = {
    tables: new Map([["t1", "Mesa 4"]]),
    zones: [{ id: "z1", name: "Varanda" }],
    hls: (p: string) => `hls:${p}`,
    poster: (p: string) => `img:${p}`,
  };
  it("pendentes mais antigos primeiro, depois aprovados; outros estados ficam de fora", () => {
    const rows = [
      video({ id: "b", created_at: "2026-10-16T22:05:00.000Z" }),
      video({ id: "a", created_at: "2026-10-16T22:01:00.000Z" }),
      video({ id: "on", status: "approved" }),
      video({ id: "r", status: "rejected" }),
      video({ id: "ai", status: "ai_review" }),
      video({ id: "up", status: "uploading", mux_playback_id: null }),
    ];
    expect(queueItems(rows, ctx).map((i) => i.id)).toEqual(["a", "b", "on"]);
  });
  it("mesa, zona, vídeo e capa; zona apagada e mesa sem nome viram null; nada interno sai", () => {
    const [i] = queueItems([video({ table_id: "t1", zone_id: "z1" })], ctx);
    expect(i).toEqual({
      id: VID, name: "Ana", table_label: "Mesa 4", zone: "Varanda", status: "pending", hls: "hls:pb1", poster: "img:pb1",
      created_at: "2026-10-16T22:00:00.000Z", plays: 0, plays_target: 1,
    });
    const [j] = queueItems([video({ table_id: "t9", zone_id: "z9", mux_playback_id: null })], ctx);
    expect([j.table_label, j.zone, j.hls, j.poster]).toEqual([null, null, null, null]);
    expect(Object.keys(i)).not.toContain("device_id");
  });
});

describe("decisão da equipe (actions)", () => {
  it("mutação: aprovar vídeo de outro restaurante → erro, sem gravar", async () => {
    fake.rows = [video({ restaurant_id: OTHER })];
    auth.member = new Set([RID, OTHER]);
    expect((await approveVideo(RID, VID)).error).toBeTruthy();
    expect((await rejectVideo(RID, VID)).error).toBeTruthy();
    expect((await removeFromTv(RID, VID)).error).toBeTruthy();
    expect(fake.updates).toEqual([]);
    expect(mux.deleted).toEqual([]);
  });
  it("mutação: quem não é membro do restaurante → erro, sem gravar", async () => {
    fake.rows = [video()];
    auth.member = new Set();
    expect((await approveVideo(RID, VID)).error).toBeTruthy();
    expect(fake.updates).toEqual([]);
  });
  it("id inválido → erro, sem consultar o banco", async () => {
    fake.rows = [video()];
    expect((await approveVideo(RID, "1 or 1=1")).error).toBeTruthy();
    expect((await approveVideo("x", VID)).error).toBeTruthy();
    expect(fake.updates).toEqual([]);
  });
  it("aprovar pending → approved pela equipe, decided_at em ISO com T, esquece o retrato", async () => {
    fake.rows = [video()];
    expect(await approveVideo(RID, VID)).toEqual({});
    expect(fake.rows[0]).toMatchObject({ status: "approved", decided_by: "equipe" });
    expect(fake.rows[0].decided_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(store.forgot).toContain(RID);
    expect(mux.deleted).toEqual([]);
  });
  it("a equipe decide também uma linha ainda em ai_review", async () => {
    fake.rows = [video({ status: "ai_review", decided_at: "2026-10-16T22:00:01.000Z" })];
    expect(await approveVideo(RID, VID)).toEqual({});
    expect(fake.rows[0]).toMatchObject({ status: "approved", decided_by: "equipe" });
  });
  it("estado que não pede a ação → erro, sem gravar", async () => {
    fake.rows = [video({ status: "rejected" })];
    expect((await approveVideo(RID, VID)).error).toBeTruthy();
    fake.rows = [video({ status: "pending" })];
    expect((await removeFromTv(RID, VID)).error).toBeTruthy();
    fake.rows = [video({ status: "approved" })];
    expect((await rejectVideo(RID, VID)).error).toBeTruthy();
    expect(fake.updates).toEqual([]);
  });
  it("reprovar grava rejected e depois apaga o asset no Mux", async () => {
    fake.rows = [video()];
    expect(await rejectVideo(RID, VID)).toEqual({});
    expect(fake.rows[0]).toMatchObject({ status: "rejected", decided_by: "equipe" });
    expect(mux.deleted).toEqual(["asset1"]);
  });
  it("remover da TV: approved → removed e apaga o asset", async () => {
    fake.rows = [video({ status: "approved", decided_by: "equipe" })];
    expect(await removeFromTv(RID, VID)).toEqual({});
    expect(fake.rows[0]).toMatchObject({ status: "removed", decided_by: "equipe" });
    expect(mux.deleted).toEqual(["asset1"]);
  });
  it("Mux falhou ao apagar: o status continua rejected e a ação não dá erro (a varredura apaga depois)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fake.rows = [video()];
    mux.fail = true;
    expect(await rejectVideo(RID, VID)).toEqual({});
    expect(fake.rows[0].status).toBe("rejected");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it("a IA sobrescreveu no meio: a decisão da equipe é regravada (a equipe prevalece)", async () => {
    fake.rows = [video({ status: "ai_review" })];
    // Logo depois da gravação da equipe, a IA grava a aprovação dela por cima.
    fake.onUpdate = (n) => {
      if (n === 1) Object.assign(fake.rows[0], { status: "approved", decided_by: "ia", decided_at: "2026-10-16T22:00:30.000Z" });
    };
    expect(await rejectVideo(RID, VID)).toEqual({});
    expect(fake.updates).toHaveLength(2);
    expect(fake.rows[0]).toMatchObject({ status: "rejected", decided_by: "equipe" });
    expect(mux.deleted).toEqual(["asset1"]);
  });
  it("aprovar enquanto a IA reprovou (asset já apagado): não regrava approved e devolve aviso", async () => {
    fake.rows = [video({ status: "ai_review" })];
    fake.onUpdate = (n) => {
      if (n === 1) Object.assign(fake.rows[0], { status: "rejected", decided_by: "ia", decided_at: "2026-10-16 22:00:30+00:00" });
    };
    expect(await approveVideo(RID, VID)).toEqual({ error: TEAM_ERRORS.ai_rejected });
    expect(TEAM_ERRORS.ai_rejected).toBe("A análise automática reprovou este vídeo; a lista foi atualizada.");
    expect(fake.updates).toHaveLength(1);
    expect(fake.rows[0]).toMatchObject({ status: "rejected", decided_by: "ia" });
    expect(store.forgot).toContain(RID);
  });
  it("sem sobrescrita da IA, grava uma vez só", async () => {
    fake.rows = [video()];
    await approveVideo(RID, VID);
    expect(fake.updates).toHaveLength(1);
  });
});
