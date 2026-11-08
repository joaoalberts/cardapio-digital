import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionValue, readSessionValue } from "./session";

const UID = "11111111-1111-4111-8111-111111111111";

// Cookie antigo, de 3 partes: id.validade.assinatura (assinado com a mesma chave).
async function legacy(exp: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("segredo-de-teste"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const payload = `${UID}.${exp}`;
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  const b64 = btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${payload}.${b64}`;
}

describe("cookie de sessão com versão", () => {
  beforeEach(() => vi.stubEnv("AUTH_SECRET", "segredo-de-teste"));

  it("ida e volta: devolve o usuário e a versão", async () => {
    expect(await readSessionValue(await createSessionValue(UID, 3))).toEqual({ userId: UID, version: 3 });
    expect(await readSessionValue(await createSessionValue(UID))).toEqual({ userId: UID, version: 0 });
  });

  it("cookie legado de 3 partes vale como versão 0", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    expect(await readSessionValue(await legacy(exp))).toEqual({ userId: UID, version: 0 });
  });

  it("legado vencido é recusado", async () => {
    expect(await readSessionValue(await legacy(Math.floor(Date.now() / 1000) - 10))).toBeNull();
  });

  it("assinatura adulterada é recusada", async () => {
    const v = await createSessionValue(UID, 1);
    const bad = v.slice(0, -2) + (v.endsWith("AA") ? "BB" : "AA");
    expect(await readSessionValue(bad)).toBeNull();
  });

  it("trocar a versão no cookie sem reassinar é recusado (não dá para 'subir' a versão)", async () => {
    const [id, , exp, sig] = (await createSessionValue(UID, 1)).split(".");
    expect(await readSessionValue([id, "2", exp, sig].join("."))).toBeNull();
    expect(await readSessionValue([id, "0", exp, sig].join("."))).toBeNull();
  });

  it("formato inválido, vazio e versão não numérica são recusados", async () => {
    for (const v of [null, undefined, "", "a.b", "a.b.c.d.e", `${UID}.x.9999999999.sig`, `${UID}.-1.9999999999.sig`]) {
      expect(await readSessionValue(v)).toBeNull();
    }
  });

  it("segredo diferente invalida o cookie", async () => {
    const v = await createSessionValue(UID, 1);
    vi.stubEnv("AUTH_SECRET", "outro-segredo");
    expect(await readSessionValue(v)).toBeNull();
  });
});
