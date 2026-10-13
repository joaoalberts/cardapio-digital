import "server-only";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import * as db from "@/lib/db/nocodb";
import { SESSION_COOKIE, SESSION_DAYS, createSessionValue, readSessionValue } from "./session";

// Login próprio do app (antes era o Supabase Auth): usuários na tabela "users" do NocoDB,
// senha com scrypt e sessão num cookie assinado.

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export type User = { id: string; email: string };
type UserRow = { Id: number; id: string; email: string; password_hash: string | null };

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

export async function setPassword(userId: string, password: string) {
  await db.update("users", { uid: userId }, { password_hash: await hashPassword(password) });
}

export async function startSession(userId: string) {
  (await cookies()).set(SESSION_COOKIE, await createSessionValue(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

// Id de quem está logado (só pelo cookie, sem ir ao banco).
export async function currentUserId() {
  return readSessionValue((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function currentUser(): Promise<User | null> {
  const id = await currentUserId();
  if (!id) return null;
  const u = await db.first<UserRow>("users", { uid: id });
  return u ? { id: u.id, email: u.email } : null;
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
