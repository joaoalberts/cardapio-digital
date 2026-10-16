import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// storage.ts é só do servidor; no teste o marcador "server-only" não tem o que proteger.
vi.mock("server-only", () => ({}));

import { ownsFile, putFile, readLocalFile, removeFiles, removeFilesStrict, storageDriver, storageEnabled } from "./storage";

const R1 = "00000000-0000-4000-8000-000000000001";
const buf = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

let root = "";
const saved = { ...process.env };

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "cardapio-local-blob-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
// Rede proibida: se o driver local escorregar para o Blob, o teste falha sem sair da máquina.
const fetchStub = vi.fn(async () => {
  throw new Error("rede proibida no teste");
});
beforeEach(() => {
  process.env.STORAGE_DRIVER = "local";
  process.env.LOCAL_BLOB_DIR = root;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  fetchStub.mockClear();
  vi.stubGlobal("fetch", fetchStub);
});
afterEach(() => {
  process.env = { ...saved };
  vi.unstubAllGlobals();
});

describe("driver de arquivos", () => {
  it("lê STORAGE_DRIVER", () => {
    expect(storageDriver()).toBe("local");
    delete process.env.STORAGE_DRIVER;
    expect(storageDriver()).toBe("blob");
    process.env.STORAGE_DRIVER = "qualquer";
    expect(storageDriver()).toBe("blob");
  });

  it("no driver local o envio fica ligado mesmo sem o token do Blob", () => {
    expect(storageEnabled()).toBe(true);
    delete process.env.STORAGE_DRIVER;
    expect(storageEnabled()).toBe(false);
  });
});

