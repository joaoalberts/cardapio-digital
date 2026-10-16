// Chamada à IA do Apareça sem rede: a IA só liga com o interruptor do restaurante E a chave E sem
// o desligamento geral; resposta fora do formato vira erro (Foco 4); a chamada leva as 3 imagens
// por URL, o modelo pedido e as regras no system; erro da API e demora viram exceção.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AI_FRAMES_S, AI_RULES, AI_TIMEOUT_MS, aiAvailable, moderateFrames, parseVerdict } from "./ai";

const FRAMES = ["https://image.mux.com/pb/thumbnail.jpg?time=0.5", "https://image.mux.com/pb/thumbnail.jpg?time=3", "https://image.mux.com/pb/thumbnail.jpg?time=5.5"];

function reply(text: string, status = 200) {
  return new Response(JSON.stringify({ content: [{ type: "text", text }], stop_reason: "end_turn" }), { status });
}

describe("constantes", () => {
  it("prazo de 30 s, quadros em 0,5 s, 3 s e 5,5 s e regras com os temas da spec", () => {
    expect(AI_TIMEOUT_MS).toBe(30_000);
    expect(AI_FRAMES_S).toEqual([0.5, 3, 5.5]);
    for (const t of ["nudez", "gestos obscenos", "violência", "armas", "drogas", "discurso de ódio", "texto ofensivo", "menores"]) {
      expect(AI_RULES.toLowerCase()).toContain(t);
    }
  });
});

describe("aiAvailable", () => {
  it("a chave sozinha não liga: ai_allowed false → false", () => {
    expect(aiAvailable({ ai_allowed: false }, { key: "sk-test", off: false })).toBe(false);
  });
  it("ai_allowed sem chave → false; chave vazia → false", () => {
    expect(aiAvailable({ ai_allowed: true }, { off: false })).toBe(false);
    expect(aiAvailable({ ai_allowed: true }, { key: "", off: false })).toBe(false);
  });
  it("desligamento geral → false", () => {
    expect(aiAvailable({ ai_allowed: true }, { key: "sk-test", off: true })).toBe(false);
  });
  it("só com os três → true", () => {
    expect(aiAvailable({ ai_allowed: true }, { key: "sk-test", off: false })).toBe(true);
  });
});

describe("parseVerdict (Foco 4)", () => {
  it("aceita o JSON com texto em volta", () => {
    expect(parseVerdict('Segue: {"aprovado":true,"motivo":""} fim')).toEqual({ aprovado: true, motivo: "" });
    expect(parseVerdict('```json\n{"aprovado": false, "motivo": "arma na mão"}\n```')).toEqual({ aprovado: false, motivo: "arma na mão" });
  });
  it.each([
    ['{"aprovado":"sim","motivo":""}', "aprovado em texto"],
    ['{"aprovado":1,"motivo":""}', "aprovado em número"],
    ['{"aprovado":true}', "sem motivo"],
    ['{"aprovado":true,"motivo":null}', "motivo nulo"],
    ['{"aprovado":true,"motivo":"', "JSON quebrado"],
    ["", "texto vazio"],
    ["aprovado", "sem JSON"],
    ["[true]", "lista"],
  ])("recusa %s (%s)", (text) => {
    expect(parseVerdict(text)).toBeNull();
  });
  it("corta motivo longo", () => {
    const v = parseVerdict(JSON.stringify({ aprovado: false, motivo: "x".repeat(2_000) }));
    expect(v?.motivo.length).toBeLessThanOrEqual(500);
  });
});

describe("moderateFrames", () => {
  it("manda as 3 imagens por URL, o modelo pedido e AI_RULES no system; devolve o veredito", async () => {
    const fetch = vi.fn(async () => reply('{"aprovado":true,"motivo":""}'));
    const v = await moderateFrames(FRAMES, { key: "sk-test", model: "modelo-x", fetch: fetch as unknown as typeof globalThis.fetch });
    expect(v).toEqual({ aprovado: true, motivo: "" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-test");
    expect((init.headers as Record<string, string>)["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("modelo-x");
    expect(body.system).toBe(AI_RULES);
    const images = body.messages[0].content.filter((c: { type: string }) => c.type === "image");
    expect(images).toEqual(FRAMES.map((url) => ({ type: "image", source: { type: "url", url } })));
  });

  it("529 da API → lança", async () => {
    const fetch = vi.fn(async () => new Response('{"type":"error"}', { status: 529 }));
    await expect(moderateFrames(FRAMES, { key: "k", model: "m", fetch: fetch as unknown as typeof globalThis.fetch })).rejects.toThrow();
  });

  it("resposta fora do formato → lança (nunca aprova por engano)", async () => {
    const fetch = vi.fn(async () => reply('{"aprovado":"sim","motivo":""}'));
    await expect(moderateFrames(FRAMES, { key: "k", model: "m", fetch: fetch as unknown as typeof globalThis.fetch })).rejects.toThrow();
  });

  it("recusa da API (sem texto) → lança", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ content: [], stop_reason: "refusal" })));
    await expect(moderateFrames(FRAMES, { key: "k", model: "m", fetch: fetch as unknown as typeof globalThis.fetch })).rejects.toThrow();
  });

  it("demora maior que timeoutMs → lança, mesmo se o fetch ignorar o sinal", async () => {
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    const t0 = Date.now();
    await expect(
      moderateFrames(FRAMES, { key: "k", model: "m", fetch: fetch as unknown as typeof globalThis.fetch, timeoutMs: 30 }),
    ).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(2_000);
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.signal?.aborted).toBe(true);
  });

  it("erro de rede → lança", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("rede");
    });
    await expect(moderateFrames(FRAMES, { key: "k", model: "m", fetch: fetch as unknown as typeof globalThis.fetch })).rejects.toThrow();
  });
});
