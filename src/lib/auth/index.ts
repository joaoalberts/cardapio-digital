import "server-only";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cache } from "react";
import { cookies } from "next/headers";
import * as db from "@/lib/db/nocodb";
import { SESSION_COOKIE, SESSION_DAYS, createSessionValue, readSessionValue } from "./session";

// Login próprio do app (antes era o Supabase Auth): usuários na tabela "users" do NocoDB,
// senha com scrypt e sessão num cookie assinado.

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

// created_at: só currentUser preenche (o super admin confere a data da conta com SUPERADMIN_SINCE).
export type User = { id: string; email: string; created_at?: string | null };
type UserRow = {
  Id: number;
  id: string;
  email: string;
  password_hash: string | null;
  created_at?: string | null;
  session_version?: number | null;
};

// Versão da sessão do usuário. Coluna ainda não criada (campo ausente) ou vazia vale 0:
// o código funciona antes e depois de rodar o setup do NocoDB.
export const versionOf = (u: Pick<UserRow, "session_version">) => Number(u.session_version ?? 0) || 0;

export const EMAIL = /^[^\s@,()~]+@[^\s@,()~]+\.[^\s@,()~]+$/;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

async function verifyPassword(password: string, stored: string | null) {
  const [kind, salt, hash] = (stored ?? "").split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = await scrypt(password, Buffer.from(salt, "base64"), want.length);
  return timingSafeEqual(got, want);
}

export async function findUserByEmail(email: string) {
  const e = normalizeEmail(email);
  if (!EMAIL.test(e)) return null;
  return db.first<UserRow>("users", { email: e });
}

export async function createUser(email: string, password: string): Promise<User> {
  const e = normalizeEmail(email);
  const row = await db.insertOne("users", { email: e, password_hash: await hashPassword(password) });
  return { id: row.id, email: e };
}

// Confere e-mail e senha; não diz qual dos dois está errado.
export async function checkCredentials(email: string, password: string): Promise<User | null> {
  const u = await findUserByEmail(email);
  if (!u || !(await verifyPassword(password, u.password_hash))) return null;
  return { id: u.id, email: u.email };
}

// Troca a senha e sobe a versão da sessão: as outras sessões deixam de valer. Devolve a
// versão nova (quem trocou a própria senha emite um cookie com ela e continua logado).
// Sem a coluna no banco (campo ausente), só troca a senha e a versão fica 0.
export async function setPassword(userId: string, password: string): Promise<number> {
  const row = await db.first<UserRow>("users", { uid: userId });
  const patch: Record<string, unknown> = { password_hash: await hashPassword(password) };
  let version = 0;
  if (row && "session_version" in row) {
    version = versionOf(row) + 1;
    patch.session_version = version;
  }
  await db.update("users", { uid: userId }, patch);
  return version;
}

export async function startSession(userId: string, version?: number) {
  const v = version ?? (await sessionVersion(userId));
  (await cookies()).set(SESSION_COOKIE, await createSessionValue(userId, v), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

async function sessionVersion(userId: string) {
  const row = await db.first<UserRow>("users", { uid: userId });
  return row ? versionOf(row) : 0;
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

// Uma leitura de users por requisição (cache do React), qualquer que seja o número de chamadas.
const userRow = cache(async (id: string) => db.first<UserRow>("users", { uid: id }));

// Usuário do cookie, só se a versão da sessão ainda bate com a do banco (troca de senha
// derruba as sessões antigas).
async function sessionUser(): Promise<UserRow | null> {
  const s = await readSessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) return null;
  const u = await userRow(s.userId);
  return u && versionOf(u) === s.version ? u : null;
}

// Id de quem está logado.
export async function currentUserId() {
  return (await sessionUser())?.id ?? null;
}

export async function currentUser(): Promise<User | null> {
  const u = await sessionUser();
  return u ? { id: u.id, email: u.email, created_at: typeof u.created_at === "string" ? u.created_at : null } : null;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type Role = "owner" | "editor";

// Papel do usuário logado no restaurante, ou null se não for membro. O isolamento entre
// restaurantes que antes ficava nas regras do banco agora passa por aqui.
export async function roleIn(restaurantId: string): Promise<Role | null> {
  const userId = await currentUserId();
  if (!userId || !UUID.test(restaurantId)) return null;
  const m = await db.first<{ role: Role }>("members", { restaurant_id: restaurantId, user_id: userId });
  return m?.role ?? null;
}

export async function isMember(restaurantId: string) {
  return (await roleIn(restaurantId)) !== null;
}

export async function isOwner(restaurantId: string) {
  return (await roleIn(restaurantId)) === "owner";
}
