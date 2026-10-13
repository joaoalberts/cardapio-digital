// Sessão do painel: cookie assinado com o id do usuário e a validade.
// Só usa Web Crypto, então serve tanto no proxy quanto nas páginas e ações.

export const SESSION_COOKIE = "cd_session";
export const SESSION_DAYS = 30;

const enc = new TextEncoder();

// AUTH_SECRET na Vercel; sem ela, deriva do token do NocoDB (que já é secreto).
// Trocar qualquer um dos dois desconecta todo mundo, o que é o esperado.
async function key() {
  const secret = process.env.AUTH_SECRET || `cardapio-session:${process.env.NOCODB_API_TOKEN ?? ""}`;
  if (secret === "cardapio-session:") throw new Error("Falta AUTH_SECRET ou NOCODB_API_TOKEN.");
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

function b64url(buf: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sign(payload: string) {
  return b64url(await crypto.subtle.sign("HMAC", await key(), enc.encode(payload)));
}

export async function createSessionValue(userId: string) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const payload = `${userId}.${exp}`;
  return `${payload}.${await sign(payload)}`;
}

// Devolve o id do usuário quando o cookie é válido e não venceu.
export async function readSessionValue(value: string | undefined | null): Promise<string | null> {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts;
  if (!/^[0-9a-f-]{36}$/.test(userId) || !(Number(exp) > Date.now() / 1000)) return null;
  const expected = await sign(`${userId}.${exp}`).catch(() => null);
  if (!expected || expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? userId : null;
}
