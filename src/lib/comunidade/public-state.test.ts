import { describe, expect, it } from "vitest";
import { MURAL_PAGE, TV_FRESH_MS, buildPublicState, cacheControl, disabledState } from "./public-state";
import type { CommunityHead, OptionId, PollRow, PostRow, TvRow, VoteRow } from "./types";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TZ = "America/Sao_Paulo";
const MIN = 60_000;
const NOW = new Date("2026-10-16T23:00:00Z"); // sexta, 20:00 em São Paulo
const now = NOW.getTime();
const iso = (ms: number) => new Date(ms).toISOString();

const HEAD: CommunityHead = {
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
};

const POLL = U(10);
const poll = (over: Partial<PollRow> = {}): PollRow => ({
  id: POLL,
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
  created_at: iso(now - 60 * MIN),
  ...over,
});

// Devices e mesas com números próprios, para o teste de vazamento procurar a string exata.
let vseq = 0;
const vote = (option: OptionId, over: Partial<VoteRow> = {}): VoteRow => {
  vseq++;
  return {
    id: U(3000 + vseq),
    restaurant_id: "r1",
    poll_id: POLL,
    option_id: option,
    device_id: U(4000 + vseq),
    table_id: U(5000 + vseq),
    created_at: iso(now - 4 * MIN + vseq * 1000),
    ...over,
  };
};
const votes = (a: number, b: number, c: number) => [
  ...Array.from({ length: a }, () => vote("a")),
  ...Array.from({ length: b }, () => vote("b")),
  ...Array.from({ length: c }, () => vote("c")),
];

const post = (n: number, over: Partial<PostRow> = {}): PostRow => ({
  id: U(6000 + n),
  restaurant_id: "r1",
  item_id: U(20),
  photo_path: `https://blob.example/r1/comunidade/${n}-full.webp`,
  thumb_path: `https://blob.example/r1/comunidade/${n}-thumb.webp`,
  source: "house",
  status: "approved",
  on_tv: n % 2 === 0,
  hidden_at: null,
  created_at: iso(now - n * MIN),
  ...over,
});

const tv = (over: Partial<TvRow> = {}): TvRow => ({
  id: U(7000),
  restaurant_id: "r1",
  label: "TV do salão",
  pair_code: null,
  pair_expires_at: null,
  secret_hash: "f".repeat(64),
  paired_at: iso(now - 120 * MIN),
  last_seen_at: iso(now - 5 * MIN),
  revoked: false,
  created_at: iso(now - 130 * MIN),
  ...over,
});

type Input = Parameters<typeof buildPublicState>[0];
const input = (over: Partial<Input> = {}): Input => ({
  head: HEAD,
  open: true,
  polls: [poll()],
  votes: votes(2, 1, 0),
  posts: [post(1), post(2)],
  tvs: [tv()],
  now: NOW,
  ...over,
});

