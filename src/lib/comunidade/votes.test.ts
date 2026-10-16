import { describe, expect, it, vi } from "vitest";
import type { OpeningHours } from "@/lib/menu/types";
import { disabledState } from "./public-state";
import type { CommunityHead, OptionId, PollRow, PostRow } from "./types";
import {
  PUBLIC_CACHE_ERROR,
  answerPublicRead,
  castVote,
  parseBefore,
  readPublicState as readResult,
  toContent,
  toHead,
  type CommunityDb,
  type VoteDeps,
} from "./votes";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TZ = "America/Sao_Paulo";
const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = new Date("2026-10-16T23:00:00Z"); // sexta, 20:00 em São Paulo
const now = NOW.getTime();
const iso = (ms: number) => new Date(ms).toISOString();

const head = (over: Partial<CommunityHead> = {}): CommunityHead => ({
  id: "r1",
  slug: "forno",
  name: "Forno",
  enabled: true,
  day_start: "05:00",
  timezone: TZ,
  opening_hours: null,
  instagram: "@forno",
  logo_path: null,
  brand_color: null,
  tv_simple: false,
  ...over,
});
const OTHER = head({ id: "r2", slug: "outro", name: "Outro", instagram: null });

// Fechado às 20h: só abre das 11h às 15h.
const LUNCH_ONLY: OpeningHours = Array.from({ length: 7 }, () => [{ open: "11:00", close: "15:00" }]);
const ALL_DAY: OpeningHours = Array.from({ length: 7 }, () => [{ open: "06:00", close: "23:59" }]);

const DEV = U(201);
const DEV2 = U(202);
const MESA_7 = U(1); // ABC234, r1, ativa
const MESA_8 = U(2); // OFF234, r1, desativada no painel
const MESA_R2 = U(3); // XYZ234, só existe no r2
const MESA_9 = U(4); // DEF234, r1, ativa

const P_OPEN = U(10); // aberta, 3 opções
const P_TWO = U(11); // aberta, 2 opções
const P_OTHER = U(12); // aberta, mas do r2
const P_SCHED = U(13); // agendada para daqui a 10 min
const P_ENDED = U(14); // terminou há 1 min
const P_CLOSED = U(15); // encerrada pela casa há 1 min
const P_GONE = U(16); // apagada do banco

const poll = (id: string, over: Partial<PollRow> = {}): PollRow => ({
  id,
  restaurant_id: "r1",
  template: "dessert",
  question: "Qual sobremesa sai hoje?",
  options: [
    { id: "a", label: "Petit gâteau", item_id: U(20) },
    { id: "b", label: "Pudim", item_id: U(21) },
    { id: "c", label: "Sorvete da casa", item_id: null },
  ],
  starts_at: iso(now - 5 * MIN),
  ends_at: iso(now + 5 * MIN),
  closed_at: null,
  created_at: iso(now - HOUR),
  ...over,
});

const POLLS: PollRow[] = [
  poll(P_OPEN),
  poll(P_TWO, { options: [{ id: "a", label: "Caipirinha", item_id: null }, { id: "b", label: "Chope", item_id: null }] }),
  poll(P_OTHER, { restaurant_id: "r2" }),
  poll(P_SCHED, { starts_at: iso(now + 10 * MIN), ends_at: iso(now + 20 * MIN) }),
  poll(P_ENDED, { starts_at: iso(now - 11 * MIN), ends_at: iso(now - MIN) }),
  poll(P_CLOSED, { closed_at: iso(now - MIN) }),
];

const post = (n: number, over: Partial<PostRow> = {}): PostRow => ({
  id: U(6000 + n),
  restaurant_id: "r1",
  item_id: U(20),
  photo_path: `/api/arquivos-locais/r1/comunidade/${n}-full.webp`,
  thumb_path: `/api/arquivos-locais/r1/comunidade/${n}-thumb.webp`,
  source: "house",
  status: "approved",
  on_tv: false,
  hidden_at: null,
  created_at: iso(now - n * MIN),
  ...over,
});

type Where = Record<string, string | number | boolean | null>;

