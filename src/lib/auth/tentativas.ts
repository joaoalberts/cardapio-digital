import { sharedLimiter, type Limiter } from "@/lib/limiter";

// Limites de tentativa do login e do cadastro. O limitador é em memória, por instância do
// servidor (melhor esforço): duas instâncias contam separado e uma nova começa do zero.
// Isso freia quem tenta senhas em massa, sem depender de banco.
export const TOO_MANY = "Muitas tentativas. Tente de novo em alguns minutos.";

const MIN = 60_000;
export const LOGIN_PER_IP = 10;
export const LOGIN_PER_EMAIL = 5;
export const SIGNUP_PER_IP_HOUR = 5;

// IPv6: quem tem uma rede /64 troca de endereço à vontade; o limite vale para o /64 inteiro.
// IPv4 e "anon" ficam como estão.
export function ipBucket(ip: string): string {
  if (!ip.includes(":")) return ip;
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i); // IPv4 dentro de IPv6
  if (mapped) return mapped[1];
  const [head, tail = null] = ip.split("::");
  const a = head ? head.split(":") : [];
  const b = tail === null ? [] : tail ? tail.split(":") : [];
  const groups = tail === null ? a : [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b];
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

type Limiters = { ip: Limiter; email: Limiter };

const loginLimiters = (): Limiters => ({
  ip: sharedLimiter("login.ip", { max: LOGIN_PER_IP, windowMs: 10 * MIN }),
  email: sharedLimiter("login.email", { max: LOGIN_PER_EMAIL, windowMs: 10 * MIN }),
});
const signupLimiter = () => sharedLimiter("cadastro.ip", { max: SIGNUP_PER_IP_HOUR, windowMs: 60 * MIN });

// Reserva uma tentativa de login por IP e por e-mail (já normalizado). Só falha de senha fica
// contada: quem acertou, ou teve erro do banco, devolve a reserva com release().
// Limite estourado (IP ou e-mail): `blocked`, nada é contado e a senha CONTINUA sendo
// conferida: certa entra, errada recebe "Muitas tentativas". Por isso o limite não freia
// força bruta (decisão do João: a senha certa passa sempre); o custo por palpite é o scrypt.
export type LoginReserve = { blocked: boolean; release(): void };

export function reserveLogin(ip: string, email: string, l: Limiters = loginLimiters()): LoginReserve {
  const ipKey = ipBucket(ip);
  const ipOk = l.ip.hit(ipKey);
  const emailOk = l.email.hit(email);
  if (!ipOk || !emailOk) {
    // Não conta mais uma falha: devolve a que acabou de ser aceita (se alguma foi).
    if (ipOk) l.ip.undo(ipKey);
    if (emailOk) l.email.undo(email);
    return { blocked: true, release() {} };
  }
  let released = false;
  return {
    blocked: false,
    release() {
      if (released) return;
      released = true;
      l.ip.undo(ipKey);
      l.email.undo(email);
    },
  };
}

// Cada cadastro tentado conta (criar conta em massa é o que se quer frear).
export function allowSignup(ip: string, limiter: Limiter = signupLimiter()): boolean {
  return limiter.hit(ipBucket(ip));
}
