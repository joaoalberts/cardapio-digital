// Fila de moderação do painel (T10): aviso de vídeo novo (hasNew), vibração, montagem da fila e a
// decisão da equipe (aprovar, reprovar, remover), que confere o restaurante, só grava a partir dos
// estados permitidos, prevalece sobre a IA e apaga o asset do Mux ao reprovar ou remover.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AparecaConfig, VideoRow } from "./types";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => void fn(), connection: vi.fn() }));

const auth = vi.hoisted(() => ({ member: new Set<string>(), owner: new Set<string>() }));
vi.mock("@/lib/auth", () => ({
  isMember: vi.fn(async (rid: string) => auth.member.has(rid)),
  isOwner: vi.fn(async (rid: string) => auth.owner.has(rid)),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "http://localhost:3000" }) }));

// Banco falso: só igualdade, como o NocoDB; "uid" é o id público. fake.rows vale para qualquer
// tabela que não esteja em fake.tables (a fila da T10 usa só apareca_videos).
const fake = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  tables: {} as Record<string, Record<string, unknown>[]>,
  updates: [] as Record<string, unknown>[][],
  writes: [] as { t: string; rows: Record<string, unknown>[] }[],
  inserted: [] as { t: string; rows: Record<string, unknown>[] }[],
  removed: [] as { t: string; ids: number[] }[],
  onUpdate: null as null | ((n: number) => void),
}));
vi.mock("@/lib/db/nocodb", () => {
  const match = (r: Record<string, unknown>, w: Record<string, unknown>) =>
    Object.entries(w).every(([k, v]) => (k === "uid" ? r.id === v : r[k] === v));
  const src = (t: string) => fake.tables[t] ?? fake.rows;
  return {
    first: vi.fn(async (t: string, w: Record<string, unknown>) => {
      const r = src(t).find((x) => match(x, w));
      return r ? { ...r } : null;
    }),
    list: vi.fn(async (t: string, w: Record<string, unknown> = {}) => src(t).filter((x) => match(x, w)).map((x) => ({ ...x }))),
    updateRows: vi.fn(async (t: string, rows: Record<string, unknown>[]) => {
      fake.updates.push(rows);
      fake.writes.push({ t, rows });
      for (const p of rows) {
        const r = src(t).find((x) => x.Id === p.Id);
        if (r) Object.assign(r, p);
      }
      fake.onUpdate?.(fake.updates.length);
    }),
    insert: vi.fn(async (t: string, rows: Record<string, unknown>[]) => {
      fake.inserted.push({ t, rows });
      const out = rows.map((r, k) => ({ Id: 900 + k, id: (r.uid as string) ?? `new-${k}`, ...r }));
      (fake.tables[t] ??= []).push(...out);
      return out;
    }),
    removeIds: vi.fn(async (t: string, ids: number[]) => {
      fake.removed.push({ t, ids });
      if (fake.tables[t]) fake.tables[t] = fake.tables[t].filter((x) => !ids.includes(x.Id as number));
    }),
  };
});

const mux = vi.hoisted(() => ({
  deleted: [] as string[],
  fail: false,
  passthrough: [] as string[],
  released: [] as string[],
  info: {} as Record<string, unknown>,
}));
vi.mock("@/lib/apareca/mux-video", () => ({
  deleteMuxAsset: vi.fn(async (id: string) => {
    if (mux.fail) throw new Error("mux 500");
    mux.deleted.push(id);
  }),
  createAparecaUpload: vi.fn(async (_origin: string, passthrough: string) => {
    mux.passthrough.push(passthrough);
    return { id: "upNew1", url: "https://upload.test/upNew1" };
  }),
  assetInfo: vi.fn(async (up: string) => mux.info[up] ?? { status: "processing" }),
  releaseMuxUpload: vi.fn(async (up: string) => {
    if (mux.fail) throw new Error("mux 500");
    mux.released.push(up);
  }),
  hlsUrl: (p: string) => `https://stream.test/${p}.m3u8`,
  frameUrl: (p: string, t: number) => `https://image.test/${p}/thumbnail.jpg?time=${t}`,
}));

