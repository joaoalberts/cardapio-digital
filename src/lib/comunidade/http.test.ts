import { describe, expect, it } from "vitest";
import { clientIp, readBodyCapped } from "./http";

const URL_ = "http://localhost/api/comunidade/forno/eventos";

// Corpo em fluxo, como chega de um cliente que não manda content-length.
function streamed(chunks: Uint8Array[] | (() => Uint8Array | null)) {
  const stats = { pulls: 0, cancelled: false };
  const list = Array.isArray(chunks) ? [...chunks] : null;
  const body = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      stats.pulls++;
      const next = list ? list.shift() ?? null : (chunks as () => Uint8Array | null)();
      if (next) ctrl.enqueue(next);
      else ctrl.close();
    },
    cancel() {
      stats.cancelled = true;
    },
  });
  const request = new Request(URL_, { method: "POST", body, duplex: "half" } as RequestInit);
  return { request, stats };
}

const bytes = (n: number, fill = 0x61) => new Uint8Array(n).fill(fill);

describe("readBodyCapped", () => {
  it("lê o corpo pequeno inteiro, em texto", async () => {
    const r = await readBodyCapped(new Request(URL_, { method: "POST", body: '{"a":"ção"}' }), 2_000);
    expect(r).toEqual({ ok: true, text: '{"a":"ção"}' });
  });

  it("sem corpo: texto vazio", async () => {
    expect(await readBodyCapped(new Request(URL_, { method: "POST" }), 500)).toEqual({ ok: true, text: "" });
  });

  it("aceita exatamente o teto e recusa 1 byte a mais (conta bytes, não caracteres)", async () => {
    expect(await readBodyCapped(new Request(URL_, { method: "POST", body: "x".repeat(2_000) }), 2_000)).toEqual({ ok: true, text: "x".repeat(2_000) });
    // "ç" ocupa 2 bytes: 1.000 caracteres = 2.000 bytes cabem; 1 a mais não.
    expect((await readBodyCapped(new Request(URL_, { method: "POST", body: "ç".repeat(1_000) }), 2_000)).ok).toBe(true);
    const over = streamed([new TextEncoder().encode("ç".repeat(1_000) + "x")]);
    expect(await readBodyCapped(over.request, 2_000)).toEqual({ ok: false, status: 413 });
  });

  // O Request do Node controla o content-length sozinho; aqui o pedido é montado à mão,
  // como o servidor o entrega com o cabeçalho do cliente.
  const withLength = (length: string, body: ReadableStream<Uint8Array> | null) =>
    ({ headers: new Headers({ "content-length": length }), body }) as unknown as Request;

  it("content-length acima do teto: 413 sem ler nada do corpo", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        pulls++;
        ctrl.enqueue(bytes(1_000));
      },
    });
    expect(await readBodyCapped(withLength("5000000", body), 2_000)).toEqual({ ok: false, status: 413 });
    // O ReadableStream puxa 1 pedaço ao nascer; ninguém pediu mais nenhum.
    expect(pulls).toBeLessThanOrEqual(1);
  });

  it("content-length malformado: 400", async () => {
    for (const v of ["-1", "1e9", "dez", "12 34", "0x10"]) {
      expect(await readBodyCapped(withLength(v, null), 2_000)).toEqual({ ok: false, status: 400 });
    }
  });

  it("corpo em fluxo sem fim e sem content-length: para logo depois do teto e cancela o fluxo", async () => {
    // 10.000 pedaços de 1 KB (10 MB) que só existem se alguém os pedir.
    let made = 0;
    const s = streamed(() => (made++ < 10_000 ? bytes(1_024) : null));
    expect(await readBodyCapped(s.request, 2_000)).toEqual({ ok: false, status: 413 });
    // Leu 3 pedaços (3 KB > 2.000) e mais uns poucos que o Request adianta, nunca os 10 MB.
    expect(made).toBeLessThan(10);
    expect(s.stats.cancelled).toBe(true);
  });

  it("UTF-8 inválido: 400", async () => {
    const s = streamed([new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])]);
    expect(await readBodyCapped(s.request, 2_000)).toEqual({ ok: false, status: 400 });
  });

  it("corpo já lido ou fluxo com erro: 400", async () => {
    const used = new Request(URL_, { method: "POST", body: "abc" });
    await used.text();
    expect(await readBodyCapped(used, 2_000)).toEqual({ ok: false, status: 400 });
    const broken = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        ctrl.error(new Error("conexão caiu"));
      },
    });
    const r = new Request(URL_, { method: "POST", body: broken, duplex: "half" } as RequestInit);
    expect(await readBodyCapped(r, 2_000)).toEqual({ ok: false, status: 400 });
  });
});

describe("clientIp", () => {
  const h = (v?: string) => new Headers(v === undefined ? {} : { "x-forwarded-for": v });

  it("primeiro IP do x-forwarded-for, sem espaços", () => {
    expect(clientIp(h("203.0.113.7"))).toBe("203.0.113.7");
    expect(clientIp(h(" 203.0.113.7 , 10.0.0.1, 10.0.0.2"))).toBe("203.0.113.7");
    expect(clientIp(h("2001:db8::1, 10.0.0.1"))).toBe("2001:db8::1");
  });

  it("sem cabeçalho, vazio ou com lixo: 'anon'", () => {
    for (const v of [undefined, "", " , 10.0.0.1", "não-é-ip", "1".repeat(80), "203.0.113.7;drop"]) expect(clientIp(h(v))).toBe("anon");
  });
});