function fakeDb(polls: PollRow[]) {
  const tables: Record<string, Record<string, unknown>[]> = {
    dining_tables: [
      { uid: MESA_7, id: MESA_7, restaurant_id: "r1", label: "Mesa 7", code: "ABC234", active: true },
      { uid: MESA_8, id: MESA_8, restaurant_id: "r1", label: "Mesa 8", code: "OFF234", active: false },
      { uid: MESA_R2, id: MESA_R2, restaurant_id: "r2", label: "Mesa 1", code: "XYZ234", active: true },
      { uid: MESA_9, id: MESA_9, restaurant_id: "r1", label: "Mesa 9", code: "DEF234", active: true },
    ],
    community_polls: polls.map((p) => ({ uid: p.id, ...p })),
    community_votes: [],
    community_posts: [],
    community_tvs: [],
  };
  let n = 9000;
  const calls = { insertOne: 0, list: [] as { t: string; w: Where }[] };
  const match = (r: Record<string, unknown>, w: Where) => Object.entries(w).every(([k, v]) => (r[k] ?? null) === v);
  const db: CommunityDb = {
    async list(t, w) {
      calls.list.push({ t, w });
      return tables[t].filter((r) => match(r, w)) as never;
    },
    async first(t, w) {
      return (tables[t].find((r) => match(r, w)) ?? null) as never;
    },
    async insertOne(t, row) {
      calls.insertOne++;
      const uid = U(++n);
      const full = { uid, id: uid, created_at: NOW.toISOString(), ...row };
      tables[t].push(full);
      return full as never;
    },
  };
  // Voto gravado direto no banco, na ordem de gravação.
  const seed = (pollId: string, option: OptionId, device: string, table: string, rid = "r1") => {
    const uid = U(++n);
    tables.community_votes.push({ uid, id: uid, restaurant_id: rid, poll_id: pollId, option_id: option, device_id: device, table_id: table, created_at: iso(now - MIN) });
  };
  return { db, tables, calls, seed };
}

// content = o que o cache (getCommunityContent) devolveria; por padrão, igual ao banco.
function setup(o: { head?: CommunityHead | null; polls?: PollRow[]; content?: PollRow[]; posts?: PostRow[]; off?: boolean } = {}) {
  const polls = o.polls ?? POLLS;
  const f = fakeDb(polls);
  const heads: Record<string, CommunityHead | null> = { forno: o.head === undefined ? head() : o.head, outro: OTHER };
  const getContent = vi.fn(async (rid: string) => ({
    polls: (o.content ?? polls).filter((p) => p.restaurant_id === rid),
    posts: (o.posts ?? []).filter((p) => p.restaurant_id === rid),
    tvs: [],
  }));
  const deps: VoteDeps = { db: f.db, getHead: async (s) => heads[s] ?? null, getContent, now: () => NOW, off: () => o.off ?? false };
  return { ...f, deps, getContent };
}

const body = (over: Record<string, unknown> = {}) => ({ mesa: "ABC234", device: DEV, poll: P_OPEN, option: "a", ...over });
const dev = (k: number) => U(100_000 + k);
const mesa = (k: number) => U(200_000 + k);

