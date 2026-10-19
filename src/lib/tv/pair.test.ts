import { describe, expect, it } from "vitest";
import type { TvHead } from "./types";
import {
  PAIR_CODES_LIVE_MAX,
  PAIR_CODES_PER_HOUR,
  PAIR_CODE_TTL_MS,
  checkTv,
  confirmPair,
  randomPairCode,
  requestPairCode,
  sha256Hex,
  type TvDb,
  type TvDeps,
} from "./pair";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const MIN = 60_000;
const NOW = new Date("2026-10-16T23:00:00Z");
const now = NOW.getTime();
const iso = (ms: number) => new Date(ms).toISOString();
// O NocoDB devolve as datas assim, com espaço e fuso "+00:00".
const noco = (ms: number) => iso(ms).replace("T", " ").replace(/\.\d+Z$/, "+00:00");

const R1 = U(1);
const R2 = U(2);
const head = (over: Partial<TvHead> = {}): TvHead => ({
  id: R1,
  slug: "forno",
  name: "Forno",
  timezone: "America/Sao_Paulo",
  opening_hours: null,
  instagram: "@forno",
  logo_path: null,
  brand_color: null,
  tv_simple: false,
  ...over,
});
const OTHER = head({ id: R2, slug: "outro", name: "Outro" });

// Segredos de 32 bytes em hex, como a TV gera.
const SECRET_A = "0123456789abcdef".repeat(4);
const SECRET_B = "fedcba9876543210".repeat(4);
const SECRET_C = "00112233445566778899aabbccddeeff".repeat(2);
const HEX64 = /^[0-9a-f]{64}$/;

type Where = Record<string, string | number | boolean | null>;
type Raw = Record<string, unknown>;

// Como o NocoDB: cada leitura é uma cópia (quem leu antes não vê o que mudou depois) e
// cada linha nova ganha o "Id" numérico seguinte.
function fakeDb(rows: Raw[] = []) {
  const tvs: Raw[] = rows.map((r) => ({ uid: r.id, ...r }));
  let n = 9000;
  let nextId = 1000;
  const calls = { insertOne: 0, list: 0, update: [] as { w: Where; p: Raw }[], remove: [] as Where[] };
  // Corrida simulada: algo que outra instância grava logo depois deste insert.
  let afterInsert: (() => void) | null = null;
  const match = (r: Raw, w: Where) => Object.entries(w).every(([k, v]) => (r[k] ?? null) === v);
  const db: TvDb = {
    async list(_t, w) {
      calls.list++;
      return tvs.filter((r) => match(r, w)).map((r) => ({ ...r })) as never;
    },
    async first(_t, w) {
      const r = tvs.find((x) => match(x, w));
      return (r ? { ...r } : null) as never;
    },
    async insertOne(_t, row) {
      calls.insertOne++;
      const uid = U(++n);
      const full = { Id: ++nextId, uid, id: uid, created_at: noco(now), ...row };
      tvs.push(full);
      const hook = afterInsert;
      afterInsert = null;
      hook?.();
      return { ...full } as never;
    },
    async update(_t, w, p) {
      calls.update.push({ w, p });
      const hit = tvs.filter((r) => match(r, w));
      for (const r of hit) Object.assign(r, p);
      return hit.length;
    },
    async remove(_t, w) {
      calls.remove.push(w);
      const keep = tvs.filter((r) => !match(r, w));
      const gone = tvs.length - keep.length;
      tvs.splice(0, tvs.length, ...keep);
      return gone;
    },
  };
  return { db, tvs, calls, onInsert: (f: () => void) => (afterInsert = f) };
}

function setup(o: { rows?: Raw[]; head?: TvHead | null; at?: () => number; codes?: string[] } = {}) {
  const f = fakeDb(o.rows);
  const heads: Record<string, TvHead | null> = { forno: o.head === undefined ? head() : o.head, outro: OTHER };
  const codes = [...(o.codes ?? [])];
  let k = 0;
  const deps: TvDeps = {
    db: f.db,
    getHead: async (s) => heads[s] ?? null,
    now: () => new Date(o.at?.() ?? now),
    // Códigos previsíveis no teste: os da lista, depois "CODE22", "CODE23"...
    code: () => codes.shift() ?? `CODE${22 + k++}`,
  };
  return { ...f, deps };
}