describe("driver local", () => {
  it("putFile grava em <raiz>/<pathname> e devolve a URL da rota local", async () => {
    const url = await putFile("r1/comunidade/x.webp", buf("foto"), "image/webp");
    expect(url).toBe("/api/arquivos-locais/r1/comunidade/x.webp");
    const file = path.join(root, "r1/comunidade/x.webp");
    expect(existsSync(file)).toBe(true);
    expect(await readFile(file, "utf8")).toBe("foto");
  });

  it("ownsFile aceita só a pasta do próprio restaurante", async () => {
    const url = await putFile("r1/comunidade/x.webp", buf("foto"), "image/webp");
    expect(ownsFile("r1", url)).toBe(true);
    expect(ownsFile("r2", url)).toBe(false);
    expect(ownsFile("r", url)).toBe(false);
    expect(ownsFile("", url)).toBe(false);
  });

  it("ownsFile recusa '..' que sairia da pasta do restaurante", () => {
    expect(ownsFile("r1", "/api/arquivos-locais/r1/../r2/x.webp")).toBe(false);
    expect(ownsFile("r1", "/api/arquivos-locais/r1/%2e%2e/r2/x.webp")).toBe(false);
    expect(ownsFile("r1", "/api/arquivos-locais/r1/")).toBe(false);
    expect(ownsFile("r1", "/api/arquivos-locais/r1")).toBe(false);
  });

  it("fora do driver local, URL local não é arquivo de ninguém", () => {
    delete process.env.STORAGE_DRIVER;
    expect(ownsFile("r1", "/api/arquivos-locais/r1/comunidade/x.webp")).toBe(false);
  });

  it("o caminho do Blob continua igual", () => {
    const blob = `https://abc123.public.blob.vercel-storage.com/${R1}/items/a.webp`;
    expect(ownsFile(R1, blob)).toBe(true);
    expect(ownsFile("r2", blob)).toBe(false);
    expect(ownsFile(R1, `${R1}/items/a.webp`)).toBe(true);
  });

  it("removeFiles apaga o arquivo local", async () => {
    const url = await putFile("r1/comunidade/apagar.webp", buf("foto"), "image/webp");
    const file = path.join(root, "r1/comunidade/apagar.webp");
    expect(existsSync(file)).toBe(true);
    await removeFiles([url]);
    expect(existsSync(file)).toBe(false);
    // De novo, já sem o arquivo: não lança.
    await expect(removeFiles([url, null, undefined])).resolves.toBeUndefined();
  });

  it("removeFiles com '..' não apaga nada fora da pasta", async () => {
    await putFile("r2/comunidade/fica.webp", buf("foto"), "image/webp");
    await removeFiles(["/api/arquivos-locais/r1/../r2/comunidade/fica.webp"]);
    expect(existsSync(path.join(root, "r2/comunidade/fica.webp"))).toBe(true);
  });

  it("nunca fala com o Blob: nem para gravar nem para apagar", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "teste";
    await putFile("r1/comunidade/y.webp", buf("foto"), "image/webp");
    await removeFiles([`https://abc123.public.blob.vercel-storage.com/${R1}/items/a.webp`]);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("putFile com '..' ou caminho absoluto lança erro e não grava", async () => {
    await expect(putFile("r1/../r2/x.webp", buf("x"), "image/webp")).rejects.toThrow();
    await expect(putFile("../fora.webp", buf("x"), "image/webp")).rejects.toThrow();
    await expect(putFile("/r1/x.webp", buf("x"), "image/webp")).rejects.toThrow();
    await expect(putFile("r1//x.webp", buf("x"), "image/webp")).rejects.toThrow();
    await expect(putFile("r1\\..\\x.webp", buf("x"), "image/webp")).rejects.toThrow();
    expect(existsSync(path.join(root, "r2/x.webp"))).toBe(false);
    expect(existsSync(path.join(path.dirname(root), "fora.webp"))).toBe(false);
  });
});

describe("leitura para a rota /api/arquivos-locais", () => {
  it("devolve o arquivo com o content-type pela extensão", async () => {
    await putFile("r1/comunidade/a.webp", buf("w"), "image/webp");
    await putFile("r1/comunidade/b.jpg", buf("j"), "image/jpeg");
    await putFile("r1/comunidade/c.png", buf("p"), "image/png");
    const a = await readLocalFile(["r1", "comunidade", "a.webp"]);
    expect(a?.type).toBe("image/webp");
    expect(new TextDecoder().decode(a!.body)).toBe("w");
    expect((await readLocalFile(["r1", "comunidade", "b.jpg"]))?.type).toBe("image/jpeg");
    expect((await readLocalFile(["r1", "comunidade", "c.png"]))?.type).toBe("image/png");
  });

  it("recusa '..', extensão desconhecida e arquivo que não existe", async () => {
    await putFile("r1/comunidade/d.webp", buf("w"), "image/webp");
    await putFile("r1/comunidade/e.html", buf("<script>"), "text/html");
    expect(await readLocalFile(["r1", "..", "r1", "comunidade", "d.webp"])).toBeNull();
    expect(await readLocalFile(["..", "segredo.webp"])).toBeNull();
    expect(await readLocalFile(["r1", "comunidade/../comunidade", "d.webp"])).toBeNull();
    expect(await readLocalFile(["r1", "comunidade", "e.html"])).toBeNull();
    expect(await readLocalFile(["r1", "comunidade", "nao-existe.webp"])).toBeNull();
    expect(await readLocalFile([])).toBeNull();
  });
});

describe("removeFilesStrict (retenção: a linha só sai quando o arquivo saiu)", () => {
  const blob = `https://abc123.public.blob.vercel-storage.com/${R1}/comunidade/a.webp`;

  it("driver local: apaga; arquivo que já não existe não é erro", async () => {
    const url = await putFile("r1/comunidade/estrito.webp", buf("foto"), "image/webp");
    await removeFilesStrict([url]);
    expect(existsSync(path.join(root, "r1/comunidade/estrito.webp"))).toBe(false);
    await expect(removeFilesStrict([url, null, undefined])).resolves.toBeUndefined();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("driver local: unlink que falha por outro motivo lança", async () => {
    // Uma pasta no lugar do arquivo: unlink falha com EPERM/EISDIR, não ENOENT.
    await mkdir(path.join(root, "r1/comunidade/pasta.webp"), { recursive: true });
    await expect(removeFilesStrict(["/api/arquivos-locais/r1/comunidade/pasta.webp"])).rejects.toThrow();
  });

  it("driver local: nunca fala com o Blob e ignora '..'", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "teste";
    await putFile("r2/comunidade/fica2.webp", buf("foto"), "image/webp");
    await removeFilesStrict([blob, "/api/arquivos-locais/r1/../r2/comunidade/fica2.webp"]);
    expect(existsSync(path.join(root, "r2/comunidade/fica2.webp"))).toBe(true);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("Blob: confere a resposta; 200 passa, erro HTTP ou de rede lança", async () => {
    delete process.env.STORAGE_DRIVER;
    process.env.BLOB_READ_WRITE_TOKEN = "teste";
    fetchStub.mockImplementationOnce(async () => new Response("{}", { status: 200 }) as never);
    await expect(removeFilesStrict([blob, null])).resolves.toBeUndefined();
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/delete$/);
    expect(JSON.parse(String(init.body))).toEqual({ urls: [blob] });
    fetchStub.mockImplementationOnce(async () => new Response("falhou", { status: 500 }) as never);
    await expect(removeFilesStrict([blob])).rejects.toThrow(/500/);
    fetchStub.mockImplementationOnce(async () => {
      throw new Error("rede caiu");
    });
    await expect(removeFilesStrict([blob])).rejects.toThrow(/rede caiu/);
  });

  it("Blob sem token: lança (o arquivo ficaria órfão); sem URL do Blob, não faz nada", async () => {
    delete process.env.STORAGE_DRIVER;
    await expect(removeFilesStrict([blob])).rejects.toThrow();
    await expect(removeFilesStrict([`${R1}/items/antigo.webp`, null])).resolves.toBeUndefined();
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
