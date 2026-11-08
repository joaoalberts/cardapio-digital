import { sharedLimiter, type Limiter } from "@/lib/limiter";

// Limites de tentativa do login e do cadastro. O limitador é em memória, por instância do
// servidor (melhor esforço): duas instâncias contam separado e uma nova começa do zero.
// Isso freia quem tenta senhas em massa, sem depender de banco.
export const TOO_MANY = "Muitas tentativas. Tente de novo em alguns minutos.";

const MIN = 60_000;
export const LOGIN_PER_IP = 10;
export const LOGIN_PER_EMAIL = 5;
export const SIGNUP_PER_IP_HOUR = 5;

type Limiters = { ip: Limiter; email: Limiter };

const loginLimiters = (): Limiters => ({
  ip: sharedLimiter("login.ip", { max: LOGIN_PER_IP, windowMs: 10 * MIN }),
  email: sharedLimiter("login.email", { max: LOGIN_PER_EMAIL, windowMs: 10 * MIN }),
});
const signupLimiter = () => sharedLimiter("cadastro.ip", { max: SIGNUP_PER_IP_HOUR, windowMs: 60 * MIN });

// Reserva uma tentativa de login por IP e por e-mail (já normalizado). Só falha de senha
// fica contada: quem acertou, ou teve erro do banco, devolve a reserva com release().
export type LoginReserve = { ok: true; release(): void } | { ok: false };

export function reserveLogin(ip: string, email: string, l: Limiters = loginLimiters()): LoginReserve {
  if (!l.ip.hit(ip)) return { ok: false };
  if (!l.email.hit(email)) {
    l.ip.undo(ip);
    return { ok: false };
  }
  let released = false;
  return {
    ok: true,
    release() {
      if (released) return;
      released = true;
      l.ip.undo(ip);
      l.email.undo(email);
    },
  };
}

// Cada cadastro tentado conta (criar conta em massa é o que se quer frear).
export function allowSignup(ip: string, limiter: Limiter = signupLimiter()): boolean {
  return limiter.hit(ip);
}
