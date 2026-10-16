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

function fakeDb(tables: Record<string, Raw[]>, opts: { ignoreWhere?: boolean; failFor?: string } = {}) {
  let nextId = 1;
  const store: Record<string, Raw[]> = {};
  for (const [t, rows] of Object.entries(tables)) store[t] = rows.map((r) => ({ Id: nextId++, uid: r.id, ...r }));
  const log: string[] = [];
  const lists: { t: string; w: Where }[] = [];
  const match = (r: Raw, w: Where) => Object.entries(w).every(([k, v]) => (r[k] ?? null) === v);
  const db: RetentionDb = {
    async list(t, w) {
      lists.push({ t, w });
      if (opts.failFor && w.restaurant_id === opts.failFor) throw new Error("nocodb GET: 500");
      const rows = store[t] ?? [];
      return (opts.ignoreWhere && t !== "restaurants" ? rows : rows.filter((r) => match(r, w))).map((r) => ({ ...r })) as never;
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

describe("runRetention: varredura por restaurante", () => {
  const files = () => {
    const removed: string[][] = [];
    const log: string[] = [];
    return {
      removed,
      log,
      removeFiles: async (paths: string[]) => {
        removed.push(paths);
        log.push(`files:${paths.length}`);
      },
    };
  };
  const ownsFile = (rid: string, p: string) => p.startsWith(`/api/arquivos-locais/${rid}/`);

  it("só percorre restaurantes com community_enabled e apaga só o que o plano manda", async () => {
    const oldVote = vote(ago(31 * DAY));
    const newVote = vote(ago(DAY));
    const oldTally = tally(ago(91 * DAY));
    const hidden = post("hidden", ago(8 * DAY));
    const expired = tv();
    const paired = tv({ paired_at: ago(DAY), pair_code: null });
    const offVote = vote(ago(400 * DAY), { restaurant_id: R2 });
    const { db, lists, left } = fakeDb({
      restaurants: [restaurant(R1), restaurant(R2, false)],
      community_votes: [oldVote, newVote, offVote],
      community_tally: [oldTally],
      community_posts: [hidden],
      community_tvs: [expired, paired],
    });
    const f = files();
    const report = await runRetention({ db, removeFiles: f.removeFiles, ownsFile, now: () => NOW });

    expect(lists[0]).toEqual({ t: "restaurants", w: { community_enabled: true } });
    expect(lists.filter((l) => l.t !== "restaurants").every((l) => l.w.restaurant_id === R1)).toBe(true);
    expect(left("community_votes")).toEqual([newVote.id, offVote.id]);
    expect(left("community_tally")).toEqual([]);
    expect(left("community_posts")).toEqual([]);
    expect(left("community_tvs")).toEqual([paired.id]);
    expect(f.removed).toEqual([[hidden.photo_path, hidden.thumb_path]]);
    expect(report).toEqual({ restaurants: 1, failed: 0, deleted: { votes: 1, tallies: 1, posts: 1, tvs: 1 } });
  });

  it("apaga a foto e a miniatura antes da linha do post", async () => {
    const hidden = post("hidden", ago(8 * DAY));
    const { db, log } = fakeDb({ restaurants: [restaurant(R1)], community_posts: [hidden] });
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

  it("arquivo fora da pasta do restaurante não vai para o removeFiles, mas a linha sai", async () => {
    const odd = post("hidden", ago(8 * DAY), {
      photo_path: `/api/arquivos-locais/${R2}/comunidade/x.webp`,
      thumb_path: `/api/arquivos-locais/${R1}/comunidade/x-p.webp`,
    });
    const { db, left } = fakeDb({ restaurants: [restaurant(R1)], community_posts: [odd] });
    const f = files();
    await runRetention({ db, removeFiles: f.removeFiles, ownsFile, now: () => NOW });
    expect(f.removed).toEqual([[odd.thumb_path]]);
    expect(left("community_posts")).toEqual([]);
  });

  it("linha de outro restaurante que escapar do filtro nunca é apagada nem tem arquivo removido", async () => {
    const mine = vote(ago(31 * DAY));
    const theirs = vote(ago(31 * DAY), { restaurant_id: R2 });
    const theirPost = post("hidden", ago(30 * DAY), {
      restaurant_id: R2,
      photo_path: `/api/arquivos-locais/${R2}/comunidade/y.webp`,
      thumb_path: `/api/arquivos-locais/${R2}/comunidade/y-p.webp`,
    });
    const { db, left } = fakeDb(
      { restaurants: [restaurant(R1)], community_votes: [mine, theirs], community_posts: [theirPost] },
      { ignoreWhere: true },
    );
    const f = files();
    const report = await runRetention({ db, removeFiles: f.removeFiles, ownsFile, now: () => NOW });
    expect(left("community_votes")).toEqual([theirs.id]);
    expect(left("community_posts")).toEqual([theirPost.id]);
    expect(f.removed).toEqual([]);
    expect(report.deleted).toEqual({ votes: 1, tallies: 0, posts: 0, tvs: 0 });
  });

  it("restaurante que falha não para os outros e entra em failed", async () => {
    const R3 = U(3);
    const v2 = vote(ago(31 * DAY), { restaurant_id: R3 });
    const { db, left } = fakeDb({ restaurants: [restaurant(R1), restaurant(R3)], community_votes: [vote(ago(31 * DAY)), v2] }, { failFor: R1 });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const report = await runRetention({ db, removeFiles: files().removeFiles, ownsFile, now: () => NOW });
    spy.mockRestore();
    expect(report.failed).toBe(1);
    expect(report.restaurants).toBe(2);
    expect(report.deleted.votes).toBe(1);
    expect(left("community_votes")).toHaveLength(1);
    expect(left("community_votes")).not.toContain(v2.id);
  });

  it("restaurante com id que não é uuid é pulado sem consulta", async () => {
    const { db, lists } = fakeDb({ restaurants: [restaurant("abc,(x)")] });
    const report = await runRetention({ db, removeFiles: files().removeFiles, ownsFile, now: () => NOW });
    expect(lists.map((l) => l.t)).toEqual(["restaurants"]);
    expect(report).toEqual({ restaurants: 0, failed: 0, deleted: { votes: 0, tallies: 0, posts: 0, tvs: 0 } });
  });

  it("sem nada vencido, nenhum removeIds nem removeFiles", async () => {
    const { db, log } = fakeDb({
      restaurants: [restaurant(R1)],
      community_votes: [vote(ago(DAY))],
      community_posts: [post("approved", null)],
      community_tvs: [tv({ pair_expires_at: noco(now + MIN) })],
    });
    const f = files();
    await runRetention({ db, removeFiles: f.removeFiles, ownsFile, now: () => NOW });
    expect(log).toEqual([]);
    expect(f.removed).toEqual([]);
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
vi.mock("@/lib/storage", () => ({
  removeFiles: h.removeFiles,
  ownsFile: (rid: string, p: string) => p.startsWith(`/api/arquivos-locais/${rid}/`),
}));

const route = await import("@/app/api/cron/comunidade/route");

describe("GET /api/cron/comunidade", () => {
  const SECRET = "segredo-de-teste-do-cron";
  const call = (auth?: string) =>
    route.GET(new NextRequest("http://localhost/api/cron/comunidade", { headers: auth === undefined ? {} : { authorization: auth } }));

  beforeEach(() => {
    h.list.mockReset();
    h.list.mockImplementation(async (t: string) => (t === "restaurants" ? [restaurant(R1)] : []));
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

  it("COMMUNITY_OFF=1: confere a senha antes e responde desligada sem tocar no banco", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("COMMUNITY_OFF", "1");
    expect((await call("Bearer errado")).status).toBe(401);
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, off: true });
    expect(h.list).not.toHaveBeenCalled();
  });

  it("senha certa: varre, apaga e devolve só os números", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("COMMUNITY_OFF", "");
    const old = { Id: 7, ...vote(ago(31 * DAY)) };
    h.list.mockImplementation(async (t: string) => (t === "restaurants" ? [restaurant(R1)] : t === "community_votes" ? [old] : []));
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, restaurants: 1, failed: 0, deleted: { votes: 1, tallies: 0, posts: 0, tvs: 0 } });
    expect(h.removeIds).toHaveBeenCalledWith("community_votes", [7]);
  });

  it("falha num restaurante ou na lista de restaurantes: 500", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.list.mockImplementation(async (t: string) => {
      if (t === "restaurants") return [restaurant(R1)];
      throw new Error("nocodb GET: 500");
    });
    const one = await call(`Bearer ${SECRET}`);
    expect(one.status).toBe(500);
    expect((await one.json()).failed).toBe(1);
    h.list.mockRejectedValue(new Error("nocodb GET: 500"));
    const all = await call(`Bearer ${SECRET}`);
    expect(all.status).toBe(500);
    expect(await all.json()).toEqual({ ok: false });
    spy.mockRestore();
  });
});