describe("castVote", () => {
  it("grava o voto com o restaurante do slug e a mesa do banco, nunca os do corpo", async () => {
    const s = setup();
    const r = await castVote(s.deps, "forno", body({ restaurant_id: "r2", table_id: MESA_R2, device_id: DEV2 }));
    expect(r).toEqual({ ok: true, option: "a" });
    expect(s.tables.community_votes).toEqual([
      {
        uid: expect.any(String),
        id: expect.any(String),
        created_at: expect.any(String),
        restaurant_id: "r1",
        poll_id: P_OPEN,
        option_id: "a",
        device_id: DEV,
        table_id: MESA_7,
      },
    ]);
  });

  it("corpo malformado: invalid, sem gravar", async () => {
    const s = setup();
    const bad = [
      null,
      "texto",
      {},
      body({ mesa: "abc234" }),
      body({ mesa: "ABC23" }),
      body({ mesa: "ABC2341" }),
      body({ device: "nao-e-uuid" }),
      body({ device: undefined }),
      body({ poll: "1" }),
      body({ poll: "ABCDEF00-0000-4000-8000-000000000010" }),
      body({ option: "d" }),
      body({ option: "A" }),
      body({ option: undefined }),
    ];
    for (const b of bad) expect(await castVote(s.deps, "forno", b)).toEqual({ ok: false, code: "invalid" });
    expect(s.calls.insertOne).toBe(0);
  });

  it("restaurante que não existe: not_found", async () => {
    expect(await castVote(setup().deps, "nada", body())).toEqual({ ok: false, code: "not_found" });
  });

  it("Comunidade desligada no restaurante ou pela chave geral: disabled", async () => {
    expect(await castVote(setup({ head: head({ enabled: false }) }).deps, "forno", body())).toEqual({ ok: false, code: "disabled" });
    const s = setup({ off: true });
    expect(await castVote(s.deps, "forno", body())).toEqual({ ok: false, code: "disabled" });
    expect(s.calls.insertOne).toBe(0);
  });

  it("mutação: a mesa de outro restaurante é recusada, mesmo com o código certo", async () => {
    // XYZ234 existe e está ativa, mas no r2: conferir só o code aceitaria o voto.
    const s = setup();
    expect(await castVote(s.deps, "forno", body({ mesa: "XYZ234" }))).toEqual({ ok: false, code: "table" });
    expect(s.calls.insertOne).toBe(0);
  });

  it("Foco 1: mesa desativada no painel depois de lembrada no celular é recusada", async () => {
    const s = setup();
    expect(await castVote(s.deps, "forno", body({ mesa: "OFF234" }))).toEqual({ ok: false, code: "table" });
    expect(await castVote(s.deps, "forno", body({ mesa: "ZZZ234" }))).toEqual({ ok: false, code: "table" });
    expect(s.calls.insertOne).toBe(0);
  });

  it("restaurante fechado pelo horário de funcionamento: closed", async () => {
    const s = setup({ head: head({ opening_hours: LUNCH_ONLY }) });
    expect(await castVote(s.deps, "forno", body())).toEqual({ ok: false, code: "closed" });
    expect(s.calls.insertOne).toBe(0);
    expect(await castVote(setup({ head: head({ opening_hours: ALL_DAY }) }).deps, "forno", body())).toEqual({ ok: true, option: "a" });
  });

  it("enquete de outro restaurante, agendada, encerrada ou apagada: poll", async () => {
    const s = setup();
    for (const id of [P_OTHER, P_SCHED, P_ENDED, P_CLOSED, P_GONE]) {
      expect(await castVote(s.deps, "forno", body({ poll: id }))).toEqual({ ok: false, code: "poll" });
    }
    expect(s.calls.insertOne).toBe(0);
  });

  it("opção c numa enquete de 2 opções: poll", async () => {
    const s = setup();
    expect(await castVote(s.deps, "forno", body({ poll: P_TWO, option: "c" }))).toEqual({ ok: false, code: "poll" });
    expect(s.calls.insertOne).toBe(0);
    expect(await castVote(s.deps, "forno", body({ poll: P_TWO, option: "b" }))).toEqual({ ok: true, option: "b" });
  });

  it("Foco 2: enquete apagada ou encerrada entre a leitura e o voto não recebe voto, mesmo com o cache atrasado", async () => {
    // O cache da agenda ainda mostra as duas abertas; o banco já não.
    const stale = [poll(P_OPEN), poll(P_GONE), poll(P_CLOSED, { closed_at: null })];
    const s = setup({ content: stale });
    expect(await castVote(s.deps, "forno", body({ poll: P_GONE }))).toEqual({ ok: false, code: "poll" });
    expect(await castVote(s.deps, "forno", body({ poll: P_CLOSED }))).toEqual({ ok: false, code: "poll" });
    expect(s.calls.insertOne).toBe(0);
    expect(s.tables.community_votes).toHaveLength(0);
  });

  it("segundo voto do mesmo celular devolve o primeiro e não grava de novo", async () => {
    const s = setup();
    expect(await castVote(s.deps, "forno", body({ option: "a" }))).toEqual({ ok: true, option: "a" });
    expect(await castVote(s.deps, "forno", body({ option: "b" }))).toEqual({ ok: true, option: "a" });
    expect(await castVote(s.deps, "forno", body({ option: "a", mesa: "DEF234" }))).toEqual({ ok: true, option: "a" });
    expect(s.calls.insertOne).toBe(1);
    expect(s.tables.community_votes).toHaveLength(1);
  });

  it("o mesmo celular vota de novo em outra enquete", async () => {
    const s = setup();
    expect(await castVote(s.deps, "forno", body())).toEqual({ ok: true, option: "a" });
    expect(await castVote(s.deps, "forno", body({ poll: P_TWO, option: "b" }))).toEqual({ ok: true, option: "b" });
    expect(s.calls.insertOne).toBe(2);
  });

  it("9º voto da mesma mesa: too_many, sem gravar; outra mesa ainda vota", async () => {
    const s = setup();
    for (let k = 0; k < 8; k++) expect(await castVote(s.deps, "forno", body({ device: dev(k) }))).toEqual({ ok: true, option: "a" });
    expect(await castVote(s.deps, "forno", body({ device: dev(8) }))).toEqual({ ok: false, code: "too_many" });
    expect(s.calls.insertOne).toBe(8);
    expect(await castVote(s.deps, "forno", body({ device: dev(9), mesa: "DEF234" }))).toEqual({ ok: true, option: "a" });
  });

  it("401º voto do restaurante na enquete: too_many, sem gravar", async () => {
    const s = setup();
    for (let k = 0; k < 400; k++) s.seed(P_OPEN, "b", dev(k), mesa(Math.floor(k / 8)));
    expect(await castVote(s.deps, "forno", body({ device: dev(400) }))).toEqual({ ok: false, code: "too_many" });
    expect(s.calls.insertOne).toBe(0);
    // Quem já votou continua recebendo o próprio voto.
    expect(await castVote(s.deps, "forno", body({ device: dev(7), option: "a" }))).toEqual({ ok: true, option: "b" });
  });

  it("votos de outra enquete ou de outro restaurante não gastam o teto", async () => {
    const s = setup();
    for (let k = 0; k < 8; k++) s.seed(P_TWO, "a", dev(k), MESA_7);
    for (let k = 8; k < 16; k++) s.seed(P_OPEN, "a", dev(k), MESA_7, "r2");
    expect(await castVote(s.deps, "forno", body())).toEqual({ ok: true, option: "a" });
  });

  it("a enquete é lida do banco por uid e restaurante, sem passar pelo cache da agenda", async () => {
    const s = setup();
    await castVote(s.deps, "forno", body());
    expect(s.getContent).not.toHaveBeenCalled();
  });
});

