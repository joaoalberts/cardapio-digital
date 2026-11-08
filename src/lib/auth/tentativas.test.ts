import { describe, expect, it } from "vitest";
import { createLimiter } from "@/lib/limiter";
import { allowSignup, ipBucket, reserveLogin } from "./tentativas";

const MIN = 60_000;
function setup() {
  let t = 0;
  const now = () => t;
  return {
    advance: (ms: number) => (t += ms),
    login: { ip: createLimiter({ max: 10, windowMs: 10 * MIN, now }), email: createLimiter({ max: 5, windowMs: 10 * MIN, now }) },
    signup: createLimiter({ max: 5, windowMs: 60 * MIN, now }),
  };
}

describe("reserveLogin", () => {
  it("6ª falha seguida no mesmo e-mail fica `blocked`, mesmo vinda de outro IP", () => {
    const s = setup();
    for (let i = 0; i < 5; i++) expect(reserveLogin(`1.1.1.${i}`, "a@b.com", s.login).blocked).toBe(false);
    expect(reserveLogin("9.9.9.9", "a@b.com", s.login).blocked).toBe(true);
    expect(reserveLogin("9.9.9.9", "outra@b.com", s.login).blocked).toBe(false);
  });

  it("11ª falha do mesmo IP fica `blocked`, com e-mails diferentes", () => {
    const s = setup();
    for (let i = 0; i < 10; i++) expect(reserveLogin("2.2.2.2", `u${i}@b.com`, s.login).blocked).toBe(false);
    expect(reserveLogin("2.2.2.2", "novo@b.com", s.login).blocked).toBe(true);
  });

  it("release devolve a tentativa: login certo não conta", () => {
    const s = setup();
    for (let i = 0; i < 20; i++) reserveLogin("3.3.3.3", "a@b.com", s.login).release();
    expect(s.login.ip.size()).toBe(0);
    expect(s.login.email.size()).toBe(0);
  });

  it("release duas vezes devolve só uma", () => {
    const s = setup();
    reserveLogin("4.4.4.4", "x@b.com", s.login); // falha que fica contada
    const r = reserveLogin("4.4.4.4", "x@b.com", s.login);
    r.release();
    r.release();
    for (let i = 0; i < 4; i++) expect(reserveLogin("4.4.4.4", "x@b.com", s.login).blocked).toBe(false);
    expect(reserveLogin("4.4.4.4", "x@b.com", s.login).blocked).toBe(true);
  });

  it("estourado não conta mais falhas: nem do IP nem do e-mail", () => {
    const s = setup();
    for (let i = 0; i < 5; i++) reserveLogin("5.5.5.5", "a@b.com", s.login);
    for (let i = 0; i < 20; i++) reserveLogin("5.5.5.5", "a@b.com", s.login).release();
    for (let i = 0; i < 5; i++) expect(reserveLogin("5.5.5.5", `n${i}@b.com`, s.login).blocked).toBe(false);
  });

  it("depois de 10 minutos libera de novo", () => {
    const s = setup();
    for (let i = 0; i < 5; i++) reserveLogin("6.6.6.6", "a@b.com", s.login);
    expect(reserveLogin("6.6.6.6", "a@b.com", s.login).blocked).toBe(true);
    s.advance(10 * MIN);
    expect(reserveLogin("6.6.6.6", "a@b.com", s.login).blocked).toBe(false);
  });
});

describe("allowSignup", () => {
  it("5 contas por hora por IP; a 6ª é barrada e outro IP segue livre", () => {
    const s = setup();
    for (let i = 0; i < 5; i++) expect(allowSignup("7.7.7.7", s.signup)).toBe(true);
    expect(allowSignup("7.7.7.7", s.signup)).toBe(false);
    expect(allowSignup("8.8.8.8", s.signup)).toBe(true);
    s.advance(60 * MIN);
    expect(allowSignup("7.7.7.7", s.signup)).toBe(true);
  });
});

describe("ipBucket", () => {
  it("IPv6 vira o /64 (com ou sem ::); IPv4 e anon ficam", () => {
    expect(ipBucket("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(ipBucket("2001:0DB8:0001:0002::1")).toBe("2001:db8:1:2::/64");
    expect(ipBucket("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipBucket("::1")).toBe("0:0:0:0::/64");
    expect(ipBucket("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(ipBucket("203.0.113.9")).toBe("203.0.113.9");
    expect(ipBucket("anon")).toBe("anon");
  });

  it("trocar o fim do endereço IPv6 não escapa do limite por IP", () => {
    const s = setup();
    for (let i = 0; i < 10; i++) expect(reserveLogin(`2001:db8:1:2::${i + 1}`, `u${i}@b.com`, s.login).blocked).toBe(false);
    expect(reserveLogin("2001:db8:1:2::ffff", "novo@b.com", s.login).blocked).toBe(true);
    expect(reserveLogin("2001:db8:1:3::1", "novo@b.com", s.login).blocked).toBe(false);
  });
});