// Linha de telão como o NocoDB a devolve.
const tv = (n: number, over: Raw = {}): Raw => ({
  Id: 100 + n,
  id: U(500 + n),
  restaurant_id: R1,
  label: null,
  pair_code: null,
  pair_expires_at: null,
  secret_hash: "",
  paired_at: null,
  last_seen_at: null,
  revoked: false,
  created_at: noco(now - 2 * 60 * MIN),
  ...over,
});

describe("sha256Hex", () => {
  it("é o SHA-256 em hex minúsculo (vetor conhecido)", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await sha256Hex(SECRET_A)).toMatch(HEX64);
    expect(await sha256Hex(SECRET_A)).not.toBe(await sha256Hex(SECRET_B));
  });
});

describe("randomPairCode", () => {
  it("gera 6 caracteres do QR, sem I nem O, e não repete o mesmo código", () => {
    const codes = Array.from({ length: 300 }, randomPairCode);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(new Set(codes).size).toBeGreaterThan(290);
  });
});

describe("requestPairCode", () => {
  it("grava a linha pendente com o hash da TV, o código e o prazo de +10 min, no restaurante do slug", async () => {
    const s = setup({ codes: ["K7M3QX"] });
    const hash = await sha256Hex(SECRET_A);
    const r = await requestPairCode(s.deps, "forno", { hash, restaurant_id: R2 });
    expect(r).toEqual({ ok: true, code: "K7M3QX", expires_at: iso(now + PAIR_CODE_TTL_MS), created: true });
    expect(PAIR_CODE_TTL_MS).toBe(10 * MIN);
    expect(s.tvs).toHaveLength(1);
    expect(s.tvs[0]).toMatchObject({
      restaurant_id: R1,
      secret_hash: hash,
      pair_code: "K7M3QX",
      pair_expires_at: iso(now + PAIR_CODE_TTL_MS),
      revoked: false,
      created_at: iso(now),
    });
    expect(s.tvs[0].paired_at ?? null).toBeNull();
  });

  it("o prazo sai em segundos inteiros, como o NocoDB guarda, e volta igual na segunda vez", async () => {
    const s = setup({ at: () => now + 456 });
    const hash = await sha256Hex(SECRET_A);
    const r = await requestPairCode(s.deps, "forno", { hash });
    expect(r).toMatchObject({ ok: true, expires_at: iso(now + PAIR_CODE_TTL_MS) });
    // O banco devolve a data sem milissegundos, no formato dele.
    s.tvs[0].pair_expires_at = noco(Date.parse(s.tvs[0].pair_expires_at as string));
    expect(await requestPairCode(s.deps, "forno", { hash })).toEqual({ ...r, created: false });
  });

  it("corpo malformado: invalid, sem gravar", async () => {
    const s = setup();
    const hash = await sha256Hex(SECRET_A);
    const bad = [null, "texto", [], {}, { hash: 1 }, { hash: "xyz" }, { hash: hash.slice(1) }, { hash: hash + "0" }, { hash: hash.toUpperCase() }];
    for (const b of bad) expect(await requestPairCode(s.deps, "forno", b)).toEqual({ ok: false, code: "invalid" });
    expect(s.calls.insertOne).toBe(0);
  });

  it("restaurante que não existe: not_found", async () => {
    const s = setup();
    expect(await requestPairCode(s.deps, "nada", { hash: await sha256Hex(SECRET_A) })).toEqual({ ok: false, code: "not_found" });
    expect(s.calls.insertOne).toBe(0);
  });

  it("sem teto por hora no restaurante: o 6º código da mesma hora sai (o limite por IP fica na rota)", async () => {
    // 5 por hora agora é por IP e slug, na rota; aqui não há conta de códigos por hora.
    expect(PAIR_CODES_PER_HOUR).toBe(5);
    let t = now;
    const s = setup({ at: () => t });
    for (let i = 0; i < 8; i++) {
      expect((await requestPairCode(s.deps, "forno", { hash: await sha256Hex(`tv-${i}`) })).ok).toBe(true);
      t += 5 * MIN;
    }
    expect(s.calls.insertOne).toBe(8);
  });

  // 19 códigos vivos de TVs diferentes, com Id menor que qualquer linha nova.
  const liveRows = (k: number, over: Raw = {}) =>
    Array.from({ length: k }, (_, i) =>
      tv(i, { pair_code: `LV${"ABCDEFGHJKLMNPQRSTUVWXYZ"[i]}222`, pair_expires_at: noco(now + 5 * MIN), secret_hash: `${i}`.padStart(64, "e"), created_at: noco(now - MIN), ...over }),
    );

  it("teto de 20 códigos vivos por restaurante: o 21º é too_many, sem gravar", async () => {
    expect(PAIR_CODES_LIVE_MAX).toBe(20);
    const s = setup({ rows: liveRows(19) });
    expect((await requestPairCode(s.deps, "forno", { hash: await sha256Hex(SECRET_A) })).ok).toBe(true);
    expect(await requestPairCode(s.deps, "forno", { hash: await sha256Hex(SECRET_B) })).toEqual({ ok: false, code: "too_many" });
    expect(s.calls.insertOne).toBe(1);
    expect(s.tvs).toHaveLength(20);
  });

  it("vencido, pareado e de outro restaurante não contam no teto de vivos", async () => {
    const rows = [
      ...liveRows(7, { pair_expires_at: noco(now - 1000) }),
      ...liveRows(7, { paired_at: noco(now - MIN) }).map((r, i) => ({ ...r, Id: 200 + i, id: U(700 + i) })),
      ...liveRows(20, { restaurant_id: R2 }).map((r, i) => ({ ...r, Id: 300 + i, id: U(800 + i) })),
    ];
    const s = setup({ rows });
    expect((await requestPairCode(s.deps, "forno", { hash: await sha256Hex(SECRET_A) })).ok).toBe(true);
    // No outro restaurante, os 20 vivos dele já enchem o teto.
    expect(await requestPairCode(s.deps, "outro", { hash: await sha256Hex(SECRET_B) })).toEqual({ ok: false, code: "too_many" });
  });

  it("corrida: 3 TVs pedem juntas com 19 vivos; depois de gravar, cada uma reconta e só o menor Id fica", async () => {
    const s = setup({ rows: liveRows(19) });
    const hashes = await Promise.all([SECRET_A, SECRET_B, SECRET_C].map(sha256Hex));
    const rs = await Promise.all(hashes.map((hash) => requestPairCode(s.deps, "forno", { hash })));
    // As 3 viram 19 vivos e gravaram; na recontagem, só a primeira gravada (menor Id) cabe.
    expect(s.calls.insertOne).toBe(3);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.filter((r) => !r.ok)).toEqual([{ ok: false, code: "too_many" }, { ok: false, code: "too_many" }]);
    const winner = rs.findIndex((r) => r.ok);
    expect(s.tvs).toHaveLength(20);
    expect(s.tvs.filter((r) => hashes.includes(r.secret_hash as string)).map((r) => r.secret_hash)).toEqual([hashes[winner]]);
    // Cada perdedora apagou só a própria linha, no restaurante dela.
    expect(s.calls.remove).toHaveLength(2);
    for (const w of s.calls.remove) expect(w).toMatchObject({ restaurant_id: R1, uid: expect.any(String) });
  });

  it("mutação: na recontagem vale o Id, não a ordem da lista", async () => {
    const hash = await sha256Hex(SECRET_A);
    const other = (id: number) => ({
      ...tv(90, { Id: id, pair_code: "QQQ222", pair_expires_at: noco(now + 5 * MIN), secret_hash: "d".repeat(64), created_at: noco(now) }),
      uid: U(590),
    });
    // Outra TV grava ao mesmo tempo e o NocoDB dá a ela um Id MENOR que o desta, embora a
    // linha dela chegue depois na lista: esta perde, apaga a própria linha e a outra fica.
    const lose = setup({ rows: liveRows(19) });
    lose.onInsert(() => lose.tvs.push(other(150)));
    expect(await requestPairCode(lose.deps, "forno", { hash })).toEqual({ ok: false, code: "too_many" });
    expect(lose.tvs.map((r) => r.secret_hash)).not.toContain(hash);
    expect(lose.tvs).toHaveLength(20);
    // Com Id MAIOR, esta fica (a outra se apaga na recontagem dela).
    const win = setup({ rows: liveRows(19) });
    win.onInsert(() => win.tvs.push(other(5_000)));
    expect((await requestPairCode(win.deps, "forno", { hash })).ok).toBe(true);
    expect(win.calls.remove).toHaveLength(0);
  });

  it("hash de uma linha revogada é recusado (invalid), sem gravar", async () => {
    const hash = await sha256Hex(SECRET_A);
    const revokedPaired = tv(1, { secret_hash: hash, paired_at: noco(now - 60 * MIN), revoked: true });
    const s = setup({ rows: [revokedPaired] });
    expect(await requestPairCode(s.deps, "forno", { hash })).toEqual({ ok: false, code: "invalid" });
    const revokedPending = tv(2, { secret_hash: hash, pair_code: "K7M3QX", pair_expires_at: noco(now + 5 * MIN), revoked: true });
    const p = setup({ rows: [revokedPending] });
    expect(await requestPairCode(p.deps, "forno", { hash })).toEqual({ ok: false, code: "invalid" });
    expect(s.calls.insertOne + p.calls.insertOne).toBe(0);
    // Revogada em outro restaurante não atrapalha este.
    const elsewhere = setup({ rows: [{ ...revokedPaired, restaurant_id: R2 }] });
    expect((await requestPairCode(elsewhere.deps, "forno", { hash })).ok).toBe(true);
  });

  it("a mesma TV pedindo de novo com o código no prazo recebe o mesmo código, sem gravar outra linha (created: false)", async () => {
    let t = now;
    const s = setup({ at: () => t, codes: ["K7M3QX", "P2R8ZW"] });
    const hash = await sha256Hex(SECRET_A);
    const first = await requestPairCode(s.deps, "forno", { hash });
    expect(first).toMatchObject({ ok: true, created: true });
    t += 4 * MIN;
    expect(await requestPairCode(s.deps, "forno", { hash })).toEqual({ ...first, created: false });
    expect(s.calls.insertOne).toBe(1);
    // Vencido o prazo, sai um código novo.
    t = now + PAIR_CODE_TTL_MS;
    expect(await requestPairCode(s.deps, "forno", { hash })).toMatchObject({ ok: true, code: "P2R8ZW", created: true });
    expect(s.calls.insertOne).toBe(2);
  });

  it("não repete um código que ainda vale no mesmo restaurante", async () => {
    const pending = tv(1, { pair_code: "K7M3QX", pair_expires_at: noco(now + 5 * MIN), secret_hash: await sha256Hex(SECRET_B), created_at: noco(now - 2 * 60 * MIN) });
    const s = setup({ rows: [pending], codes: ["K7M3QX", "P2R8ZW"] });
    expect(await requestPairCode(s.deps, "forno", { hash: await sha256Hex(SECRET_A) })).toMatchObject({ ok: true, code: "P2R8ZW" });
  });
});