const store = vi.hoisted(() => ({ forgot: [] as string[] }));
vi.mock("@/lib/apareca/store", () => ({
  // As tags de verdade (prefixos apareca:slug: e apareca:rid:), sem o resto do store.ts.
  aparecaTags: { slug: (s: string) => `apareca:slug:${s}`, rid: (id: string) => `apareca:rid:${id}` },
  forgetSnapshot: vi.fn((rid: string) => store.forgot.push(rid)),
  readSnapshot: vi.fn(),
  readAparecaHeadFresh: vi.fn(async () => null),
  monthUsage: vi.fn(),
}));

import { updateTag } from "next/cache";
import {
  approveVideo, deleteHouse, listQueue, moveHouse, rejectVideo, removeFromTv, saveConfig, saveZones, setAparecaEnabled, setHouseActive, setTvZone,
  startHouseUpload, syncHouseVideos,
} from "@/app/painel/apareca/actions";
import { monthUsage, readSnapshot } from "@/lib/apareca/store";
import {
  allowedModes, applyConfigPatch, HOUSE_MAX_BYTES, HOUSE_MAX_S, NOT_ALLOWED, teamDecide,
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
  auth.owner = new Set();
  fake.rows = [];
  fake.tables = {};
  fake.updates = [];
  fake.writes = [];
  fake.inserted = [];
  fake.removed = [];
  fake.onUpdate = null;
  mux.deleted = [];
  mux.fail = false;
  mux.passthrough = [];
  mux.released = [];
  mux.info = {};
  store.forgot = [];
  vi.mocked(updateTag).mockClear();
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

// ---------- T15: institucionais, zonas e configurações ----------

const SLUG = "casa-teste";
const Z1 = "22222222-2222-4222-8222-222222222222";
const Z2 = "33333333-3333-4333-8333-333333333333";
const T_MINE = "44444444-4444-4444-8444-444444444444";
const T_OTHER = "55555555-5555-4555-8555-555555555555";
const TV_MINE = "66666666-6666-4666-8666-666666666666";
const TV_OTHER = "77777777-7777-4777-8777-777777777777";
const H1 = "88888888-8888-4888-8888-888888888881";
const H2 = "88888888-8888-4888-8888-888888888882";
const H3 = "88888888-8888-4888-8888-888888888883";

function restaurant(over: Record<string, unknown> = {}) {
  return {
    Id: 10, id: RID, slug: SLUG, apareca_allowed: true, apareca_ai_allowed: false, apareca_enabled: false,
    apareca_config: { mode: "manual", zones: [{ id: Z1, name: "Varanda" }], table_zones: {}, tv_zones: {} }, ...over,
  };
}
const house = (over: Record<string, unknown> = {}) => ({
  Id: 1, id: H1, restaurant_id: RID, title: "Abertura", mux_upload_id: "upH1", mux_asset_id: null, mux_playback_id: null,
  duration_ms: null, aspect: null, position: 0, active: true, status: "processing", created_at: "2026-10-16T22:00:00.000Z", ...over,
});
const savedConfig = () => fake.tables.restaurants[0].apareca_config as Record<string, unknown>;
const restWrites = () => fake.writes.filter((w) => w.t === "restaurants");
const tagsCalled = () => vi.mocked(updateTag).mock.calls.map((c) => c[0]);

describe("allowedModes", () => {
  it("sem a IA liberada pelo João, só manual (mesmo com a chave)", () => {
    expect(allowedModes({ ai_allowed: false }, true)).toEqual(["manual"]);
  });
  it("IA liberada e chave: os três", () => {
    expect(allowedModes({ ai_allowed: true }, true)).toEqual(["manual", "hibrido", "automatico"]);
  });
  it("IA liberada sem chave: só manual", () => {
    expect(allowedModes({ ai_allowed: true }, false)).toEqual(["manual"]);
  });
});

describe("setAparecaEnabled", () => {
  beforeEach(() => {
    auth.owner = new Set([RID]);
  });
  it("não liberado pelo João → a frase da cadeia e nada gravado", async () => {
    fake.tables = { restaurants: [restaurant({ apareca_allowed: false })] };
    expect(await setAparecaEnabled(RID, true)).toEqual({ error: "Este recurso ainda não foi liberado para a sua casa." });
    expect(NOT_ALLOWED).toBe("Este recurso ainda não foi liberado para a sua casa.");
    expect(restWrites()).toEqual([]);
  });
  it("mutação: quem não é dono (editor) não liga", async () => {
    fake.tables = { restaurants: [restaurant()] };
    auth.owner = new Set();
    expect((await setAparecaEnabled(RID, true)).error).toBeTruthy();
    expect(restWrites()).toEqual([]);
  });
  it("dono e liberado: grava e limpa as duas tags do Apareça", async () => {
    fake.tables = { restaurants: [restaurant()] };
    expect(await setAparecaEnabled(RID, true)).toEqual({});
    expect(fake.tables.restaurants[0].apareca_enabled).toBe(true);
    expect(tagsCalled()).toEqual(expect.arrayContaining([`apareca:slug:${SLUG}`, `apareca:rid:${RID}`]));
  });
  it("desligar vale mesmo sem a liberação (só tira do ar)", async () => {
    fake.tables = { restaurants: [restaurant({ apareca_allowed: false, apareca_enabled: true })] };
    expect(await setAparecaEnabled(RID, false)).toEqual({});
    expect(fake.tables.restaurants[0].apareca_enabled).toBe(false);
  });
});

describe("saveConfig", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "chave-de-teste");
    vi.stubEnv("APARECA_OFF", "");
  });
  it("modo automático sem a IA liberada → erro e nada gravado", async () => {
    fake.tables = { restaurants: [restaurant()] };
    expect((await saveConfig(RID, { mode: "automatico" })).error).toBeTruthy();
    expect(restWrites()).toEqual([]);
  });
  it("IA liberada e chave: híbrido grava", async () => {
    fake.tables = { restaurants: [restaurant({ apareca_ai_allowed: true })] };
    expect(await saveConfig(RID, { mode: "hibrido" })).toEqual({});
    expect(savedConfig().mode).toBe("hibrido");
  });
  it("IA liberada sem a chave: automático recusado", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    fake.tables = { restaurants: [restaurant({ apareca_ai_allowed: true })] };
    expect((await saveConfig(RID, { mode: "automatico" })).error).toBeTruthy();
    expect(restWrites()).toEqual([]);
  });
  it("mutação: quem não é membro → erro e nada gravado", async () => {
    fake.tables = { restaurants: [restaurant()] };
    auth.member = new Set();
    expect((await saveConfig(RID, { plays: 2 })).error).toBeTruthy();
    expect(restWrites()).toEqual([]);
  });
  it("grava as faixas do painel e preserva as zonas; limpa as duas tags", async () => {
    fake.tables = { restaurants: [restaurant()] };
    const r = await saveConfig(RID, {
      rule: { kind: "intercalar", house_every: 1, clients_max: 5 }, plays: 3, device_per_hour: 10,
      hours: { from: "19:00", to: "02:00" }, retention_h: 72,
    });
    expect(r).toEqual({});
    expect(savedConfig()).toMatchObject({
      mode: "manual", rule: { kind: "intercalar", house_every: 1, clients_max: 5 }, plays: 3, device_per_hour: 10,
      hours: { from: "19:00", to: "02:00" }, retention_h: 72, zones: [{ id: Z1, name: "Varanda" }],
    });
    expect(tagsCalled()).toEqual(expect.arrayContaining([`apareca:slug:${SLUG}`, `apareca:rid:${RID}`]));
  });
  it("fora das faixas do painel → erro e nada gravado", async () => {
    fake.tables = { restaurants: [restaurant()] };
    for (const bad of [
      { rule: { kind: "intercalar", house_every: 1, clients_max: 6 } }, { plays: 4 }, { device_per_hour: 11 },
      { device_per_hour: 0 }, { retention_h: 48 }, { hours: { from: "25:00", to: "02:00" } }, { mode: "xpto" },
    ]) {
      expect((await saveConfig(RID, bad as never)).error, JSON.stringify(bad)).toBeTruthy();
    }
    expect(restWrites()).toEqual([]);
  });
  it("zonas e mapas não entram pelo saveConfig (só pelo saveZones)", async () => {
    fake.tables = { restaurants: [restaurant()] };
    expect(await saveConfig(RID, { plays: 2, zones: [], table_zones: { [T_OTHER]: Z1 } })).toEqual({});
    expect(savedConfig()).toMatchObject({ plays: 2, zones: [{ id: Z1, name: "Varanda" }], table_zones: {} });
  });
  it("hours null = o horário do restaurante", async () => {
    fake.tables = { restaurants: [restaurant({ apareca_config: { hours: { from: "10:00", to: "12:00" } } })] };
    expect(await saveConfig(RID, { hours: null })).toEqual({});
    expect(savedConfig().hours).toBeNull();
  });
});

