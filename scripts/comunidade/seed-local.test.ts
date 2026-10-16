import { describe, expect, it } from "vitest";
import { SEED_IDS, assertLocalNocodb, buildSeed, localFileUrl } from "./seed-local.mjs";

// O seed só pode mexer no NocoDB do Docker: qualquer outro endereço é recusado antes de
// qualquer chamada. As linhas têm uids fixos, então rodar de novo atualiza em vez de duplicar.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NOW = new Date("2026-10-16T21:30:20.456Z");
const RID = "3a5d9359-aa1a-4065-996a-2105d88a802f";
const items = [
  { uid: "i-burger", name: "burger two" },
  { uid: "i-calabresa", name: "Calabresa" },
  { uid: "i-valhala", name: "Valhala" },
  { uid: "i-outro", name: "teted" },
];

describe("assertLocalNocodb", () => {
  it("aceita só http://localhost (com ou sem porta)", () => {
    expect(assertLocalNocodb("http://localhost:8080")).toBe("http://localhost:8080");
    expect(assertLocalNocodb("http://localhost:8080/")).toBe("http://localhost:8080");
    expect(assertLocalNocodb("http://localhost")).toBe("http://localhost");
  });
  it("recusa a nuvem, https, outro host, usuário no endereço e vazio", () => {
    for (const bad of [
      undefined,
      "",
      "https://app.nocodb.com",
      "https://localhost:8080",
      "http://127.0.0.1:8080",
      "http://localhost.exemplo.com",
      "http://localhost@exemplo.com",
      "http://exemplo.com/?h=localhost",
      "localhost:8080",
    ]) {
      expect(() => assertLocalNocodb(bad), String(bad)).toThrow();
    }
  });
});

describe("buildSeed", () => {
  const seed = buildSeed({ rid: RID, items, now: NOW, minutes: 30 });

  it("uids fixos e válidos (rodar de novo não duplica)", () => {
    const ids = [...seed.polls.map((p) => p.uid), ...seed.posts.map((p) => p.uid)];
    expect(new Set(ids).size).toBe(5);
    for (const id of ids) expect(id).toMatch(UUID);
    expect(seed.polls.map((p) => p.uid)).toEqual([SEED_IDS.pollOpen, SEED_IDS.pollNext]);
    expect(buildSeed({ rid: RID, items, now: new Date(NOW.getTime() + 3_600_000), minutes: 10 }).posts.map((p) => p.uid)).toEqual(
      seed.posts.map((p) => p.uid),
    );
  });

  it("uma enquete aberta agora, com 3 opções ligadas a pratos do cardápio", () => {
    const open = seed.polls[0];
    expect(open.restaurant_id).toBe(RID);
    expect(Date.parse(open.starts_at)).toBeLessThanOrEqual(NOW.getTime());
    expect(Date.parse(open.ends_at)).toBe(Date.parse(open.starts_at) + 31 * 60_000);
    expect(open.closed_at).toBeNull();
    expect(open.options.map((o) => o.id)).toEqual(["a", "b", "c"]);
    expect(open.options.map((o) => o.item_id)).toEqual(["i-burger", "i-calabresa", "i-valhala"]);
  });

  it("uma agendada para daqui a 1 h", () => {
    const next = seed.polls[1];
    expect(Date.parse(next.starts_at) - NOW.getTime()).toBeGreaterThanOrEqual(59 * 60_000);
    expect(Date.parse(next.starts_at) - NOW.getTime()).toBeLessThanOrEqual(60 * 60_000);
    expect(Date.parse(next.ends_at)).toBeGreaterThan(Date.parse(next.starts_at));
    expect(next.options.length).toBeGreaterThanOrEqual(2);
  });

  it("3 posts da casa aprovados, ligados a pratos, com foto e miniatura locais do restaurante", () => {
    expect(seed.posts).toHaveLength(3);
    for (const p of seed.posts) {
      expect(p).toMatchObject({ restaurant_id: RID, source: "house", status: "approved", hidden_at: null });
      expect(items.map((i) => i.uid)).toContain(p.item_id);
      expect(p.photo_path.startsWith(`/api/arquivos-locais/${RID}/comunidade/`)).toBe(true);
      expect(p.thumb_path.startsWith(`/api/arquivos-locais/${RID}/comunidade/`)).toBe(true);
    }
    // Mais novo primeiro, horários diferentes (a paginação usa created_at).
    const times = seed.posts.map((p) => Date.parse(p.created_at));
    expect(new Set(times).size).toBe(3);
  });

  it("datas em segundos inteiros (o NocoDB perde os milissegundos)", () => {
    for (const p of seed.polls) for (const d of [p.starts_at, p.ends_at, p.created_at]) expect(d).toMatch(/:\d\dZ$/);
    for (const p of seed.posts) expect(p.created_at).toMatch(/:\d\dZ$/);
  });

  it("sem os pratos pelo nome, usa outros pratos do cardápio", () => {
    const other = buildSeed({ rid: RID, items: [{ uid: "x1", name: "a" }, { uid: "x2", name: "b" }, { uid: "x3", name: "c" }], now: NOW, minutes: 30 });
    expect(other.polls[0].options.map((o) => o.item_id)).toEqual(["x1", "x2", "x3"]);
    expect(() => buildSeed({ rid: RID, items: [{ uid: "x1", name: "a" }], now: NOW, minutes: 30 })).toThrow();
  });
});

describe("localFileUrl", () => {
  it("monta a URL do driver local com cada pedaço codificado", () => {
    expect(localFileUrl(`${RID}/comunidade/seed 1.webp`)).toBe(`/api/arquivos-locais/${RID}/comunidade/seed%201.webp`);
  });
});