describe("confirmPair", () => {
  async function pending(over: Raw = {}) {
    return tv(1, { pair_code: "K7M3QX", pair_expires_at: noco(now + 5 * MIN), secret_hash: await sha256Hex(SECRET_A), created_at: noco(now - 5 * MIN), ...over });
  }

  it("código válido grava paired_at e label e limpa o código", async () => {
    const s = setup({ rows: [await pending()] });
    expect(await confirmPair(s.deps, R1, "K7M3QX", "  TV do salão  ")).toEqual({ ok: true });
    expect(s.tvs[0]).toMatchObject({ paired_at: iso(now), last_seen_at: iso(now), label: "TV do salão", pair_code: null, revoked: false });
  });

  it("aceita o código digitado em minúsculas ou com espaços", async () => {
    const s = setup({ rows: [await pending()] });
    expect(await confirmPair(s.deps, R1, " k7m 3qx ", "TV")).toEqual({ ok: true });
    expect(s.tvs[0].paired_at).toBe(iso(now));
  });

  it("mutação: código de outro restaurante é recusado e a linha dele fica intacta", async () => {
    const theirs = await pending({ restaurant_id: R2 });
    const s = setup({ rows: [theirs] });
    const r = await confirmPair(s.deps, R1, "K7M3QX", "TV");
    expect(r.ok).toBe(false);
    expect(s.calls.update).toHaveLength(0);
    expect(s.tvs[0]).toMatchObject({ restaurant_id: R2, pair_code: "K7M3QX", paired_at: null });
  });

  it("código vencido é recusado", async () => {
    const s = setup({ rows: [await pending({ pair_expires_at: noco(now - 1000) })] });
    expect((await confirmPair(s.deps, R1, "K7M3QX", "TV")).ok).toBe(false);
    const exato = setup({ rows: [await pending({ pair_expires_at: iso(now) })] });
    expect((await confirmPair(exato.deps, R1, "K7M3QX", "TV")).ok).toBe(false);
    expect(s.calls.update.length + exato.calls.update.length).toBe(0);
  });

  it("o mesmo código uma segunda vez é recusado", async () => {
    const s = setup({ rows: [await pending()] });
    expect(await confirmPair(s.deps, R1, "K7M3QX", "TV")).toEqual({ ok: true });
    const r = await confirmPair(s.deps, R1, "K7M3QX", "Outra TV");
    expect(r.ok).toBe(false);
    expect(s.tvs[0].label).toBe("TV");
  });

  it("código malformado, inexistente ou de TV revogada é recusado", async () => {
    const s = setup({ rows: [await pending({ revoked: true })] });
    for (const c of ["", "K7M3Q", "K7M3QX1", "K7M3Q0", "ZZZZZZ", "K7M3QX"]) {
      const r = await confirmPair(s.deps, R1, c, "TV");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/\S/);
    }
    expect(s.calls.update.length).toBe(0);
  });

  it("restaurantId que não é uuid é recusado sem consultar o banco", async () => {
    const s = setup({ rows: [await pending()] });
    for (const rid of ["", "r1", "ABCDEF00-0000-4000-8000-000000000001", `${R1} `, `${R1}0`, "1,2", "(x)~or"]) {
      expect((await confirmPair(s.deps, rid, "K7M3QX", "TV")).ok).toBe(false);
    }
    expect(s.calls.list).toBe(0);
    expect(s.calls.update).toHaveLength(0);
  });

  it("o update leva o código no filtro: dois 'Parear' ao mesmo tempo, só um vence", async () => {
    const s = setup({ rows: [await pending()] });
    const [a, b] = await Promise.all([confirmPair(s.deps, R1, "K7M3QX", "Salão"), confirmPair(s.deps, R1, "K7M3QX", "Varanda")]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(s.tvs[0].label).toBe(a.ok ? "Salão" : "Varanda");
    for (const u of s.calls.update) expect(u.w).toMatchObject({ uid: U(501), restaurant_id: R1, pair_code: "K7M3QX" });
  });

  it("nome vazio fica sem nome; nome longo é cortado em 40 caracteres", async () => {
    const s = setup({ rows: [await pending()] });
    await confirmPair(s.deps, R1, "K7M3QX", "   ");
    expect(s.tvs[0].label).toBeNull();
    const longo = setup({ rows: [await pending()] });
    await confirmPair(longo.deps, R1, "K7M3QX", "x".repeat(60));
    expect(longo.tvs[0].label).toBe("x".repeat(40));
  });
});

