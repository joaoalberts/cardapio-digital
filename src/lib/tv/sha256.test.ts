import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "./sha256";
import { sha256Hex as sha256HexWebCrypto } from "./pair";

// O telão roda em http://<IP do Mac> (contexto inseguro), onde crypto.subtle não existe:
// o SHA-256 do segredo é calculado em JS puro e tem de bater com o do servidor (WebCrypto).
const node = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("sha256Hex (JS puro)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("bate com os vetores conhecidos (FIPS 180-2)", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
    expect(sha256Hex("a".repeat(1_000_000))).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });

  it("acerta nas fronteiras do bloco de 64 bytes (0 a 200 bytes)", () => {
    for (let n = 0; n <= 200; n++) {
      const s = Array.from({ length: n }, (_, i) => String.fromCharCode(33 + ((i * 7 + n) % 90))).join("");
      expect(sha256Hex(s), `tamanho ${n}`).toBe(node(s));
    }
  });

  it("codifica em UTF-8 (acentos, emoji)", () => {
    for (const s of ["ação", "Cardápio · telão", "🍓🍫🍨", "\u0000\u007f\u0080߿ࠀ￿"]) {
      expect(sha256Hex(s)).toBe(node(s));
    }
  });

  it("dá o mesmo hash do servidor para um segredo de 64 hex", async () => {
    const secrets = ["0".repeat(64), "f".repeat(64), "0123456789abcdef".repeat(4), "a1b2c3d4e5f60718293a4b5c6d7e8f90".repeat(2)];
    for (const s of secrets) expect(sha256Hex(s)).toBe(await sha256HexWebCrypto(s));
  });

  it("não depende do crypto.subtle (ausente em http://<IP>)", () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    expect(globalThis.crypto.subtle).toBeUndefined();
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("devolve 64 dígitos hexadecimais minúsculos", () => {
    expect(sha256Hex("telão")).toMatch(/^[0-9a-f]{64}$/);
  });
});
