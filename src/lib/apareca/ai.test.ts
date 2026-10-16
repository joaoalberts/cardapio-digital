// Chamada à IA do Apareça sem rede: a IA só liga com o interruptor do restaurante E a chave E sem
// o desligamento geral; resposta fora do formato vira erro (Foco 4); a chamada leva as 3 imagens
// por URL, o modelo pedido e as regras no system; erro da API e demora viram exceção.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AI_FRAMES_S, AI_MODEL_DEFAULT, AI_RULES, AI_TIMEOUT_MS, aiAvailable, aiModel, moderateFrames, parseVerdict } from "./ai";

afterEach(() => vi.unstubAllEnvs());

const FRAMES = ["https://image.mux.com/pb/thumbnail.jpg?time=0.5", "https://image.mux.com/pb/thumbnail.jpg?time=3", "https://image.mux.com/pb/thumbnail.jpg?time=5.5"];

function reply(text: string, status = 200) {
  return new Response(JSON.stringify({ content: [{ type: "text", text }], stop_reason: "end_turn" }), { status });
}

describe("constantes", () => {
  it("prazo de 30 s, um quadro por segundo (0,5 a 5,5 s) e regras com os temas da spec", () => {
    expect(AI_TIMEOUT_MS).toBe(30_000);
    expect(AI_FRAMES_S).toEqual([0.5, 1.5, 2.5, 3.5, 4.5, 5.5]);
    for (const t of ["nudez", "gestos obscenos", "violência", "armas", "drogas", "discurso de ódio", "texto ofensivo", "menores"]) {
      expect(AI_RULES.toLowerCase()).toContain(t);
    }
  });
});

describe("aiModel", () => {
  it("padrão claude-haiku-5-5; APARECA_AI_MODEL troca; vazio cai no padrão", () => {
    vi.stubEnv("APARECA_AI_MODEL", "");
    expect(AI_MODEL_DEFAULT).toBe("claude-haiku-5-5");
    expect(aiModel()).toBe("claude-haiku-5-5");
    vi.stubEnv("APARECA_AI_MODEL", "claude-haiku-4-5");
    expect(aiModel()).toBe("claude-haiku-4-5");
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

  it("corpo para o Haiku 5.5: esforço low, max_tokens com folga para o pensamento, sem amostragem nem prefill", async () => {
    const fetch = vi.fn(async () => reply('{"aprovado":true,"motivo":""}'));
    await moderateFrames(FRAMES, { key: "k", model: "claude-haiku-5-5", fetch: fetch as unknown as typeof globalThis.fetch });
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body.max_tokens).toBeGreaterThanOrEqual(1_024);
    expect(body).not.toHaveProperty("thinking");
    for (const k of ["temperature", "top_p", "top_k"]) expect(body).not.toHaveProperty(k);
    expect(body.messages.at(-1).role).toBe("user");
  });

  it("corpo para o Haiku 4.5 (via APARECA_AI_MODEL): sem output_config, que daria 400", async () => {
    const fetch = vi.fn(async () => reply('{"aprovado":true,"motivo":""}'));
    await moderateFrames(FRAMES, { key: "k", model: "claude-haiku-4-5", fetch: fetch as unknown as typeof globalThis.fetch });
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body).not.toHaveProperty("output_config");
  });

  it("resposta com bloco de pensamento antes do texto: lê o bloco de texto", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: '{"aprovado":false,"motivo":"arma"}' }],
    })));
    expect(await moderateFrames(FRAMES, { key: "k", model: "m", fetch: fetch as unknown as typeof globalThis.fetch })).toEqual({ aprovado: false, motivo: "arma" });
  });

  it("só pensamento, sem texto (max_tokens no meio do pensamento) → lança", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "thinking", thinking: "" }], stop_reason: "max_tokens" })));
    await expect(moderateFrames(FRAMES, { key: "k", model: "m", fetch: fetch as unknown as typeof globalThis.fetch })).rejects.toThrow();
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