describe("saveZones", () => {
  const base = () => ({
    restaurants: [restaurant()],
    dining_tables: [
      { Id: 1, id: T_MINE, restaurant_id: RID, label: "4" },
      { Id: 2, id: T_OTHER, restaurant_id: OTHER, label: "9" },
    ],
    community_tvs: [
      { Id: 1, id: TV_MINE, restaurant_id: RID, label: "Salão", paired_at: "2026-10-16 20:00:00+00:00", revoked: false },
      { Id: 2, id: TV_OTHER, restaurant_id: OTHER, label: "Outra", paired_at: "2026-10-16 20:00:00+00:00", revoked: false },
    ],
  });
  it("mutação: mesa e TV de outro restaurante são ignoradas", async () => {
    fake.tables = base();
    const zones = [{ id: Z1, name: "Varanda" }];
    expect(await saveZones(RID, zones, { [T_MINE]: Z1, [T_OTHER]: Z1 }, { [TV_MINE]: Z1, [TV_OTHER]: Z1 })).toEqual({});
    expect(savedConfig().table_zones).toEqual({ [T_MINE]: Z1 });
    expect(savedConfig().tv_zones).toEqual({ [TV_MINE]: Z1 });
    expect(tagsCalled()).toEqual(expect.arrayContaining([`apareca:slug:${SLUG}`, `apareca:rid:${RID}`]));
  });
  it("zona apagada: mesa e TV que apontavam para ela ficam sem zona", async () => {
    fake.tables = base();
    fake.tables.restaurants[0].apareca_config = {
      zones: [{ id: Z1, name: "Varanda" }, { id: Z2, name: "Salão" }], table_zones: { [T_MINE]: Z2 }, tv_zones: { [TV_MINE]: Z2 },
    };
    expect(await saveZones(RID, [{ id: Z1, name: "Varanda" }], { [T_MINE]: Z2 }, { [TV_MINE]: Z2 })).toEqual({});
    expect(savedConfig()).toMatchObject({ zones: [{ id: Z1, name: "Varanda" }], table_zones: {}, tv_zones: {} });
  });
  it("renomear grava o nome sem espaços nas pontas", async () => {
    fake.tables = base();
    expect(await saveZones(RID, [{ id: Z1, name: "  Área externa " }], {}, {})).toEqual({});
    expect(savedConfig().zones).toEqual([{ id: Z1, name: "Área externa" }]);
  });
  it("mais de 12 zonas, nome vazio ou acima de 40 → erro e nada gravado", async () => {
    fake.tables = base();
    const many = Array.from({ length: 13 }, (_, k) => ({ id: `${String(k).padStart(8, "0")}-0000-4000-8000-000000000000`, name: `Z${k}` }));
    expect((await saveZones(RID, many, {}, {})).error).toBeTruthy();
    expect((await saveZones(RID, [{ id: Z1, name: "  " }], {}, {})).error).toBeTruthy();
    expect((await saveZones(RID, [{ id: Z1, name: "x".repeat(41) }], {}, {})).error).toBeTruthy();
    expect((await saveZones(RID, [{ id: "z1", name: "Varanda" }], {}, {})).error).toBeTruthy();
    expect(restWrites()).toEqual([]);
  });
  it("mutação: quem não é membro → erro e nada gravado", async () => {
    fake.tables = base();
    auth.member = new Set();
    expect((await saveZones(RID, [{ id: Z1, name: "Varanda" }], {}, {})).error).toBeTruthy();
    expect(restWrites()).toEqual([]);
  });
  it("tvs null (tela TVs): a zona gravada de cada TV fica", async () => {
    fake.tables = base();
    fake.tables.restaurants[0].apareca_config = { zones: [{ id: Z1, name: "Varanda" }], table_zones: {}, tv_zones: { [TV_MINE]: Z1 } };
    expect(await saveZones(RID, [{ id: Z1, name: "Varanda" }], { [T_MINE]: Z1 }, null)).toEqual({});
    expect(savedConfig()).toMatchObject({ table_zones: { [T_MINE]: Z1 }, tv_zones: { [TV_MINE]: Z1 } });
  });
  it("tvs null com a zona apagada: a TV fica sem zona", async () => {
    fake.tables = base();
    fake.tables.restaurants[0].apareca_config = {
      zones: [{ id: Z1, name: "Varanda" }, { id: Z2, name: "Salão" }], table_zones: {}, tv_zones: { [TV_MINE]: Z1 },
    };
    expect(await saveZones(RID, [{ id: Z2, name: "Salão" }], {}, null)).toEqual({});
    expect(savedConfig().tv_zones).toEqual({});
  });
});

