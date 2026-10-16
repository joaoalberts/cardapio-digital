import { describe, expect, it } from "vitest";
import type { PollRow } from "@/lib/comunidade/types";
import { inCommunityFolder, pollOverlap, suggestOptions, validatePoll, type PollInput } from "./validate";

const TZ = "America/Sao_Paulo";
// 19h00 em São Paulo (UTC−3).
const NOW = new Date("2026-10-16T22:00:00Z");
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";
const OUT = "99999999-9999-4999-8999-999999999999";
const MENU = new Set([A, B, C, D]);

const ok: PollInput = {
  template: "dessert",
  question: "",
  options: [
    { label: "Pudim", item_id: A },
    { label: "Torta de limão", item_id: B },
  ],
  start: null,
  minutes: 10,
};
const run = (over: Partial<PollInput>, now = NOW) => validatePoll({ ...ok, ...over }, MENU, now, TZ);
const err = (over: Partial<PollInput>, now = NOW) => {
  const r = run(over, now);
  return r.ok ? null : r.error;
};

describe("validatePoll", () => {
  it("2 ou 3 opções: 1 e 4 dão erro", () => {
    expect(err({ options: [{ label: "", item_id: A }] })).toBe("Escolha 2 ou 3 opções.");
    expect(
      err({
        options: [
          { label: "", item_id: A },
          { label: "", item_id: B },
          { label: "", item_id: C },
          { label: "", item_id: D },
        ],
      }),
    ).toBe("Escolha 2 ou 3 opções.");
    expect(err({ options: "x" as unknown as PollInput["options"] })).toBe("Escolha 2 ou 3 opções.");
  });

  it("3 opções valem e ganham os ids a, b e c", () => {
    const r = run({ options: [{ label: "", item_id: A }, { label: "", item_id: B }, { label: "Bolo", item_id: null }] });
    expect(r.ok && r.row.options.map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  it("prato fora do cardápio dá erro", () => {
    expect(err({ options: [{ label: "", item_id: A }, { label: "", item_id: OUT }] })).toBe("Escolha um prato que está no cardápio.");
    expect(err({ options: [{ label: "", item_id: A }, { label: "", item_id: "x" }] })).toBe("Escolha um prato que está no cardápio.");
  });

  it("o mesmo prato em duas opções dá erro", () => {
    expect(err({ options: [{ label: "", item_id: A }, { label: "", item_id: A }] })).toBe("Escolha opções diferentes.");
    expect(err({ options: [{ label: "Rock", item_id: null }, { label: " rock ", item_id: null }] })).toBe("Escolha opções diferentes.");
  });

  it("opção em texto: de 1 a 40 caracteres", () => {
    const msg = "Cada opção precisa de um prato ou de um texto de até 40 caracteres.";
    expect(err({ options: [{ label: "", item_id: A }, { label: "   ", item_id: null }] })).toBe(msg);
    expect(err({ options: [{ label: "", item_id: A }, { label: "x".repeat(41), item_id: null }] })).toBe(msg);
    expect(err({ options: [{ label: "", item_id: A }, { label: "x".repeat(40), item_id: null }] })).toBeNull();
  });

  it("início 1 h atrás dá erro; 1 min atrás ainda vale (tolerância)", () => {
    const msg = "Esse horário já passou. Escolha agora ou uma hora mais tarde hoje.";
    expect(err({ start: "18:00" })).toBe(msg);
    expect(err({ start: "18:58" }, new Date("2026-10-16T22:00:30Z"))).toBe(msg);
    expect(err({ start: "18:59" })).toBeNull();
  });

  it("início malformado dá erro", () => {
    expect(err({ start: "25:00" })).toBe("Confira a hora de início.");
    expect(err({ start: "8h" })).toBe("Confira a hora de início.");
  });

  it("duração só 5, 10, 15 ou 30 min: 7 dá erro", () => {
    const msg = "A enquete dura 5, 10, 15 ou 30 minutos.";
    expect(err({ minutes: 7 as PollInput["minutes"] })).toBe(msg);
    expect(err({ minutes: "10" as unknown as PollInput["minutes"] })).toBe(msg);
    for (const m of [5, 10, 15, 30] as const) expect(err({ minutes: m })).toBeNull();
  });

  it("modelo desconhecido dá erro", () => {
    expect(err({ template: "pizza" as PollInput["template"] })).toBe("Escolha um modelo de enquete.");
  });

  it("modelo válido gera starts_at e ends_at em UTC no fuso de São Paulo", () => {
    const r = run({ start: "20:30", minutes: 15 });
    expect(r).toEqual({
      ok: true,
      row: {
        template: "dessert",
        question: "Qual sobremesa sai hoje?",
        options: [
          { id: "a", label: "Pudim", item_id: A },
          { id: "b", label: "Torta de limão", item_id: B },
        ],
        starts_at: "2026-10-16T23:30:00.000Z",
        ends_at: "2026-10-16T23:45:00.000Z",
      },
    });
  });

  it("sem início = agora, em segundos inteiros", () => {
    const r = run({ start: null, minutes: 5 }, new Date("2026-10-16T22:00:07.250Z"));
    expect(r.ok && [r.row.starts_at, r.row.ends_at]).toEqual(["2026-10-16T22:00:07.000Z", "2026-10-16T22:05:07.000Z"]);
  });

  it("hoje é o dia do calendário no fuso, não o do UTC", () => {
    // 22h30 em São Paulo já é dia 17 em UTC: "23:00" é hoje, dia 16, às 23h local.
    const r = run({ start: "23:00" }, new Date("2026-10-17T01:30:00Z"));
    expect(r.ok && r.row.starts_at).toBe("2026-10-17T02:00:00.000Z");
  });

  it("nos modelos a pergunta é a do modelo; a enviada é ignorada", () => {
    const drink = run({ template: "drink", question: "outra coisa" });
    expect(drink.ok && drink.row.question).toBe("Qual drink sai hoje?");
    const music = run({ template: "music", question: "" });
    expect(music.ok && music.row.question).toBe("Qual a próxima música?");
  });

  it("personalizada: pergunta da casa de 3 a 90 caracteres", () => {
    const msg = "Escreva a pergunta com 3 a 90 caracteres.";
    expect(err({ template: "custom", question: " oi " })).toBe(msg);
    expect(err({ template: "custom", question: "x".repeat(91) })).toBe(msg);
    const r = run({ template: "custom", question: "  Qual prato sai primeiro?  " });
    expect(r.ok && r.row.question).toBe("Qual prato sai primeiro?");
  });

  it("opção ligada a prato guarda o nome como reserva (até 40) e texto vira só texto", () => {
    const r = run({ options: [{ label: "  Pudim da vó  ", item_id: A }, { label: "Samba", item_id: null }] });
    expect(r.ok && r.row.options).toEqual([
      { id: "a", label: "Pudim da vó", item_id: A },
      { id: "b", label: "Samba", item_id: null },
    ]);
    const long = run({ options: [{ label: "y".repeat(60), item_id: A }, { label: "", item_id: B }] });
    expect(long.ok && long.row.options[0].label).toBe("y".repeat(40));
  });
});

const poll = (over: Partial<PollRow>): PollRow => ({
  id: "p1",
  restaurant_id: "r1",
  template: "dessert",
  question: "Qual sobremesa sai hoje?",
  options: [],
  starts_at: "2026-10-16T22:00:00.000Z",
  ends_at: "2026-10-16T22:10:00.000Z",
  closed_at: null,
  created_at: "2026-10-16T21:00:00.000Z",
  ...over,
});

describe("pollOverlap", () => {
  const row = { starts_at: "2026-10-16T22:05:00.000Z", ends_at: "2026-10-16T22:15:00.000Z" };
  it("cruza com uma aberta ou agendada", () => {
    expect(pollOverlap(row, [poll({})], NOW)).toBe(true);
    expect(pollOverlap(row, [poll({ starts_at: "2026-10-16T22:14:00.000Z", ends_at: "2026-10-16T22:20:00.000Z" })], NOW)).toBe(true);
  });
  it("encostar no fim não cruza", () => {
    expect(pollOverlap(row, [poll({ starts_at: "2026-10-16T21:55:00.000Z", ends_at: "2026-10-16T22:05:00.000Z" })], NOW)).toBe(false);
    expect(pollOverlap(row, [poll({ starts_at: "2026-10-16T22:15:00.000Z", ends_at: "2026-10-16T22:25:00.000Z" })], NOW)).toBe(false);
  });
  it("encerrada pela casa não ocupa o horário", () => {
    expect(pollOverlap(row, [poll({ closed_at: "2026-10-16T22:01:00.000Z" })], NOW)).toBe(false);
  });
});

describe("inCommunityFolder", () => {
  const R = "00000000-0000-4000-8000-000000000001";
  it("aceita a pasta comunidade do restaurante (Blob e driver local)", () => {
    expect(inCommunityFolder(R, `https://abc123.public.blob.vercel-storage.com/${R}/comunidade/x-full.webp`)).toBe(true);
    expect(inCommunityFolder(R, `/api/arquivos-locais/${R}/comunidade/x-thumb.webp`)).toBe(true);
  });
  it("recusa outra pasta, outro restaurante e caminho com ..", () => {
    expect(inCommunityFolder(R, `/api/arquivos-locais/${R}/items/x.webp`)).toBe(false);
    expect(inCommunityFolder(R, `/api/arquivos-locais/00000000-0000-4000-8000-000000000002/comunidade/x.webp`)).toBe(false);
    expect(inCommunityFolder(R, `/api/arquivos-locais/${R}/comunidade/../items/x.webp`)).toBe(false);
    expect(inCommunityFolder(R, `/api/arquivos-locais/${R}/comunidade/`)).toBe(false);
    expect(inCommunityFolder(R, 42 as unknown as string)).toBe(false);
  });
});

describe("suggestOptions", () => {
  const cats = [
    { name: "Hambúrgueres", items: [{ id: A, name: "Burger" }] },
    { name: "Sobremesas", items: [{ id: B, name: "Pudim" }, { id: C, name: "Torta" }, { id: D, name: "Brownie" }, { id: OUT, name: "Mousse" }] },
    { name: "Bebidas e drinks", items: [{ id: C, name: "Chopp" }] },
  ];
  it("sobremesa e drink já vêm com os pratos da categoria que combina (até 3)", () => {
    expect(suggestOptions("dessert", cats)).toEqual([
      { label: "Pudim", item_id: B },
      { label: "Torta", item_id: C },
      { label: "Brownie", item_id: D },
    ]);
    expect(suggestOptions("drink", cats)).toEqual([
      { label: "Chopp", item_id: C },
      { label: "", item_id: null },
    ]);
  });
  it("música, personalizada ou sem categoria que combine: 2 opções vazias", () => {
    const empty = [
      { label: "", item_id: null },
      { label: "", item_id: null },
    ];
    expect(suggestOptions("music", cats)).toEqual(empty);
    expect(suggestOptions("custom", cats)).toEqual(empty);
    expect(suggestOptions("dessert", [cats[0]])).toEqual(empty);
  });
});
