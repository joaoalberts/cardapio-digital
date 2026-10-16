// Retenção diária da Comunidade: o plano do que apagar (puro), a varredura por restaurante
// com banco e armazenamento falsos, e a rota do cron com a senha CRON_SECRET.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  HIDDEN_POST_RETENTION_MS,
  TALLY_RETENTION_MS,
  VOTE_RETENTION_MS,
  cronAuth,
  retentionPlan,
  runRetention,
  type RetentionDb,
} from "./retention";
import type { PostRow, TallyRow, TvRow, VoteRow } from "./types";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-16T09:00:00Z");
const now = NOW.getTime();
const iso = (ms: number) => new Date(ms).toISOString();
// O NocoDB devolve as datas assim, com espaço e fuso "+00:00".
const noco = (ms: number) => iso(ms).replace("T", " ").replace(/\.\d+Z$/, "+00:00");
const ago = (ms: number) => noco(now - ms);

const R1 = U(1);
const R2 = U(2);

let seq = 100;
const vote = (created_at: string, over: Partial<VoteRow> = {}): VoteRow => ({
  id: U(++seq),
  restaurant_id: R1,
  poll_id: U(50),
  option_id: "a",
  device_id: U(60),
  table_id: U(70),
  created_at,
  ...over,
});
const tally = (created_at: string, over: Partial<TallyRow> = {}): TallyRow => ({
  id: U(++seq),
  restaurant_id: R1,
  day: "2026-07-01",
  counts: { open: 1 },
  tables_qr: [],
  tables_open: [],
  created_at,
  ...over,
});
const post = (status: PostRow["status"], hidden_at: string | null, over: Partial<PostRow> = {}): PostRow => {
  const id = U(++seq);
  return {
    id,
    restaurant_id: R1,
    item_id: U(80),
    photo_path: `/api/arquivos-locais/${R1}/comunidade/${id}.webp`,
    thumb_path: `/api/arquivos-locais/${R1}/comunidade/${id}-p.webp`,
    source: "house",
    status,
    on_tv: false,
    hidden_at,
    created_at: ago(400 * DAY),
    ...over,
  };
};
const tv = (over: Partial<TvRow> = {}): TvRow => ({
  id: U(++seq),
  restaurant_id: R1,
  label: null,
  pair_code: "ABC234",
  pair_expires_at: ago(MIN),
  secret_hash: "a".repeat(64),
  paired_at: null,
  last_seen_at: null,
  revoked: false,
  created_at: ago(11 * MIN),
  ...over,
});
const empty = { votes: [], tallies: [], posts: [], tvs: [], now: NOW };