// Os testes de estado olham só o estado; quem não for ok vira null.
async function readPublicState(deps: VoteDeps, slug: string, before?: string) {
  const r = await readResult(deps, slug, before);
  return r.ok ? r.state : null;
}

describe("readPublicState", () => {
  it("restaurante que não existe: not_found", async () => {
    expect(await readResult(setup().deps, "nada")).toEqual({ ok: false, code: "not_found" });
  });

  it("desligada no restaurante ou pela chave geral: disabledState, sem ler agenda nem votos", async () => {
    const a = setup({ head: head({ enabled: false }) });
    expect(await readPublicState(a.deps, "forno")).toEqual(disabledState(NOW));
    const b = setup({ off: true });
    expect(await readPublicState(b.deps, "forno")).toEqual(disabledState(NOW));
    for (const s of [a, b]) {
      expect(s.getContent).not.toHaveBeenCalled();
      expect(s.calls.list).toHaveLength(0);
    }
  });

  it("fechado: open false e sem enquete, sem ler agenda nem votos", async () => {
    const s = setup({ head: head({ opening_hours: LUNCH_ONLY }) });
    s.seed(P_OPEN, "a", DEV, MESA_7);
    const st = await readPublicState(s.deps, "forno");
    expect(st).toMatchObject({ enabled: true, open: false, poll: null, next: null, mural: [], has_tv: false });
    expect(s.getContent).not.toHaveBeenCalled();
    expect(s.calls.list).toHaveLength(0);
  });

  it("com votos: porcentagens da enquete aberta, lidas do banco na hora", async () => {
    const s = setup({ content: [poll(P_OPEN), poll(P_SCHED, { starts_at: iso(now + 10 * MIN), ends_at: iso(now + 20 * MIN) })] });
    s.seed(P_OPEN, "a", U(301), MESA_7);
    s.seed(P_OPEN, "a", U(302), MESA_7);
    s.seed(P_OPEN, "b", U(303), MESA_9);
    s.seed(P_OPEN, "c", U(304), MESA_9, "r2"); // de outro restaurante: não conta
    s.seed(P_TWO, "c", U(305), MESA_9); // de outra enquete: não conta
    const st = await readPublicState(s.deps, "forno");
    expect(st?.poll).toMatchObject({ id: P_OPEN, closed: false, has_votes: true, winner: null });
    expect(st?.poll?.options.map((o) => [o.id, o.pct])).toEqual([["a", 67], ["b", 33], ["c", 0]]);
    expect(st?.next?.starts_at).toBe(iso(now + 10 * MIN));
    expect(s.calls.list).toEqual([{ t: "community_votes", w: { restaurant_id: "r1", poll_id: P_OPEN } }]);
    const json = JSON.stringify(st);
    for (const secret of [U(301), U(302), U(303), MESA_7, MESA_9, "device_id", "table_id"]) expect(json).not.toContain(secret);
  });

  it("sem enquete aberta nem recém-encerrada: não lê votos", async () => {
    const s = setup({ content: [poll(P_SCHED, { starts_at: iso(now + 10 * MIN), ends_at: iso(now + 20 * MIN) })] });
    const st = await readPublicState(s.deps, "forno");
    expect(st).toMatchObject({ enabled: true, open: true, poll: null });
    expect(s.calls.list).toHaveLength(0);
  });

  it("enquete do cache de outro restaurante não aparece nem lê votos", async () => {
    const s = setup();
    // getContent já filtra por restaurante; aqui o cache "erra" e devolve a do r2.
    s.getContent.mockResolvedValueOnce({ polls: [poll(P_OTHER, { restaurant_id: "r2" })], posts: [], tvs: [] });
    const st = await readPublicState(s.deps, "forno");
    expect(st?.poll).toBeNull();
    expect(s.calls.list).toHaveLength(0);
  });

  it("repassa o antes para a paginação do Mural", async () => {
    const posts = [post(1), post(2), post(3)];
    const s = setup({ content: [], posts });
    const all = await readPublicState(s.deps, "forno");
    expect(all?.mural.map((p) => p.id)).toEqual([U(6001), U(6002), U(6003)]);
    const older = await readPublicState(s.deps, "forno", post(2).created_at);
    expect(older?.mural.map((p) => p.id)).toEqual([U(6003)]);
  });

  it("antes que não é o created_at de um post do conteúdo: invalid, sem ler votos", async () => {
    const posts = [post(1), post(2), post(3)];
    const s = setup({ posts });
    s.seed(P_OPEN, "a", DEV, MESA_7);
    for (const before of [iso(now - 2 * MIN + 1), iso(now - 90 * MIN), iso(now + MIN)]) {
      expect(await readResult(s.deps, "forno", before)).toEqual({ ok: false, code: "invalid" });
    }
    expect(s.calls.list).toHaveLength(0);
    // O do post 2 vale e lê os votos uma vez.
    expect((await readResult(s.deps, "forno", post(2).created_at)).ok).toBe(true);
    expect(s.calls.list).toHaveLength(1);
  });

  it("antes de um post de outro restaurante (mesmo que o cache erre) não vale", async () => {
    const s = setup({ posts: [post(1)] });
    s.getContent.mockResolvedValueOnce({ polls: [], posts: [post(1), post(5, { restaurant_id: "r2" })], tvs: [] });
    expect(await readResult(s.deps, "forno", post(5).created_at)).toEqual({ ok: false, code: "invalid" });
  });

  it("antes com a Comunidade desligada ou o restaurante fechado: invalid (não há Mural para paginar)", async () => {
    const before = post(1).created_at;
    for (const s of [setup({ off: true }), setup({ head: head({ enabled: false }) }), setup({ head: head({ opening_hours: LUNCH_ONLY }) })]) {
      expect(await readResult(s.deps, "forno", before)).toEqual({ ok: false, code: "invalid" });
      expect(s.calls.list).toHaveLength(0);
    }
    // Sem antes, o estado desligado continua respondendo normal.
    expect(await readResult(setup({ off: true }).deps, "forno")).toEqual({ ok: true, state: disabledState(NOW) });
  });
});