describe("checkTv", () => {
  async function paired(over: Raw = {}) {
    return tv(1, { secret_hash: await sha256Hex(SECRET_A), paired_at: noco(now - 60 * MIN), last_seen_at: noco(now - 5 * MIN), label: "TV", ...over });
  }

  it("TV pareada: paired true e atualiza last_seen_at", async () => {
    const s = setup({ rows: [await paired()] });
    expect(await checkTv(s.deps, "forno", SECRET_A)).toEqual({ ok: true, paired: true, simple: false });
    expect(s.tvs[0].last_seen_at).toBe(iso(now));
    expect(s.calls.update).toHaveLength(1);
  });

  it("TV pareada recebe o modo simples do painel; a pendente não recebe nada da casa", async () => {
    const s = setup({ rows: [await paired()], head: head({ tv_simple: true }) });
    expect(await checkTv(s.deps, "forno", SECRET_A)).toEqual({ ok: true, paired: true, simple: true });
    const row = tv(1, { secret_hash: await sha256Hex(SECRET_A), pair_code: "K7M3QX", pair_expires_at: noco(now + 5 * MIN) });
    const p = setup({ rows: [row], head: head({ tv_simple: true }) });
    expect(await checkTv(p.deps, "forno", SECRET_A)).toEqual({ ok: true, paired: false });
  });

  it("TV pendente: paired false, sem gravar nada", async () => {
    const row = tv(1, { secret_hash: await sha256Hex(SECRET_A), pair_code: "K7M3QX", pair_expires_at: noco(now + 5 * MIN) });
    const s = setup({ rows: [row] });
    expect(await checkTv(s.deps, "forno", SECRET_A)).toEqual({ ok: true, paired: false });
    expect(s.calls.update).toHaveLength(0);
  });

  it("mutação: segredo cujo hash é de uma TV de outro restaurante dá 401 e não toca na linha dela", async () => {
    const theirs = await paired({ restaurant_id: R2 });
    const s = setup({ rows: [theirs] });
    expect(await checkTv(s.deps, "forno", SECRET_A)).toEqual({ ok: false, status: 401 });
    expect(s.calls.update).toHaveLength(0);
    expect(s.tvs[0].last_seen_at).toBe(theirs.last_seen_at);
    // No restaurante dela, o mesmo segredo entra.
    expect(await checkTv(s.deps, "outro", SECRET_A)).toEqual({ ok: true, paired: true, simple: false });
  });

  it("TV revogada dá 401, mesmo com outra linha pareada do mesmo segredo", async () => {
    const s = setup({ rows: [await paired({ revoked: true })] });
    expect(await checkTv(s.deps, "forno", SECRET_A)).toEqual({ ok: false, status: 401 });
    const both = setup({ rows: [await paired({ revoked: true }), { ...(await paired()), id: U(777) }] });
    expect(await checkTv(both.deps, "forno", SECRET_A)).toEqual({ ok: false, status: 401 });
    expect(s.calls.update.length + both.calls.update.length).toBe(0);
  });

  it("mutação: o hash no lugar do segredo dá 401 (só quem tem o segredo entra)", async () => {
    const s = setup({ rows: [await paired()] });
    expect(await checkTv(s.deps, "forno", await sha256Hex(SECRET_A))).toEqual({ ok: false, status: 401 });
    expect(s.calls.update).toHaveLength(0);
  });

  it("segredo ausente, malformado ou desconhecido dá 401", async () => {
    const s = setup({ rows: [await paired()] });
    for (const secret of [null, "", "abc", SECRET_A.toUpperCase(), SECRET_A + "0", SECRET_B]) {
      expect(await checkTv(s.deps, "forno", secret)).toEqual({ ok: false, status: 401 });
    }
    expect(s.calls.update).toHaveLength(0);
  });

  it("slug inexistente dá 404, sem gravar", async () => {
    const rows = [await paired()];
    const s = setup({ rows });
    expect(await checkTv(s.deps, "nada", SECRET_A)).toEqual({ ok: false, status: 404 });
    expect(s.calls.update.length).toBe(0);
  });
});

describe("pareamento de ponta a ponta", () => {
  it("a TV pede o código com o hash, o painel confirma e a TV entra com o segredo", async () => {
    const s = setup({ codes: ["K7M3QX"] });
    const r = await requestPairCode(s.deps, "forno", { hash: await sha256Hex(SECRET_C) });
    expect(r).toMatchObject({ ok: true, code: "K7M3QX" });
    expect(await checkTv(s.deps, "forno", SECRET_C)).toEqual({ ok: true, paired: false });
    // Quem só leu o código na tela não tem o segredo.
    expect(await checkTv(s.deps, "forno", SECRET_A)).toEqual({ ok: false, status: 401 });
    expect(await confirmPair(s.deps, R1, "K7M3QX", "Salão")).toEqual({ ok: true });
    expect(await checkTv(s.deps, "forno", SECRET_C)).toEqual({ ok: true, paired: true, simple: false });
    // O banco só guarda o hash: o segredo não aparece em nenhuma coluna.
    expect(JSON.stringify(s.tvs)).not.toContain(SECRET_C);
  });
});