describe("retentionPlan: prazos", () => {
  it("as constantes são 30, 90 e 7 dias", () => {
    expect(VOTE_RETENTION_MS).toBe(30 * DAY);
    expect(TALLY_RETENTION_MS).toBe(90 * DAY);
    expect(HIDDEN_POST_RETENTION_MS).toBe(7 * DAY);
  });

  it("voto: 29 d 23 h fica, 30 d 1 h sai; exatamente 30 dias ainda fica", () => {
    const keep = vote(ago(29 * DAY + 23 * HOUR));
    const edge = vote(ago(30 * DAY));
    const gone = vote(ago(30 * DAY + HOUR));
    const plan = retentionPlan({ ...empty, votes: [keep, edge, gone] });
    expect(plan.votes).toEqual([gone.id]);
  });

  it("voto: data em ISO também vale; data vazia, ilegível ou no futuro nunca sai", () => {
    const isoOld = vote(iso(now - 31 * DAY));
    const blank = vote("");
    const junk = vote("ontem");
    const future = vote(noco(now + DAY));
    const plan = retentionPlan({ ...empty, votes: [isoOld, blank, junk, future] });
    expect(plan.votes).toEqual([isoOld.id]);
  });

  it("tally: 89 d 23 h fica, 90 d 1 h sai", () => {
    const keep = tally(ago(89 * DAY + 23 * HOUR));
    const gone = tally(ago(90 * DAY + HOUR));
    const plan = retentionPlan({ ...empty, tallies: [keep, gone] });
    expect(plan.tallies).toEqual([gone.id]);
  });

  it("post oculto: 6 d 23 h fica, 7 d 1 h sai, e sai inteiro (com foto e miniatura)", () => {
    const keep = post("hidden", ago(6 * DAY + 23 * HOUR));
    const gone = post("hidden", ago(7 * DAY + HOUR));
    const plan = retentionPlan({ ...empty, posts: [keep, gone] });
    expect(plan.posts).toEqual([gone]);
  });

  it("post approved antigo nunca sai, nem com hidden_at antigo; oculto sem hidden_at também fica", () => {
    const approved = post("approved", null, { created_at: ago(900 * DAY) });
    const approvedOddHidden = post("approved", ago(100 * DAY));
    const hiddenNoDate = post("hidden", null);
    const hiddenJunk = post("hidden", "semana passada");
    const plan = retentionPlan({ ...empty, posts: [approved, approvedOddHidden, hiddenNoDate, hiddenJunk] });
    expect(plan.posts).toEqual([]);
  });

  it("TV pendente: código vencido há 1 min sai; vencendo daqui a 1 min fica; vencendo agora sai", () => {
    const gone = tv({ pair_expires_at: ago(MIN) });
    const keep = tv({ pair_expires_at: noco(now + MIN) });
    const edge = tv({ pair_expires_at: noco(now) });
    const plan = retentionPlan({ ...empty, tvs: [gone, keep, edge] });
    expect(plan.tvs).toEqual([gone.id, edge.id]);
  });

  it("TV pareada nunca sai, mesmo com o código antigo vencido; revogada ou sem prazo também fica", () => {
    const paired = tv({ paired_at: ago(30 * DAY), pair_code: null, pair_expires_at: ago(30 * DAY) });
    const revokedPending = tv({ revoked: true, pair_code: null, pair_expires_at: ago(DAY) });
    const noExpiry = tv({ pair_expires_at: null });
    const junkExpiry = tv({ pair_expires_at: "amanhã" });
    const plan = retentionPlan({ ...empty, tvs: [paired, revokedPending, noExpiry, junkExpiry] });
    expect(plan.tvs).toEqual([]);
  });

  it("nada a apagar: listas vazias", () => {
    expect(retentionPlan(empty)).toEqual({ votes: [], tallies: [], posts: [], tvs: [] });
  });
});

// ---------- Varredura com banco falso ----------

type Where = Record<string, string | number | boolean | null>;
type Raw = Record<string, unknown>;

function fakeDb(tables: Record<string, Raw[]>, opts: { failTable?: string } = {}) {
  let nextId = 1;
  const store: Record<string, Raw[]> = {};
  for (const [t, rows] of Object.entries(tables)) store[t] = rows.map((r) => ({ Id: nextId++, uid: r.id, ...r }));
  const log: string[] = [];
  const lists: { t: string; w: Where }[] = [];
  const match = (r: Raw, w: Where) => Object.entries(w).every(([k, v]) => (r[k] ?? null) === v);
  const db: RetentionDb = {
    async list(t, w) {
      lists.push({ t, w });
      if (opts.failTable === t) throw new Error("nocodb GET: 500");
      return (store[t] ?? []).filter((r) => match(r, w)).map((r) => ({ ...r })) as never;
    },
    async removeIds(t, ids) {
      log.push(`db:${t}:${ids.length}`);
      store[t] = (store[t] ?? []).filter((r) => !ids.includes(r.Id as number));
    },
  };
  const left = (t: string) => (store[t] ?? []).map((r) => r.id);
  return { db, log, lists, left };
}

const restaurant = (id: string, enabled = true): Raw => ({ id, slug: `r-${id.slice(-2)}`, community_enabled: enabled });
const housePost = (rid: string, hidden_at: string, name: string) =>
  post("hidden", hidden_at, {
    restaurant_id: rid,
    photo_path: `/api/arquivos-locais/${rid}/comunidade/${name}.webp`,
    thumb_path: `/api/arquivos-locais/${rid}/comunidade/${name}-p.webp`,
  });