describe("answerPublicRead (resposta da GET agregada)", () => {
  it("200 com o cache do estado: 4 s com enquete aberta", async () => {
    const s = setup();
    const r = await answerPublicRead(s.deps, "forno", null);
    expect(r.status).toBe(200);
    expect(r.cache).toBe("public, max-age=0, s-maxage=4, stale-while-revalidate=4");
    expect(r.body).toMatchObject({ enabled: true, open: true, poll: { closed: false } });
  });

  it("antes malformado ou que não bate com um post: 400 no-store", async () => {
    const s = setup({ posts: [post(1)] });
    for (const raw of ["ontem", "", iso(now - 7 * MIN)]) {
      expect(await answerPublicRead(s.deps, "forno", raw)).toEqual({ status: 400, body: { ok: false, code: "invalid" }, cache: "no-store" });
    }
    // No formato do NocoDB, o mesmo instante do post vale.
    const noco = post(1).created_at.replace("T", " ").replace(/\.\d+Z$/, "+00:00");
    expect((await answerPublicRead(s.deps, "forno", noco)).status).toBe(200);
  });

  it("slug inexistente: 404 com 60 s de CDN", async () => {
    expect(await answerPublicRead(setup().deps, "nada", null)).toEqual({
      status: 404,
      body: { ok: false, code: "not_found" },
      cache: "public, max-age=0, s-maxage=60",
    });
  });

  it("erro do banco: 503 com 5 s de CDN (nunca no-store), para a queda não virar enxurrada no NocoDB", async () => {
    expect(PUBLIC_CACHE_ERROR).toBe("public, max-age=0, s-maxage=5");
    const fail = async () => {
      throw new Error("nocodb GET: 500");
    };
    const a = setup();
    a.getContent.mockImplementationOnce(fail);
    const b = setup();
    b.deps.db.list = fail;
    const c = setup();
    c.deps.getHead = fail;
    for (const s of [a, b, c]) {
      expect(await answerPublicRead(s.deps, "forno", null)).toEqual({ status: 503, body: { ok: false, code: "error" }, cache: PUBLIC_CACHE_ERROR });
    }
  });
});

