import { describe, expect, it } from "vitest";
import { CLOSED_POLL_LINGER_MS, DAY_START_DEFAULT, communityDay, currentPoll, dayBounds, nextPoll, lastCron, pollPhase, voteCutoff } from "./clock";
import type { PollRow } from "./types";

const TZ = "America/Sao_Paulo";
const MIN = 60_000;
const T0 = new Date("2026-10-16T23:00:00Z"); // sexta, 20:00 em São Paulo

const iso = (ms: number) => new Date(ms).toISOString();
const poll = (id: string, startMs: number, endMs: number, over: Partial<PollRow> = {}): PollRow => ({
  id,
  restaurant_id: "r1",
  template: "dessert",
  question: "Qual sobremesa sai hoje?",
  options: [
    { id: "a", label: "Petit gâteau", item_id: null },
    { id: "b", label: "Pudim", item_id: null },
  ],
  starts_at: iso(startMs),
  ends_at: iso(endMs),
  closed_at: null,
  created_at: iso(startMs - 60 * MIN),
  ...over,
});

describe("communityDay (Foco 4: fuso e virada do dia)", () => {
  it("23h50 em São Paulo ainda é o dia que começou às 05:00", () => {
    expect(communityDay(new Date("2026-10-17T02:50:00Z"), TZ, "05:00")).toBe("2026-10-16");
  });
  it("01h00 da madrugada seguinte cai no mesmo dia da enquete das 23h50", () => {
    expect(communityDay(new Date("2026-10-17T04:00:00Z"), TZ, "05:00")).toBe("2026-10-16");
  });
  it("depois das 05:00 já é o dia seguinte", () => {
    expect(communityDay(new Date("2026-10-17T08:30:00Z"), TZ, "05:00")).toBe("2026-10-17");
  });
  it("exatamente na hora da virada já é o dia novo", () => {
    expect(communityDay(new Date("2026-10-17T08:00:00Z"), TZ, "05:00")).toBe("2026-10-17");
    expect(communityDay(new Date("2026-10-17T07:59:00Z"), TZ, "05:00")).toBe("2026-10-16");
  });
  it("virada do mês e do ano", () => {
    expect(communityDay(new Date("2026-11-01T04:00:00Z"), TZ, "05:00")).toBe("2026-10-31");
    expect(communityDay(new Date("2027-01-01T04:00:00Z"), TZ, "05:00")).toBe("2026-12-31");
  });
  it("usa o fuso do restaurante, não o do servidor", () => {
    // 2026-10-17T02:50Z é 03:50 em Lisboa (WEST, UTC+1): antes das 05:00, ainda dia 16.
    expect(communityDay(new Date("2026-10-17T02:50:00Z"), "Europe/Lisbon", "05:00")).toBe("2026-10-16");
    // 04:30Z é 05:30 em Lisboa: dia 17. Em São Paulo é 01:30: dia 16.
    expect(communityDay(new Date("2026-10-17T04:30:00Z"), "Europe/Lisbon", "05:00")).toBe("2026-10-17");
    expect(communityDay(new Date("2026-10-17T04:30:00Z"), TZ, "05:00")).toBe("2026-10-16");
  });
  it("day_start vazio ou malformado usa o padrão 05:00", () => {
    expect(DAY_START_DEFAULT).toBe("05:00");
    expect(communityDay(new Date("2026-10-17T04:00:00Z"), TZ, "")).toBe("2026-10-16");
    expect(communityDay(new Date("2026-10-17T04:00:00Z"), TZ, "25:99")).toBe("2026-10-16");
  });
  it("day_start 00:00 é o dia do calendário", () => {
    expect(communityDay(new Date("2026-10-17T04:00:00Z"), TZ, "00:00")).toBe("2026-10-17");
  });
});