describe("runRetention: varredura de cada tabela", () => {
  const files = () => {
    const removed: string[][] = [];
    return {
      removed,
      removeFiles: async (paths: string[]) => {
        removed.push(paths);
      },
    };
  };
  const ownsFile = (rid: string, p: string) => p.startsWith(`/api/arquivos-locais/${rid}/`);
  const R3 = U(3);

  it("apaga o vencido de todo restaurante: Comunidade ligada, desligada ou restaurante que nem existe mais", async () => {
    // R1 ligada, R2 desligada depois de juntar votos e fotos, R3 sem linha em restaurants.
    const oldVote = vote(ago(31 * DAY));
    const newVote = vote(ago(DAY));
    const offVote = vote(ago(400 * DAY), { restaurant_id: R2 });
    const orphanVote = vote(ago(31 * DAY), { restaurant_id: R3 });
    const offTally = tally(ago(91 * DAY), { restaurant_id: R2 });
    const newTally = tally(ago(DAY));
    const hidden = housePost(R1, ago(8 * DAY), "a");
    const offHidden = housePost(R2, ago(8 * DAY), "b");
    const offApproved = post("approved", null, { restaurant_id: R2, created_at: ago(900 * DAY) });
    const offExpired = tv({ restaurant_id: R2 });
    const paired = tv({ paired_at: ago(DAY), pair_code: null });
    const { db, left } = fakeDb({
      restaurants: [restaurant(R1), restaurant(R2, false)],
      community_votes: [oldVote, newVote, offVote, orphanVote],
      community_tally: [offTally, newTally],
      community_posts: [hidden, offHidden, offApproved],
      community_tvs: [offExpired, paired],
    });
    const f = files();
    const report = await runRetention({ db, removeFiles: f.removeFiles, ownsFile, now: () => NOW });

    expect(left("community_votes")).toEqual([newVote.id]);
    expect(left("community_tally")).toEqual([newTally.id]);
    expect(left("community_posts")).toEqual([offApproved.id]);
    expect(left("community_tvs")).toEqual([paired.id]);
    expect(f.removed).toEqual([
      [hidden.photo_path, hidden.thumb_path],
      [offHidden.photo_path, offHidden.thumb_path],
    ]);
    expect(report).toEqual({ failed: 0, deleted: { votes: 3, tallies: 1, posts: 2, tvs: 1 } });
  });

  it("uma consulta por tabela, sem passar pelos restaurantes, por mais restaurantes que existam", async () => {
    const many = Array.from({ length: 30 }, (_, k) => U(200 + k));
    const { db, lists } = fakeDb({
      restaurants: many.map((rid) => restaurant(rid)),
      community_votes: many.map((rid) => vote(ago(31 * DAY), { restaurant_id: rid })),
    });
    const report = await runRetention({ db, removeFiles: files().removeFiles, ownsFile, now: () => NOW });
    expect(lists).toEqual([
      { t: "community_votes", w: {} },
      { t: "community_tally", w: {} },
      { t: "community_posts", w: { status: "hidden" } },
      { t: "community_tvs", w: {} },
    ]);
    expect(report.deleted.votes).toBe(30);
  });

  it("apaga a foto e a miniatura antes da linha do post", async () => {
    const hidden = post("hidden", ago(8 * DAY));
    const { db, log } = fakeDb({ community_posts: [hidden] });
    const f = files();
    // Um log só, na ordem das chamadas.
    const order: string[] = [];
    const removeFiles = async (paths: string[]) => {
      await f.removeFiles(paths);
      order.push("files");
    };
    const removeIds: RetentionDb["removeIds"] = async (t, ids) => {
      order.push(`db:${t}`);
      await db.removeIds(t, ids);
    };
    await runRetention({ db: { ...db, removeIds }, removeFiles, ownsFile, now: () => NOW });
    expect(order).toEqual(["files", "db:community_posts"]);
    expect(log).toEqual(["db:community_posts:1"]);
  });

  it("só vai para o removeFiles o arquivo da pasta do restaurante da própria linha, mas a linha sai", async () => {
    const odd = post("hidden", ago(8 * DAY), {
      photo_path: `/api/arquivos-locais/${R2}/comunidade/x.webp`,
      thumb_path: `/api/arquivos-locais/${R1}/comunidade/x-p.webp`,
    });
    const { db, left } = fakeDb({ community_posts: [odd] });
    const f = files();
    await runRetention({ db, removeFiles: f.removeFiles, ownsFile, now: () => NOW });
    expect(f.removed).toEqual([[odd.thumb_path]]);
    expect(left("community_posts")).toEqual([]);
  });

  it("post com restaurant_id que não é uuid: a linha sai, nenhum arquivo é removido", async () => {
    // Com restaurant_id vazio, "/api/arquivos-locais//..." passaria no ownsFile.
    const blank = post("hidden", ago(8 * DAY), {
      restaurant_id: "",
      photo_path: "/api/arquivos-locais//comunidade/x.webp",
      thumb_path: "/api/arquivos-locais//comunidade/x-p.webp",
    });
    const junk = post("hidden", ago(8 * DAY), {
      restaurant_id: "abc,(x)",
      photo_path: "/api/arquivos-locais/abc,(x)/comunidade/y.webp",
      thumb_path: "/api/arquivos-locais/abc,(x)/comunidade/y-p.webp",
    });
    const { db, left } = fakeDb({ community_posts: [blank, junk] });
    const f = files();
    const report = await runRetention({ db, removeFiles: f.removeFiles, ownsFile, now: () => NOW });
    expect(f.removed).toEqual([]);
    expect(left("community_posts")).toEqual([]);
    expect(report).toEqual({ failed: 0, deleted: { votes: 0, tallies: 0, posts: 2, tvs: 0 } });
  });

  it("uma tabela que falha não para as outras e conta em failed", async () => {
    const v = vote(ago(31 * DAY));
    const t = tally(ago(91 * DAY));
    const { db, left } = fakeDb({ community_votes: [v], community_tally: [t], community_tvs: [tv()] }, { failTable: "community_votes" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const report = await runRetention({ db, removeFiles: files().removeFiles, ownsFile, now: () => NOW });
    spy.mockRestore();
    expect(report).toEqual({ failed: 1, deleted: { votes: 0, tallies: 1, posts: 0, tvs: 1 } });
    expect(left("community_votes")).toEqual([v.id]);
    expect(left("community_tally")).toEqual([]);
  });

  it("arquivos de um restaurante que falham não seguram os dos outros; a linha dele fica para a próxima rodada", async () => {
    const mine = housePost(R1, ago(8 * DAY), "a");
    const theirs = housePost(R2, ago(8 * DAY), "b");
    const { db, left } = fakeDb({ community_posts: [mine, theirs] });
    const removeFiles = async (paths: string[]) => {
      if (paths.some((p) => p.includes(R1))) throw new Error("blob delete: 500");
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const report = await runRetention({ db, removeFiles, ownsFile, now: () => NOW });
    spy.mockRestore();
    expect(left("community_posts")).toEqual([mine.id]);
    expect(report).toEqual({ failed: 1, deleted: { votes: 0, tallies: 0, posts: 1, tvs: 0 } });
  });

  it("sem nada vencido, nenhum removeIds nem removeFiles", async () => {
    const { db, log } = fakeDb({
      community_votes: [vote(ago(DAY))],
      community_posts: [post("approved", null)],
      community_tvs: [tv({ pair_expires_at: noco(now + MIN) })],
    });
    const f = files();
    const report = await runRetention({ db, removeFiles: f.removeFiles, ownsFile, now: () => NOW });
    expect(log).toEqual([]);
    expect(f.removed).toEqual([]);
    expect(report).toEqual({ failed: 0, deleted: { votes: 0, tallies: 0, posts: 0, tvs: 0 } });
  });
});


describe("cronAuth", () => {
  it("sem CRON_SECRET (ou vazia) nunca roda aberta", () => {
    expect(cronAuth("Bearer qualquer", undefined)).toBe("no_secret");
    expect(cronAuth("Bearer ", "")).toBe("no_secret");
    expect(cronAuth("Bearer    ", "   ")).toBe("no_secret");
  });
  it("só aceita exatamente 'Bearer <segredo>'", () => {
    const s = "segredo-de-teste-123456";
    expect(cronAuth(`Bearer ${s}`, s)).toBe("ok");
    expect(cronAuth(null, s)).toBe("denied");
    expect(cronAuth("", s)).toBe("denied");
    expect(cronAuth(s, s)).toBe("denied");
    expect(cronAuth(`bearer ${s}`, s)).toBe("denied");
    expect(cronAuth(`Bearer ${s}x`, s)).toBe("denied");
    expect(cronAuth(`Bearer ${s.slice(0, -1)}`, s)).toBe("denied");
  });
});

// ---------- Rota do cron ----------

const h = vi.hoisted(() => ({
  list: vi.fn<(t: string, w?: unknown) => Promise<unknown[]>>(async () => []),
  removeIds: vi.fn<(t: string, ids: number[]) => Promise<void>>(async () => {}),
  removeFiles: vi.fn<(paths: unknown[]) => Promise<void>>(async () => {}),
}));
vi.mock("@/lib/db/nocodb", () => ({ list: h.list, removeIds: h.removeIds }));
// A rota também varre o Apareça (módulos "server-only"); a tabela vem vazia aqui.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
// A rota usa só a remoção estrita; a comum, que engole erro, faria a linha sair com o
// arquivo ainda lá.
vi.mock("@/lib/storage", () => ({
  removeFilesStrict: h.removeFiles,
  removeFiles: async () => {
    throw new Error("a rota do cron não pode usar removeFiles");
  },
  ownsFile: (rid: string, p: string) => p.startsWith(`/api/arquivos-locais/${rid}/`),
}));

const route = await import("@/app/api/cron/comunidade/route");

describe("GET /api/cron/comunidade", () => {
  const SECRET = "segredo-de-teste-do-cron";
  const call = (auth?: string) =>
    route.GET(new NextRequest("http://localhost/api/cron/comunidade", { headers: auth === undefined ? {} : { authorization: auth } }));

  beforeEach(() => {
    h.list.mockReset();
    h.list.mockImplementation(async () => []);
    h.removeIds.mockClear();
    h.removeFiles.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sem CRON_SECRET: 503 sem tocar no banco", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.list).not.toHaveBeenCalled();
  });

  it("senha errada ou ausente: 401 sem tocar no banco", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    for (const auth of [undefined, "", SECRET, `Bearer ${SECRET}-x`, `Basic ${SECRET}`]) {
      const res = await call(auth);
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(h.list).not.toHaveBeenCalled();
  });

  it("COMMUNITY_OFF=1: confere a senha antes e responde desligada sem tocar nas tabelas da Comunidade (o Apareça ainda varre a dele)", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("COMMUNITY_OFF", "1");
    expect((await call("Bearer errado")).status).toBe(401);
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, off: true, apareca: { deleted: 0, failed: 0 } });
    expect(h.list.mock.calls.map(([t]) => t)).toEqual(["apareca_videos"]);
  });

  it("senha certa: varre, apaga (mesmo de restaurante com a Comunidade desligada) e devolve só os números", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("COMMUNITY_OFF", "");
    const old = { Id: 7, ...vote(ago(31 * DAY), { restaurant_id: R2 }) };
    h.list.mockImplementation(async (t: string) => (t === "community_votes" ? [old] : []));
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, failed: 0, deleted: { votes: 1, tallies: 0, posts: 0, tvs: 0 }, apareca: { deleted: 0, failed: 0 } });
    expect(h.removeIds).toHaveBeenCalledWith("community_votes", [7]);
    expect(h.list.mock.calls.map(([t]) => t)).not.toContain("restaurants");
  });

  it("falha numa tabela ou em todas: 500 com a contagem", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.list.mockImplementation(async (t: string) => {
      if (t === "community_votes") throw new Error("nocodb GET: 500");
      return [];
    });
    const one = await call(`Bearer ${SECRET}`);
    expect(one.status).toBe(500);
    expect((await one.json()).failed).toBe(1);
    h.list.mockRejectedValue(new Error("nocodb GET: 500"));
    const all = await call(`Bearer ${SECRET}`);
    expect(all.status).toBe(500);
    expect(await all.json()).toEqual({ ok: false, failed: 4, deleted: { votes: 0, tallies: 0, posts: 0, tvs: 0 }, apareca: { deleted: 0, failed: 1 } });
    spy.mockRestore();
  });

  it("arquivo que não saiu (remoção estrita lança): a linha da foto fica para a próxima rodada", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("COMMUNITY_OFF", "");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const old = { Id: 9, ...housePost(R1, ago(8 * DAY), "orfa") };
    h.list.mockImplementation(async (t: string) => (t === "community_posts" ? [old] : []));
    h.removeFiles.mockRejectedValueOnce(new Error("blob delete 500"));
    const res = await call(`Bearer ${SECRET}`);
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, failed: 1, deleted: { votes: 0, tallies: 0, posts: 0, tvs: 0 }, apareca: { deleted: 0, failed: 0 } });
    expect(h.removeFiles).toHaveBeenCalledWith([old.photo_path, old.thumb_path]);
    expect(h.removeIds).not.toHaveBeenCalledWith("community_posts", expect.anything());
    // Na rodada seguinte o arquivo sai e a linha também.
    const again = await call(`Bearer ${SECRET}`);
    expect(again.status).toBe(200);
    expect(h.removeIds).toHaveBeenCalledWith("community_posts", [9]);
  });

  it("declara maxDuration de 60 s (a varredura lê as tabelas inteiras)", () => {
    expect(route.maxDuration).toBe(60);
  });
});