describe("toHead (linha de restaurants do NocoDB)", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "r1",
    uid: "r1",
    Id: 7,
    slug: "forno",
    name: "Forno",
    timezone: "America/Recife",
    opening_hours: ALL_DAY,
    show_hours: true,
    instagram: "@forno",
    logo_path: "/logo.webp",
    brand_color: "#c33",
    community_enabled: true,
    community_day_start: "06:30",
    wifi_password: "segredo",
    ...over,
  });

  it("mapeia só os campos da cabeça", () => {
    expect(toHead(row())).toEqual({
      id: "r1",
      slug: "forno",
      name: "Forno",
      enabled: true,
      day_start: "06:30",
      timezone: "America/Recife",
      opening_hours: ALL_DAY,
      instagram: "@forno",
      logo_path: "/logo.webp",
      brand_color: "#c33",
      tv_simple: false,
    });
  });

  it("modo simples do telão: só true liga", () => {
    expect(toHead(row({ community_tv_simple: true }))?.tv_simple).toBe(true);
    for (const v of [undefined, null, false, "true", 1]) expect(toHead(row({ community_tv_simple: v }))?.tv_simple).toBe(false);
  });

  it("interruptor vazio = desligada; hora do dia vazia ou malformada = 05:00", () => {
    expect(toHead(row({ community_enabled: undefined }))?.enabled).toBe(false);
    expect(toHead(row({ community_enabled: null }))?.enabled).toBe(false);
    expect(toHead(row({ community_enabled: false }))?.enabled).toBe(false);
    for (const v of [undefined, null, "", "5:00", "24:00", "ab:cd"]) expect(toHead(row({ community_day_start: v }))?.day_start).toBe("05:00");
  });

  it("horário escondido conta como sempre aberto, como no cardápio e no pedido", () => {
    expect(toHead(row({ show_hours: false }))?.opening_hours).toBeNull();
    expect(toHead(row({ show_hours: true, opening_hours: null }))?.opening_hours).toBeNull();
  });

  it("vazios viram null e o fuso cai no de São Paulo", () => {
    const h = toHead(row({ instagram: "", logo_path: null, brand_color: undefined, timezone: "" }));
    expect(h).toMatchObject({ instagram: null, logo_path: null, brand_color: null, timezone: TZ });
  });

  it("sem linha: null", () => {
    expect(toHead(null)).toBeNull();
  });
});