describe("dayBounds", () => {
  it("dia de São Paulo das 05:00 às 05:00, em UTC", () => {
    const b = dayBounds("2026-10-16", TZ, "05:00");
    expect(b.from.toISOString()).toBe("2026-10-16T08:00:00.000Z");
    expect(b.to.toISOString()).toBe("2026-10-17T08:00:00.000Z");
  });
  it("a enquete das 23h50 e o placar da 01h00 ficam dentro do mesmo dia", () => {
    const b = dayBounds(communityDay(new Date("2026-10-17T04:00:00Z"), TZ, "05:00"), TZ, "05:00");
    for (const t of ["2026-10-17T02:50:00Z", "2026-10-17T04:00:00Z"]) {
      const ms = Date.parse(t);
      expect(ms >= b.from.getTime() && ms < b.to.getTime()).toBe(true);
    }
  });
  it("respeita a troca de horário de verão (Nova York, 01/11/2026 tem 25 h)", () => {
    const b = dayBounds("2026-10-31", "America/New_York", "05:00");
    expect(b.from.toISOString()).toBe("2026-10-31T09:00:00.000Z"); // 05:00 EDT
    expect(b.to.toISOString()).toBe("2026-11-01T10:00:00.000Z"); // 05:00 EST
  });
  it("communityDay de qualquer instante cai dentro do seu dayBounds", () => {
    for (let h = 0; h < 48; h += 1.5) {
      const now = new Date(Date.parse("2026-10-16T00:00:00Z") + h * 60 * MIN);
      const b = dayBounds(communityDay(now, TZ, "05:00"), TZ, "05:00");
      expect(now.getTime() >= b.from.getTime() && now.getTime() < b.to.getTime()).toBe(true);
    }
  });
  it("dia malformado lança erro", () => {
    expect(() => dayBounds("16/10/2026", TZ, "05:00")).toThrow();
  });
});

describe("pollPhase", () => {
  const p = poll("p1", T0.getTime(), T0.getTime() + 10 * MIN);
  it("antes de starts_at = scheduled", () => {
    expect(pollPhase(p, new Date(T0.getTime() - 1))).toBe("scheduled");
  });
  it("em starts_at = open", () => {
    expect(pollPhase(p, T0)).toBe("open");
  });
  it("um instante antes de ends_at ainda é open", () => {
    expect(pollPhase(p, new Date(T0.getTime() + 10 * MIN - 1))).toBe("open");
  });
  it("em ends_at = closed", () => {
    expect(pollPhase(p, new Date(T0.getTime() + 10 * MIN))).toBe("closed");
  });
  it("closed_at no passado = closed, mesmo antes de ends_at", () => {
    const c = { ...p, closed_at: iso(T0.getTime() + 2 * MIN) };
    expect(pollPhase(c, new Date(T0.getTime() + 3 * MIN))).toBe("closed");
  });
  it("datas inválidas nunca abrem a enquete", () => {
    expect(pollPhase({ ...p, starts_at: "lixo" }, T0)).toBe("closed");
    expect(pollPhase({ ...p, ends_at: "" }, T0)).toBe("closed");
  });
});

describe("currentPoll", () => {
  const now = T0.getTime();
  it("devolve a aberta", () => {
    const open = poll("aberta", now - 5 * MIN, now + 5 * MIN);
    const later = poll("agendada", now + 30 * MIN, now + 40 * MIN);
    expect(currentPoll([later, open], T0)?.id).toBe("aberta");
  });
  it("com duas abertas, a de starts_at mais recente", () => {
    const a = poll("velha", now - 9 * MIN, now + 5 * MIN);
    const b = poll("nova", now - 2 * MIN, now + 5 * MIN);
    expect(currentPoll([b, a], T0)?.id).toBe("nova");
    expect(currentPoll([a, b], T0)?.id).toBe("nova");
  });
  it("a aberta vence a encerrada há pouco", () => {
    const closed = poll("encerrada", now - 20 * MIN, now - 1 * MIN);
    const open = poll("aberta", now - 1 * MIN, now + 5 * MIN);
    expect(currentPoll([closed, open], T0)?.id).toBe("aberta");
  });
  it("devolve a encerrada há 14 min", () => {
    const closed = poll("encerrada", now - 30 * MIN, now - 14 * MIN);
    expect(currentPoll([closed], T0)?.id).toBe("encerrada");
  });
  it("devolve null com a encerrada há 16 min", () => {
    const closed = poll("encerrada", now - 30 * MIN, now - 16 * MIN);
    expect(CLOSED_POLL_LINGER_MS).toBe(15 * MIN);
    expect(currentPoll([closed], T0)).toBeNull();
  });
  it("encerrada antes pela casa conta a partir de closed_at", () => {
    const early = poll("cedo", now - 30 * MIN, now + 30 * MIN, { closed_at: iso(now - 16 * MIN) });
    expect(currentPoll([early], T0)).toBeNull();
    const recent = poll("recente", now - 30 * MIN, now + 30 * MIN, { closed_at: iso(now - 14 * MIN) });
    expect(currentPoll([recent], T0)?.id).toBe("recente");
  });
  it("entre duas encerradas, a que encerrou por último", () => {
    const a = poll("a", now - 40 * MIN, now - 10 * MIN);
    const b = poll("b", now - 20 * MIN, now - 3 * MIN);
    expect(currentPoll([a, b], T0)?.id).toBe("b");
  });
  it("agendada cancelada antes de abrir não aparece como encerrada", () => {
    const cancelled = poll("cancelada", now + 10 * MIN, now + 20 * MIN, { closed_at: iso(now - 1 * MIN) });
    expect(currentPoll([cancelled], T0)).toBeNull();
  });
  it("sem enquetes, null", () => {
    expect(currentPoll([], T0)).toBeNull();
  });
});

