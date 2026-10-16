import { describe, expect, it } from "vitest";
import { VOTE_CAP_PER_RESTAURANT, VOTE_CAP_PER_TABLE, effectiveVotes, percentages } from "./tally";
import type { OptionId, VoteRow } from "./types";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let seq = 0;
const vote = (device: string, table: string, option: OptionId, poll = "p1"): VoteRow => ({
  id: U(9000 + ++seq),
  restaurant_id: "r1",
  poll_id: poll,
  option_id: option,
  device_id: device,
  table_id: table,
  created_at: new Date(1_800_000_000_000 + seq * 1000).toISOString(),
});
const opts = (...counts: number[]): VoteRow[] => {
  const ids: OptionId[] = ["a", "b", "c"];
  const out: VoteRow[] = [];
  let d = 0;
  counts.forEach((n, i) => {
    for (let k = 0; k < n; k++) out.push(vote(U(++d), U(500 + d), ids[i]));
  });
  return out;
};

describe("effectiveVotes", () => {
  it("tetos padrão: 8 por mesa e 400 por restaurante, por enquete", () => {
    expect(VOTE_CAP_PER_TABLE).toBe(8);
    expect(VOTE_CAP_PER_RESTAURANT).toBe(400);
  });
  it("device repetido conta 1 (o primeiro)", () => {
    const first = vote(U(1), U(100), "a");
    const again = vote(U(1), U(100), "b");
    const other = vote(U(2), U(100), "b");
    const eff = effectiveVotes([first, again, other]);
    expect(eff.map((v) => v.id)).toEqual([first.id, other.id]);
    expect(eff[0].option_id).toBe("a");
  });
  it("9 votos da mesma mesa: valem os 8 primeiros", () => {
    const vs = Array.from({ length: 9 }, (_, i) => vote(U(i + 1), U(100), "a"));
    const eff = effectiveVotes(vs);
    expect(eff).toHaveLength(8);
    expect(eff.map((v) => v.id)).toEqual(vs.slice(0, 8).map((v) => v.id));
  });
  it("401 votos da mesma enquete: valem os 400 primeiros", () => {
    const vs = Array.from({ length: 401 }, (_, i) => vote(U(i + 1), U(1000 + Math.floor(i / 8)), "a"));
    const eff = effectiveVotes(vs);
    expect(eff).toHaveLength(400);
    expect(eff.at(-1)?.id).toBe(vs[399].id);
  });
  it("o voto repetido não gasta o teto da mesa", () => {
    const vs = [vote(U(1), U(100), "a"), vote(U(1), U(100), "a"), ...Array.from({ length: 7 }, (_, i) => vote(U(i + 2), U(100), "b"))];
    expect(effectiveVotes(vs)).toHaveLength(8);
  });
  it("tetos são por enquete", () => {
    const p1 = Array.from({ length: 8 }, (_, i) => vote(U(i + 1), U(100), "a", "p1"));
    const p2 = Array.from({ length: 8 }, (_, i) => vote(U(i + 1), U(100), "a", "p2"));
    expect(effectiveVotes([...p1, ...p2])).toHaveLength(16);
  });
  it("aceita tetos injetados", () => {
    const vs = Array.from({ length: 5 }, (_, i) => vote(U(i + 1), U(100 + i), "a"));
    expect(effectiveVotes(vs, { perTable: 8, perRestaurant: 3 })).toHaveLength(3);
  });
});

describe("percentages (maior resto)", () => {
  it("[2,1,0] votos dão 67, 33 e 0", () => {
    expect(percentages(opts(2, 1, 0), ["a", "b", "c"])).toEqual({ a: 67, b: 33, c: 0 });
  });
  it("[1,1,1] somam 100 (34, 33, 33)", () => {
    const p = percentages(opts(1, 1, 1), ["a", "b", "c"]);
    expect(p).toEqual({ a: 34, b: 33, c: 33 });
    expect(p.a + p.b + p.c).toBe(100);
  });
  it("sem votos, tudo 0", () => {
    expect(percentages([], ["a", "b", "c"])).toEqual({ a: 0, b: 0, c: 0 });
  });
  it("duas opções", () => {
    expect(percentages(opts(1, 2), ["a", "b"])).toEqual({ a: 33, b: 67 });
  });
  it("sempre soma 100 com votos", () => {
    for (const c of [[1, 0, 0], [3, 3, 1], [7, 5, 2], [1, 1, 5], [13, 29, 41]]) {
      const p = percentages(opts(...c), ["a", "b", "c"]);
      expect(p.a + p.b + p.c).toBe(100);
    }
  });
  it("ignora voto em opção que a enquete não tem", () => {
    expect(percentages(opts(1, 1, 2), ["a", "b"])).toEqual({ a: 50, b: 50 });
  });
});
