import { describe, expect, it } from "vitest";
import type { QueueResult } from "@/app/painel/apareca/actions";
import type { QueueItem } from "@/lib/apareca/panel-logic";
import type { PollRow } from "@/lib/comunidade/types";
import { agoraFrom } from "./agora";

const RID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-17T22:00:00Z");
const min = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString();

const poll = (id: string, from: number, to: number, extra: Partial<PollRow> = {}): PollRow => ({
  id,
  restaurant_id: RID,
  template: "dessert",
  question: `Pergunta ${id}`,
  options: [
    { id: "a", label: "A", item_id: null },
    { id: "b", label: "B", item_id: null },
  ],
  starts_at: min(from),
  ends_at: min(to),
  closed_at: null,
  created_at: min(from),
  ...extra,
});

const item = (id: string, status: QueueItem["status"]): QueueItem => ({
  id, name: null, table_label: null, zone: null, status, hls: null, poster: null, created_at: min(-5), plays: 0, plays_target: 1,
});
const QUEUE: QueueResult = { items: [item("v1", "pending"), item("v2", "approved")], newest: min(-5), warn: "warn" };

const tv = (id: string, extra: Record<string, unknown> = {}) => ({
  id, restaurant_id: RID, label: `TV ${id}`, paired_at: "2026-10-10 20:00:00+00:00", last_seen_at: min(-2), revoked: false, ...extra,
});

const base = { queue: QUEUE, pollRows: [] as PollRow[], tvRows: [] as Record<string, unknown>[], now: NOW, communityOn: true, aparecaAllowed: true, restaurantId: RID };

describe("agoraFrom", () => {
  it("escolhe a enquete que está no ar", () => {
    const r = agoraFrom({ ...base, pollRows: [poll("agendada", 30, 40), poll("no-ar", -5, 10), poll("velha", -60, -50)] });
    expect(r.poll).toEqual({ id: "no-ar", question: "Qual sobremesa sai hoje?", votes: null, endsAt: min(10) });
    // Personalizada: a pergunta escrita pela casa.
    expect(agoraFrom({ ...base, pollRows: [poll("p", -5, 10, { template: "custom" })] }).poll?.question).toBe("Pergunta p");
  });

  it("ignora a agendada e a encerrada (pelo relógio ou pelo Encerrar)", () => {
    const r = agoraFrom({ ...base, pollRows: [poll("agendada", 30, 40), poll("acabou", -60, -50), poll("fechada", -5, 10, { closed_at: min(-1) })] });
    expect(r.poll).toBeNull();
  });

  it("sem resultado guardado, votes fica null (a tela não mostra o número)", () => {
    expect(agoraFrom({ ...base, pollRows: [poll("p", -5, 10)] }).poll?.votes).toBeNull();
    // Resultado só com porcentagens não diz quantos votaram: continua null; sem voto nenhum, 0.
    const pct = { has_votes: true, winner: "a", a: 60, b: 40 } as PollRow["result"];
    expect(agoraFrom({ ...base, pollRows: [poll("p", -5, 10, { result: pct })] }).poll?.votes).toBeNull();
    const none = { has_votes: false, winner: null, a: 0, b: 0 } as PollRow["result"];
    expect(agoraFrom({ ...base, pollRows: [poll("p", -5, 10, { result: none })] }).poll?.votes).toBe(0);
  });

  it("enquete de outro restaurante não entra", () => {
    const r = agoraFrom({ ...base, pollRows: [poll("outra", -5, 10, { restaurant_id: "22222222-2222-4222-8222-222222222222" })] });
    expect(r.poll).toBeNull();
  });

  it("TVs: só as conectadas e não desconectadas, com o estado", () => {
    const r = agoraFrom({
      ...base,
      tvRows: [
        tv("ok"),
        tv("revogada", { revoked: true }),
        tv("sem-par", { paired_at: null }),
        tv("muda", { last_seen_at: min(-30) }),
        tv("alheia", { restaurant_id: "22222222-2222-4222-8222-222222222222" }),
      ],
    });
    expect(r.tvs.map((t) => t.id).sort()).toEqual(["muda", "ok"]);
    expect(r.tvs.find((t) => t.id === "ok")).toEqual({ id: "ok", label: "TV ok", status: { on: true, text: "ligada" } });
    expect(r.tvs.find((t) => t.id === "muda")!.status).toEqual({ on: false, text: "sem sinal há 30 min" });
  });

  it("Apareça não liberado: fila vazia", () => {
    const r = agoraFrom({ ...base, aparecaAllowed: false });
    expect(r.queue).toEqual({ items: [], newest: null, warn: "ok" });
    expect(r.aparecaAllowed).toBe(false);
  });

  it("Apareça liberado: a fila passa como veio, com os interruptores", () => {
    const r = agoraFrom({ ...base, communityOn: false });
    expect(r.queue).toBe(QUEUE);
    expect(r.communityOn).toBe(false);
    expect(r.aparecaAllowed).toBe(true);
  });
});