describe("buildPublicState: o que nunca sai pela rota pública", () => {
  it("mutação: sem device_id, table_id, post oculto, contagem nem lista de votos", () => {
    const vs = votes(3, 2, 1);
    const hidden = post(99, { status: "hidden", hidden_at: iso(now - 1 * MIN), created_at: iso(now) });
    const otherRestaurant = post(98, { restaurant_id: "r2", created_at: iso(now) });
    const s = buildPublicState(input({ votes: vs, posts: [post(1), hidden, otherRestaurant], tvs: [tv()] }));
    const json = JSON.stringify(s);

    for (const v of vs) {
      expect(json).not.toContain(v.device_id);
      expect(json).not.toContain(v.table_id);
      expect(json).not.toContain(v.id);
    }
    expect(json).not.toContain("device_id");
    expect(json).not.toContain("table_id");
    expect(json).not.toContain(hidden.id);
    expect(json).not.toContain(hidden.photo_path);
    expect(json).not.toContain(hidden.thumb_path);
    expect(json).not.toContain(otherRestaurant.id);
    expect(json).not.toContain('"count"');
    expect(json).not.toContain('"counts"');
    expect(json).not.toContain('"votes"');
    expect(json).not.toContain("secret_hash");
    expect(json).not.toContain("f".repeat(64));
    expect(json).not.toContain("restaurant_id");
  });

  it("a enquete e o post públicos têm só as chaves combinadas", () => {
    const s = buildPublicState(input());
    expect(Object.keys(s).sort()).toEqual(["enabled", "has_tv", "instagram", "mural", "next", "now", "open", "poll", "v"]);
    expect(Object.keys(s.poll!).sort()).toEqual(["closed", "ends_at", "has_votes", "id", "options", "question", "starts_at", "template", "winner"]);
    expect(Object.keys(s.poll!.options[0]).sort()).toEqual(["id", "item_id", "label", "pct"]);
    expect(Object.keys(s.mural[0]).sort()).toEqual(["created_at", "id", "item_id", "on_tv", "photo", "thumb"]);
  });

  it("ignora enquete, voto e TV de outro restaurante", () => {
    const foreignPoll = poll({ id: U(11), restaurant_id: "r2", starts_at: iso(now - 1 * MIN) });
    const foreignVote = vote("c", { restaurant_id: "r2" });
    const s = buildPublicState(input({ polls: [poll(), foreignPoll], votes: [...votes(1, 0, 0), foreignVote], tvs: [tv({ restaurant_id: "r2" })] }));
    expect(s.poll?.id).toBe(POLL);
    expect(s.poll?.options.map((o) => o.pct)).toEqual([100, 0, 0]);
    expect(s.has_tv).toBe(false);
  });
});