describe("setTvZone", () => {
  const base = () => ({
    restaurants: [
      restaurant({
        apareca_config: {
          zones: [{ id: Z1, name: "Varanda" }, { id: Z2, name: "Salão" }], table_zones: { [T_MINE]: Z2 }, tv_zones: {},
        },
      }),
    ],
    community_tvs: [
      { Id: 1, id: TV_MINE, restaurant_id: RID, label: "Salão", paired_at: "2026-10-16 20:00:00+00:00", revoked: false },
      { Id: 2, id: TV_OTHER, restaurant_id: OTHER, label: "Outra", paired_at: "2026-10-16 20:00:00+00:00", revoked: false },
    ],
  });
  it("grava só a zona da TV e mantém zonas e mesas", async () => {
    fake.tables = base();
    expect(await setTvZone(RID, TV_MINE, Z1)).toEqual({});
    expect(savedConfig()).toMatchObject({
      zones: [{ id: Z1, name: "Varanda" }, { id: Z2, name: "Salão" }], table_zones: { [T_MINE]: Z2 }, tv_zones: { [TV_MINE]: Z1 },
    });
    expect(await setTvZone(RID, TV_MINE, null)).toEqual({});
    expect(savedConfig().tv_zones).toEqual({});
  });
  it("mutação: quem não é membro → DENIED e nada gravado", async () => {
    fake.tables = base();
    auth.member = new Set();
    expect(await setTvZone(RID, TV_MINE, Z1)).toEqual({ error: "Entre de novo no painel." });
    expect(restWrites()).toEqual([]);
  });
  it("mutação: TV de outra casa ou desconectada → erro e nada gravado", async () => {
    fake.tables = base();
    expect((await setTvZone(RID, TV_OTHER, Z1)).error).toBeTruthy();
    fake.tables.community_tvs[0].revoked = true;
    expect((await setTvZone(RID, TV_MINE, Z1)).error).toBeTruthy();
    expect(restWrites()).toEqual([]);
  });
  it("id de TV inválido → FAIL; zona que não existe → erro; nada gravado", async () => {
    fake.tables = base();
    expect(await setTvZone(RID, "tv1", Z1)).toEqual({ error: "Não foi possível salvar. Tente de novo." });
    expect((await setTvZone(RID, TV_MINE, "99999999-9999-4999-8999-999999999999")).error).toBeTruthy();
    expect(restWrites()).toEqual([]);
  });
});