describe("toContent (linhas do NocoDB → agenda, posts e telões)", () => {
  // O NocoDB devolve DateTime como "AAAA-MM-DD HH:MM:SS+00:00".
  const noco = (ms: number) => new Date(ms).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "+00:00");
  const pollRow = (id: string, over: Record<string, unknown> = {}) => ({
    ...poll(id),
    uid: id,
    Id: 1,
    starts_at: noco(now - 5 * MIN),
    ends_at: noco(now + 5 * MIN),
    created_at: noco(now - HOUR),
    ...over,
  });

  it("datas viram ISO, para o celular conseguir ler em qualquer navegador", () => {
    const { polls } = toContent({ polls: [pollRow(P_OPEN, { closed_at: noco(now - MIN) })], posts: [], tvs: [] }, NOW);
    expect(polls[0]).toEqual({
      ...poll(P_OPEN),
      starts_at: iso(now - 5 * MIN),
      ends_at: iso(now + 5 * MIN),
      closed_at: iso(now - MIN),
      created_at: iso(now - HOUR),
    });
  });

  it("guarda as enquetes que terminaram nas últimas 24 h e as futuras", () => {
    const { polls } = toContent(
      {
        polls: [
          pollRow(U(1), { starts_at: noco(now - 25 * HOUR), ends_at: noco(now - 24 * HOUR - MIN) }),
          pollRow(U(2), { starts_at: noco(now - 24 * HOUR), ends_at: noco(now - 23 * HOUR) }),
          pollRow(U(3)),
          pollRow(U(4), { starts_at: noco(now + HOUR), ends_at: noco(now + 2 * HOUR) }),
          pollRow(U(5), { starts_at: "ontem", ends_at: noco(now + HOUR) }),
          pollRow(U(6), { options: "nao-e-lista" }),
        ],
        posts: [],
        tvs: [],
      },
      NOW,
    );
    expect(polls.map((p) => p.id)).toEqual([U(2), U(3), U(4), U(6)]);
    expect(polls.find((p) => p.id === U(6))?.options).toEqual([]);
  });

  it("só posts aprovados, com datas em ISO", () => {
    const { posts } = toContent(
      {
        polls: [],
        posts: [
          { ...post(1), uid: post(1).id, created_at: noco(now - MIN), on_tv: true },
          { ...post(2), uid: post(2).id, status: "hidden", hidden_at: noco(now - MIN) },
          { ...post(3), uid: post(3).id, status: "pending" },
        ],
        tvs: [],
      },
      NOW,
    );
    expect(posts).toEqual([{ ...post(1), created_at: iso(now - MIN), on_tv: true }]);
  });

  it("telões sem o hash do segredo nem o código de pareamento", () => {
    const { tvs } = toContent(
      {
        polls: [],
        posts: [],
        tvs: [
          {
            uid: U(7000),
            id: U(7000),
            restaurant_id: "r1",
            label: "Salão",
            pair_code: "ABC234",
            pair_expires_at: noco(now + MIN),
            secret_hash: "f".repeat(64),
            paired_at: noco(now - HOUR),
            last_seen_at: noco(now - MIN),
            revoked: false,
            created_at: noco(now - 2 * HOUR),
          },
        ],
      },
      NOW,
    );
    expect(tvs).toEqual([
      {
        id: U(7000),
        restaurant_id: "r1",
        label: "Salão",
        pair_code: null,
        pair_expires_at: iso(now + MIN),
        secret_hash: "",
        paired_at: iso(now - HOUR),
        last_seen_at: iso(now - MIN),
        revoked: false,
        created_at: iso(now - 2 * HOUR),
      },
    ]);
  });
});

describe("parseBefore (?antes= do Mural)", () => {
  it("aceita data ISO e o formato do NocoDB, e devolve ISO", () => {
    expect(parseBefore("2026-10-16T22:55:00.000Z")).toBe("2026-10-16T22:55:00.000Z");
    expect(parseBefore("2026-10-16T22:55:00Z")).toBe("2026-10-16T22:55:00.000Z");
    expect(parseBefore("2026-10-16 22:55:00+00:00")).toBe("2026-10-16T22:55:00.000Z");
    expect(parseBefore("2026-10-16T19:55:00-03:00")).toBe("2026-10-16T22:55:00.000Z");
  });

  it("recusa o que não é data ISO", () => {
    for (const s of ["", "ontem", "1760655300000", "2026-10-16", "2026-13-45T00:00:00Z", "2026-10-16T22:55:00Z,(x)", "2".repeat(300)]) {
      expect(parseBefore(s)).toBeNull();
    }
  });
});
