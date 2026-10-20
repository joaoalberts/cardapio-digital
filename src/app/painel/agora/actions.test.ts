// Leitura da tela Agora (loadAgora): confere o membro antes de qualquer leitura e divide a leitura num memo de 5 s,
// que as ações da fila e das TVs esquecem (forgetAgora).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const auth = vi.hoisted(() => ({ member: new Set<string>() }));
vi.mock("@/lib/auth", () => ({ isMember: vi.fn(async (rid: string) => auth.member.has(rid)) }));

// Banco falso: anota cada leitura (tabela) e devolve vazio; o restaurante vem sem a liberação do Apareça.
const reads = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/db/nocodb", () => ({
  first: vi.fn(async (t: string) => {
    reads.push(t);
    return { id: "rid", apareca_allowed: false };
  }),
  list: vi.fn(async (t: string) => {
    reads.push(t);
    return [];
  }),
}));
vi.mock("../apareca/actions", () => ({ listQueue: vi.fn(async () => ({ items: [], newest: null, warn: "ok" })) }));

import { forgetAgora } from "@/lib/painel/agora-memo";
import { loadAgora } from "./actions";

const RID = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-17T22:00:00Z") });
  auth.member = new Set([RID]);
  reads.length = 0;
  forgetAgora(RID);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("loadAgora", () => {
  it("quem não é membro → recusa, sem nenhuma leitura no banco", async () => {
    await expect(loadAgora(OTHER)).rejects.toThrow("Entre de novo no painel.");
    expect(reads).toEqual([]);
  });
  it("rid inválido → recusa, sem nenhuma leitura no banco", async () => {
    auth.member = new Set(["x", "1 or 1=1"]);
    await expect(loadAgora("x")).rejects.toThrow();
    await expect(loadAgora("1 or 1=1")).rejects.toThrow();
    await expect(loadAgora(42 as never)).rejects.toThrow();
    expect(reads).toEqual([]);
  });
  it("membro → 2 leituras: restaurants e community_tvs", async () => {
    const out = await loadAgora(RID);
    expect(out).toMatchObject({ aparecaAllowed: false, queueOk: true });
    expect([...reads].sort()).toEqual(["community_tvs", "restaurants"]);
  });
  it("segunda chamada dentro de 5 s → nenhuma leitura nova; depois de 5 s, lê de novo", async () => {
    await loadAgora(RID);
    vi.advanceTimersByTime(4_999);
    await loadAgora(RID);
    expect(reads).toHaveLength(2);
    vi.advanceTimersByTime(1);
    await loadAgora(RID);
    expect(reads).toHaveLength(4);
  });
  it("o memo não pula a conferência: quem não é membro é recusado mesmo com o memo quente", async () => {
    await loadAgora(RID);
    auth.member = new Set();
    await expect(loadAgora(RID)).rejects.toThrow();
    expect(reads).toHaveLength(2);
  });
  it("depois do forgetAgora(rid) → lê de novo", async () => {
    await loadAgora(RID);
    forgetAgora(RID);
    await loadAgora(RID);
    expect(reads).toHaveLength(4);
  });
});