describe("institucionais", () => {
  it("startHouseUpload: cria a linha em preparo, no fim da lista, com o passthrough do restaurante", async () => {
    fake.tables = { restaurants: [restaurant()], apareca_house_videos: [house({ position: 3, status: "ready" })] };
    const r = await startHouseUpload(RID, "  Promoção de terça  ");
    expect(r.error).toBeUndefined();
    expect(r.url).toBe("https://upload.test/upNew1");
    const [ins] = fake.inserted;
    expect(ins.t).toBe("apareca_house_videos");
    expect(ins.rows[0]).toMatchObject({
      restaurant_id: RID, title: "Promoção de terça", mux_upload_id: "upNew1", status: "processing", active: true, position: 4,
    });
    expect(r.id).toBe(ins.rows[0].uid);
    expect(mux.passthrough[0]).toBe(`apareca:${RID}:casa:${r.id}`);
    expect(mux.passthrough[0].length).toBeLessThanOrEqual(255);
  });
  it("startHouseUpload: título vazio ou não membro → erro, sem envio", async () => {
    fake.tables = { restaurants: [restaurant()], apareca_house_videos: [] };
    expect((await startHouseUpload(RID, "   ")).error).toBeTruthy();
    auth.member = new Set();
    expect((await startHouseUpload(RID, "Abertura")).error).toBeTruthy();
    expect(mux.passthrough).toEqual([]);
    expect(fake.inserted).toEqual([]);
  });
  it("limites: 3 min e 200 MB", () => {
    expect(HOUSE_MAX_S).toBe(180);
    expect(HOUSE_MAX_BYTES).toBe(200 * 1024 * 1024);
  });
  it("syncHouseVideos: pronto até 3 min vira ready; acima de 3 min apaga o asset e marca failed", async () => {
    fake.tables = {
      restaurants: [restaurant()],
      apareca_house_videos: [
        house({ Id: 1, id: H1, mux_upload_id: "upOk" }),
        house({ Id: 2, id: H2, mux_upload_id: "upLong" }),
        house({ Id: 3, id: H3, mux_upload_id: "upWait" }),
        house({ Id: 4, id: "99999999-9999-4999-8999-999999999999", restaurant_id: OTHER, mux_upload_id: "upOther" }),
      ],
    };
    mux.info = {
      upOk: { status: "ready", assetId: "assetOk", playbackId: "pbOk", durationS: 179.5, mp4: true },
      upLong: { status: "ready", assetId: "assetLong", playbackId: "pbLong", durationS: 180.4, mp4: true },
      upOther: { status: "ready", assetId: "assetOther", playbackId: "pbOther", durationS: 9999, mp4: true },
    };
    expect(await syncHouseVideos(RID)).toEqual({ pending: 1 });
    const rows = fake.tables.apareca_house_videos;
    expect(rows[0]).toMatchObject({ status: "ready", mux_asset_id: "assetOk", mux_playback_id: "pbOk", duration_ms: 179500 });
    expect(rows[1]).toMatchObject({ status: "failed", mux_asset_id: null, mux_playback_id: null, active: false, duration_ms: 180400 });
    expect(rows[2]).toMatchObject({ status: "processing" });
    expect(rows[3]).toMatchObject({ status: "processing" }); // outro restaurante: nem consultado
    expect(mux.deleted).toEqual(["assetLong"]);
    expect(tagsCalled()).toEqual(expect.arrayContaining([`apareca:slug:${SLUG}`, `apareca:rid:${RID}`]));
  });
  it("syncHouseVideos: o Mux não apagou o asset longo → a linha continua em preparo (tenta de novo)", async () => {
    fake.tables = { restaurants: [restaurant()], apareca_house_videos: [house({ mux_upload_id: "upLong" })] };
    mux.info = { upLong: { status: "ready", assetId: "assetLong", playbackId: "pbLong", durationS: 600, mp4: true } };
    mux.fail = true;
    expect(await syncHouseVideos(RID)).toEqual({ pending: 1 });
    expect(fake.tables.apareca_house_videos[0]).toMatchObject({ status: "processing", mux_playback_id: null });
  });
  it("syncHouseVideos: não membro → nada consultado", async () => {
    fake.tables = { restaurants: [restaurant()], apareca_house_videos: [house({ mux_upload_id: "upOk" })] };
    mux.info = { upOk: { status: "ready", assetId: "a", playbackId: "p", durationS: 10, mp4: true } };
    auth.member = new Set();
    expect(await syncHouseVideos(RID)).toEqual({ pending: 0 });
    expect(fake.tables.apareca_house_videos[0].status).toBe("processing");
  });
  it("mutação: ativar, mover e apagar um institucional de outro restaurante → erro, nada gravado nem apagado", async () => {
    fake.tables = {
      restaurants: [restaurant()],
      apareca_house_videos: [house({ restaurant_id: OTHER, status: "ready", mux_asset_id: "assetX" })],
    };
    auth.member = new Set([RID, OTHER]);
    expect((await setHouseActive(RID, H1, false)).error).toBeTruthy();
    expect((await moveHouse(RID, H1, 1)).error).toBeTruthy();
    expect((await deleteHouse(RID, H1)).error).toBeTruthy();
    expect(fake.writes).toEqual([]);
    expect(fake.removed).toEqual([]);
    expect(mux.deleted).toEqual([]);
  });
  it("setHouseActive grava e limpa as tags", async () => {
    fake.tables = { restaurants: [restaurant()], apareca_house_videos: [house({ status: "ready" })] };
    expect(await setHouseActive(RID, H1, false)).toEqual({});
    expect(fake.tables.apareca_house_videos[0].active).toBe(false);
    expect(tagsCalled()).toEqual(expect.arrayContaining([`apareca:slug:${SLUG}`, `apareca:rid:${RID}`]));
  });
  it("moveHouse troca com o vizinho e renumera; na ponta, nada muda", async () => {
    fake.tables = {
      restaurants: [restaurant()],
      apareca_house_videos: [
        house({ Id: 1, id: H1, position: 0 }), house({ Id: 2, id: H2, position: 5 }), house({ Id: 3, id: H3, position: 9 }),
      ],
    };
    expect(await moveHouse(RID, H3, -1)).toEqual({});
    const pos = () => Object.fromEntries(fake.tables.apareca_house_videos.map((h) => [h.id, h.position]));
    expect(pos()).toEqual({ [H1]: 0, [H3]: 1, [H2]: 2 });
    fake.writes = [];
    expect(await moveHouse(RID, H1, -1)).toEqual({});
    expect(fake.writes).toEqual([]);
  });
  it("deleteHouse apaga o asset no Mux antes da linha", async () => {
    fake.tables = { restaurants: [restaurant()], apareca_house_videos: [house({ status: "ready", mux_asset_id: "assetH" })] };
    expect(await deleteHouse(RID, H1)).toEqual({});
    expect(mux.deleted).toEqual(["assetH"]);
    expect(fake.removed).toEqual([{ t: "apareca_house_videos", ids: [1] }]);
  });
  it("deleteHouse sem asset ainda: libera o envio no Mux e apaga a linha", async () => {
    fake.tables = { restaurants: [restaurant()], apareca_house_videos: [house()] };
    expect(await deleteHouse(RID, H1)).toEqual({});
    expect(mux.released).toEqual(["upH1"]);
    expect(fake.removed).toHaveLength(1);
  });
  it("deleteHouse: o Mux falhou → erro e a linha fica", async () => {
    fake.tables = { restaurants: [restaurant()], apareca_house_videos: [house({ status: "ready", mux_asset_id: "assetH" })] };
    mux.fail = true;
    expect((await deleteHouse(RID, H1)).error).toBeTruthy();
    expect(fake.removed).toEqual([]);
  });
});