describe("buildPublicState: enquete", () => {
  it("porcentagens pelo maior resto, com label e item_id da casa", () => {
    const s = buildPublicState(input({ votes: votes(2, 1, 0) }));
    expect(s.enabled).toBe(true);
    expect(s.open).toBe(true);
    expect(s.now).toBe(NOW.toISOString());
    expect(s.poll).toMatchObject({ id: POLL, template: "dessert", question: "Qual sobremesa sai hoje?", closed: false, has_votes: true, winner: null });
    expect(s.poll?.options).toEqual([
      { id: "a", label: "Petit gâteau", item_id: U(20), pct: 67 },
      { id: "b", label: "Pudim", item_id: U(21), pct: 33 },
      { id: "c", label: "Sorvete da casa", item_id: null, pct: 0 },
    ]);
  });

  it("só o primeiro voto de cada device conta", () => {
    const first = vote("a");
    const again = vote("b", { device_id: first.device_id });
    const s = buildPublicState(input({ votes: [first, again] }));
    expect(s.poll?.options.map((o) => o.pct)).toEqual([100, 0, 0]);
  });

  it("os tetos valem no agregado (9 votos da mesma mesa contam 8)", () => {
    const table = U(5999);
    const vs = [...Array.from({ length: 8 }, () => vote("a", { table_id: table })), vote("b", { table_id: table })];
    const s = buildPublicState(input({ votes: vs }));
    expect(s.poll?.options.map((o) => o.pct)).toEqual([100, 0, 0]);
  });

  it("has_votes é false sem votos", () => {
    const s = buildPublicState(input({ votes: [] }));
    expect(s.poll?.has_votes).toBe(false);
    expect(s.poll?.options.map((o) => o.pct)).toEqual([0, 0, 0]);
  });

  it("winner é a maior porcentagem quando encerrada", () => {
    const closed = poll({ starts_at: iso(now - 20 * MIN), ends_at: iso(now - 2 * MIN) });
    const s = buildPublicState(input({ polls: [closed], votes: votes(1, 2, 0) }));
    expect(s.poll?.closed).toBe(true);
    expect(s.poll?.winner).toBe("b");
  });

  it("no empate, a primeira opção vence", () => {
    const closed = poll({ starts_at: iso(now - 20 * MIN), ends_at: iso(now - 2 * MIN) });
    expect(buildPublicState(input({ polls: [closed], votes: votes(0, 2, 2) })).poll?.winner).toBe("b");
    expect(buildPublicState(input({ polls: [closed], votes: votes(1, 1, 1) })).poll?.winner).toBe("a");
  });

  it("winner vem da contagem, não da porcentagem arredondada (votos 0, 50, 51)", () => {
    // Com 101 votos o maior resto dá 50% a b e a c; quem teve 51 votos é que vence.
    const closed = poll({ starts_at: iso(now - 20 * MIN), ends_at: iso(now - 2 * MIN) });
    const s = buildPublicState(input({ polls: [closed], votes: votes(0, 50, 51) }));
    expect(s.poll?.options.map((o) => o.pct)).toEqual([0, 50, 50]);
    expect(s.poll?.winner).toBe("c");
  });

  it("aberta não tem winner; encerrada sem votos também não", () => {
    expect(buildPublicState(input({ votes: votes(3, 0, 0) })).poll?.winner).toBeNull();
    const closed = poll({ starts_at: iso(now - 20 * MIN), ends_at: iso(now - 2 * MIN) });
    const s = buildPublicState(input({ polls: [closed], votes: [] }));
    expect(s.poll?.closed).toBe(true);
    expect(s.poll?.winner).toBeNull();
  });

  it("encerrada há mais de 15 min sai do poll", () => {
    const old = poll({ starts_at: iso(now - 40 * MIN), ends_at: iso(now - 16 * MIN) });
    expect(buildPublicState(input({ polls: [old] })).poll).toBeNull();
  });

  it("next: a próxima agendada do dia, sem opções nem id", () => {
    const later = poll({ id: U(12), template: "drink", question: "Qual drinque?", starts_at: iso(now + 60 * MIN), ends_at: iso(now + 70 * MIN) });
    const s = buildPublicState(input({ polls: [poll(), later] }));
    expect(s.next).toEqual({ starts_at: later.starts_at, template: "drink", question: "Qual drinque?" });
  });

  it("next: enquete de outro dia da Comunidade não aparece", () => {
    // O dia vai até 05:00 de sábado em São Paulo (08:00Z do dia 17).
    const tomorrow = poll({ id: U(13), starts_at: "2026-10-17T08:00:00.000Z", ends_at: "2026-10-17T08:10:00.000Z" });
    expect(buildPublicState(input({ polls: [tomorrow] })).next).toBeNull();
    const lateNight = poll({ id: U(14), starts_at: "2026-10-17T07:50:00.000Z", ends_at: "2026-10-17T07:59:00.000Z" });
    expect(buildPublicState(input({ polls: [lateNight] })).next?.starts_at).toBe(lateNight.starts_at);
  });
});

