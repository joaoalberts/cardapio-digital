import { beforeEach, describe, expect, it, vi } from "vitest";

const UID = "11111111-1111-4111-8111-111111111111";
const h = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  users: [] as Record<string, unknown>[],
  reads: 0,
  updates: [] as Record<string, unknown>[],
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (h.jar.has(k) ? { value: h.jar.get(k) } : undefined),
    set: (k: string, v: string) => void h.jar.set(k, v),
    delete: (k: string) => void h.jar.delete(k),
  }),
}));
vi.mock("@/lib/db/nocodb", () => ({
  first: async (_t: string, where: { uid?: string }) => {
    h.reads++;
    return h.users.find((u) => u.id === where.uid) ?? null;
  },
  update: async (_t: string, where: { uid: string }, patch: Record<string, unknown>) => {
    h.updates.push(patch);
    Object.assign(h.users.find((u) => u.id === where.uid)!, patch);
    return 1;
  },
  insertOne: vi.fn(),
}));

const auth = await import("./index");
const { createSessionValue } = await import("./session");
const cookieFor = async (version: number) => void h.jar.set("cd_session", await createSessionValue(UID, version));

describe("sessão revogável por versão", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "segredo-de-teste");
    h.jar.clear();
    h.reads = 0;
    h.updates = [];
    h.users = [{ Id: 1, id: UID, email: "a@b.com", password_hash: "x", session_version: 2 }];
  });

  it("versão certa passa; versão velha é recusada", async () => {
    await cookieFor(2);
    expect(await auth.currentUserId()).toBe(UID);
    await cookieFor(1);
    expect(await auth.currentUserId()).toBeNull();
    expect(await auth.currentUser()).toBeNull();
  });

  it("cookie legado de 3 partes vale como versão 0", async () => {
    h.users[0].session_version = 0;
    await cookieFor(0); // mesma coisa que o legado depois de lido
    expect(await auth.currentUserId()).toBe(UID);
    h.users[0].session_version = null; // linha antiga, coluna vazia
    expect(await auth.currentUserId()).toBe(UID);
  });

  it("coluna ainda não criada (campo ausente) é tolerada como versão 0", async () => {
    delete h.users[0].session_version;
    await cookieFor(0);
    expect(await auth.currentUserId()).toBe(UID);
    await cookieFor(1);
    expect(await auth.currentUserId()).toBeNull();
  });

  it("sem cookie, ou usuário que não existe mais: ninguém", async () => {
    expect(await auth.currentUserId()).toBeNull();
    h.users = [];
    await cookieFor(0);
    expect(await auth.currentUserId()).toBeNull();
  });

  it("roleIn também respeita a versão", async () => {
    await cookieFor(1);
    expect(await auth.roleIn(UID)).toBeNull();
  });

  it("troca de senha incrementa a versão e devolve a nova", async () => {
    expect(await auth.setPassword(UID, "senha-nova-123")).toBe(3);
    expect(h.users[0].session_version).toBe(3);
    expect(String(h.users[0].password_hash)).toMatch(/^scrypt\$/);
    expect(await auth.setPassword(UID, "outra-senha-123")).toBe(4);
  });

  it("troca de senha derruba as outras sessões e a atual continua com o cookie novo", async () => {
    await cookieFor(2);
    const outra = h.jar.get("cd_session")!; // outro aparelho, mesma versão
    const v = await auth.setPassword(UID, "senha-nova-123");
    await auth.startSession(UID, v); // quem trocou recebe cookie novo
    expect(await auth.currentUserId()).toBe(UID);
    h.jar.set("cd_session", outra); // o outro aparelho volta com o cookie antigo
    expect(await auth.currentUserId()).toBeNull();
  });

  it("sem a coluna, trocar a senha não escreve session_version (não quebra) e devolve 0", async () => {
    delete h.users[0].session_version;
    expect(await auth.setPassword(UID, "senha-nova-123")).toBe(0);
    expect(h.updates[0]).not.toHaveProperty("session_version");
  });

  it("startSession sem versão usa a do banco", async () => {
    await auth.startSession(UID);
    expect(await auth.currentUserId()).toBe(UID);
  });
});