describe("revisão final", () => {
  it("A4 (panel-logic, 2ª camada): o banco devolve vídeo de outro restaurante mesmo com o where → recusa, nada gravado", async () => {
    const other = video({ restaurant_id: OTHER });
    const updateRows = vi.fn(async () => {});
    const deleteAsset = vi.fn(async () => {});
    // Banco "quebrado": ignora o where e devolve a linha da outra casa.
    const db = { first: vi.fn(async () => ({ ...other }) as never), updateRows };
    for (const action of ["approve", "reject", "remove"] as const) {
      expect(await teamDecide({ db, deleteAsset }, RID, VID, action)).toEqual({ error: TEAM_ERRORS.gone });
    }
    expect(updateRows).not.toHaveBeenCalled();
    expect(deleteAsset).not.toHaveBeenCalled();
  });

  describe("A7: faixa do teto na fila do painel", () => {
    const zero = { encoded_s: 0, stored_min_month: 0, played_s: 0, mp4_s: 0, house_min: 0 };
    beforeEach(() => {
      vi.mocked(readSnapshot).mockResolvedValue({ at: 0, videos: [] });
    });
    it("erro ao ler o uso do mês → paused (coerente com o envio do cliente)", async () => {
      vi.mocked(monthUsage).mockRejectedValueOnce(new Error("nocodb 500"));
      expect((await listQueue(RID)).warn).toBe("paused");
    });
    it("uso lido e baixo → ok", async () => {
      vi.mocked(monthUsage).mockResolvedValueOnce(zero);
      expect((await listQueue(RID)).warn).toBe("ok");
    });
  });

  describe("Minor 1: horário com início igual ao fim", () => {
    it("applyConfigPatch recusa com mensagem clara", () => {
      const cur: AparecaConfig = { mode: "manual", rule: { kind: "intercalar", house_every: 1, clients_max: 3 }, plays: 1,
        device_per_hour: 2, hours: null, retention_h: 6, zones: [], table_zones: {}, tv_zones: {} };
      expect(applyConfigPatch(cur, { hours: { from: "19:00", to: "19:00" } }, ["manual"])).toEqual({
        error: "O horário precisa ter início e fim diferentes.",
      });
      expect(applyConfigPatch(cur, { hours: { from: "19:00", to: "02:00" } }, ["manual"])).toMatchObject({
        cfg: { hours: { from: "19:00", to: "02:00" } },
      });
    });
    it("saveConfig com from === to → erro e nada gravado", async () => {
      fake.tables = { restaurants: [restaurant()] };
      expect(await saveConfig(RID, { hours: { from: "20:00", to: "20:00" } })).toEqual({ error: "O horário precisa ter início e fim diferentes." });
      expect(restWrites()).toEqual([]);
    });
  });
});