describe("buildPublicState: mural", () => {
  const many = Array.from({ length: 25 }, (_, i) => post(i + 1));
  it(`no máximo ${MURAL_PAGE}, do mais novo para o mais velho`, () => {
    expect(MURAL_PAGE).toBe(20);
    const shuffled = [...many].reverse();
    const s = buildPublicState(input({ posts: shuffled }));
    expect(s.mural).toHaveLength(20);
    const times = s.mural.map((p) => Date.parse(p.created_at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(s.mural[0].id).toBe(post(1).id);
  });

  it("respeita before (paginação)", () => {
    const s = buildPublicState(input({ posts: many, before: post(20).created_at }));
    expect(s.mural.map((p) => p.id)).toEqual([21, 22, 23, 24, 25].map((n) => post(n).id));
  });

  it("thumb e photo vêm das URLs da casa", () => {
    const s = buildPublicState(input({ posts: [post(2)] }));
    expect(s.mural[0]).toEqual({ id: post(2).id, item_id: U(20), thumb: post(2).thumb_path, photo: post(2).photo_path, on_tv: true, created_at: post(2).created_at });
  });
});

describe("buildPublicState: telão", () => {
  it("has_tv com o telão visto há 5 min", () => {
    expect(TV_FRESH_MS).toBe(10 * MIN);
    expect(buildPublicState(input({ tvs: [tv({ last_seen_at: iso(now - 5 * MIN) })] })).has_tv).toBe(true);
  });
  it("sem has_tv com o telão visto há 11 min", () => {
    expect(buildPublicState(input({ tvs: [tv({ last_seen_at: iso(now - 11 * MIN) })] })).has_tv).toBe(false);
  });
  it("sem has_tv se revogado", () => {
    expect(buildPublicState(input({ tvs: [tv({ revoked: true })] })).has_tv).toBe(false);
  });
  it("sem has_tv se ainda não pareado", () => {
    expect(buildPublicState(input({ tvs: [tv({ paired_at: null, pair_code: "ABC234" })] })).has_tv).toBe(false);
  });
});

describe("buildPublicState: desligada e fechada", () => {
  it("Comunidade desligada devolve o estado desligado, sem nada da casa", () => {
    const s = buildPublicState(input({ head: { ...HEAD, enabled: false } }));
    expect(s).toEqual(disabledState(NOW));
  });
  it("restaurante fechado: open false, sem enquete nem mural", () => {
    const s = buildPublicState(input({ open: false }));
    expect(s.enabled).toBe(true);
    expect(s.open).toBe(false);
    expect(s.poll).toBeNull();
    expect(s.next).toBeNull();
    expect(s.mural).toEqual([]);
    expect(s.has_tv).toBe(false);
  });
});

describe("disabledState", () => {
  it("enabled false e nada mais preenchido", () => {
    const s = disabledState(NOW);
    expect(s).toMatchObject({ enabled: false, open: false, now: NOW.toISOString(), poll: null, next: null, mural: [], has_tv: false, instagram: null });
    expect(typeof s.v).toBe("string");
    expect(s.v.length).toBeGreaterThan(0);
  });
});

describe("cacheControl", () => {
  it("enquete aberta: 4 s", () => {
    expect(cacheControl(buildPublicState(input()))).toBe("public, max-age=0, s-maxage=4, stale-while-revalidate=4");
  });
  it("sem enquete: 30 s", () => {
    expect(cacheControl(buildPublicState(input({ polls: [] })))).toBe("public, max-age=0, s-maxage=30, stale-while-revalidate=30");
  });
  it("enquete encerrada há pouco: 30 s", () => {
    const closed = poll({ starts_at: iso(now - 20 * MIN), ends_at: iso(now - 2 * MIN) });
    expect(cacheControl(buildPublicState(input({ polls: [closed] })))).toBe("public, max-age=0, s-maxage=30, stale-while-revalidate=30");
  });
  it("desligada ou fechada: 60 s", () => {
    expect(cacheControl(disabledState(NOW))).toBe("public, max-age=0, s-maxage=60");
    expect(cacheControl(buildPublicState(input({ open: false })))).toBe("public, max-age=0, s-maxage=60");
  });
});

describe("v (hash do conteúdo)", () => {
  it("igual para entradas iguais", () => {
    const vs = votes(2, 1, 0);
    expect(buildPublicState(input({ votes: vs })).v).toBe(buildPublicState(input({ votes: vs })).v);
  });
  it("não depende de now quando o conteúdo é o mesmo", () => {
    const vs = votes(2, 1, 0);
    const a = buildPublicState(input({ votes: vs }));
    const b = buildPublicState(input({ votes: vs, now: new Date(now + 1000) }));
    expect(a.now).not.toBe(b.now);
    expect(a.v).toBe(b.v);
  });
  it("muda quando muda a porcentagem", () => {
    const a = buildPublicState(input({ votes: votes(2, 1, 0) }));
    const b = buildPublicState(input({ votes: votes(2, 2, 0) }));
    expect(a.poll?.options[0].pct).not.toBe(b.poll?.options[0].pct);
    expect(a.v).not.toBe(b.v);
  });
  it("é curto", () => {
    expect(buildPublicState(input()).v).toMatch(/^[0-9a-f]{8}$/);
  });
});