describe("nextPoll", () => {
  const now = T0.getTime();
  it("a agendada mais próxima", () => {
    const a = poll("depois", now + 60 * MIN, now + 70 * MIN);
    const b = poll("logo", now + 10 * MIN, now + 20 * MIN);
    const open = poll("aberta", now - 1 * MIN, now + 5 * MIN);
    expect(nextPoll([a, open, b], T0)?.id).toBe("logo");
  });
  it("ignora a agendada cancelada pela casa", () => {
    const c = poll("cancelada", now + 10 * MIN, now + 20 * MIN, { closed_at: iso(now - 1 * MIN) });
    expect(nextPoll([c], T0)).toBeNull();
  });
  it("sem agendadas, null", () => {
    expect(nextPoll([poll("aberta", now - 1 * MIN, now + 5 * MIN)], T0)).toBeNull();
  });
});

describe("voteCutoff: até onde o cron apaga os votos", () => {
  const SP = "America/Sao_Paulo";
  const at = (s: string) => new Date(s);
  const cut = (now: string, tz: string, ds: string) => voteCutoff(at(now), tz, ds).toISOString();
  it("lastCron: a última rodada das 06h de São Paulo (09:00Z)", () => {
    expect(lastCron(at("2026-10-16T09:00:00Z")).toISOString()).toBe("2026-10-16T09:00:00.000Z");
    expect(lastCron(at("2026-10-16T08:59:59Z")).toISOString()).toBe("2026-10-15T09:00:00.000Z");
    expect(lastCron(at("2026-10-17T02:00:00Z")).toISOString()).toBe("2026-10-16T09:00:00.000Z");
  });
  it("dia já virado na hora do cron: a virada", () => {
    expect(cut("2026-10-16T09:00:00Z", SP, "05:00")).toBe("2026-10-16T08:00:00.000Z");
    expect(cut("2026-10-16T09:00:00Z", SP, "06:00")).toBe("2026-10-16T09:00:00.000Z");
    // Lisboa: o cron é às 10h de lá, o dia virou às 05h (04:00Z)
    expect(cut("2026-10-16T09:00:00Z", "Europe/Lisbon", "05:00")).toBe("2026-10-16T04:00:00.000Z");
  });
  it("day_start depois da hora do cron no fuso: o corte é a rodada (a noite acabou)", () => {
    expect(cut("2026-10-16T09:00:00Z", SP, "07:00")).toBe("2026-10-16T09:00:00.000Z");
    expect(cut("2026-10-16T09:00:00Z", SP, "12:00")).toBe("2026-10-16T09:00:00.000Z");
    // fusos a oeste: Manaus (cron às 05h de lá) e Rio Branco (04h de lá)
    expect(cut("2026-10-16T09:00:00Z", "America/Manaus", "07:00")).toBe("2026-10-16T09:00:00.000Z");
    expect(cut("2026-10-16T09:00:00Z", "America/Rio_Branco", "05:00")).toBe("2026-10-16T09:00:00.000Z");
  });
  it("entre rodadas, vale o corte da última (não o de agora)", () => {
    // 03:00 em São Paulo: a última rodada foi ontem às 06h
    expect(cut("2026-10-16T06:00:00Z", SP, "05:00")).toBe("2026-10-15T08:00:00.000Z");
    expect(cut("2026-10-16T06:00:00Z", SP, "07:00")).toBe("2026-10-15T09:00:00.000Z");
    // 15:00 com day_start 12:00: ainda o corte da rodada das 06h
    expect(cut("2026-10-16T18:00:00Z", SP, "12:00")).toBe("2026-10-16T09:00:00.000Z");
  });
});
