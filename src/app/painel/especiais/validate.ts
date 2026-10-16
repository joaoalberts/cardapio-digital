// Formulário de produto especial (oferta relâmpago): confere e monta a linha do banco.
// Puro (sem rede), para testar; as ações do painel usam antes de gravar.
import { SPECIAL_LIMITS, SPECIAL_MAX_TIMES } from "@/lib/menu/specials";

export type SpecialInput = {
  id?: string;
  name: string;
  description: string;
  priceCents: number;
  promoCents: number;
  everyH: number;
  showS: number;
  days: number[];
  from: string | null;
  to: string | null;
  limit: number;
  active: boolean;
  // "Nos horários marcados" (no lugar de "a cada X horas"): a oferta passa só nesses horários.
  useTimes?: boolean;
  times?: string[];
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const clean = (s: unknown, max: number) => String(s ?? "").trim().slice(0, max);
const between = (n: number, [min, max]: readonly [number, number]) => Number.isFinite(n) && n >= min && n <= max;

export function validateSpecial(input: SpecialInput): { ok: true; row: Record<string, unknown> } | { ok: false; error: string } {
  const name = clean(input.name, 80);
  const description = clean(input.description, 500);
  const price = Math.round(Number(input.priceCents));
  const promo = input.promoCents == null ? NaN : Math.round(Number(input.promoCents));
  if (!name) return { ok: false, error: "Dê um nome para o produto especial." };
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(promo) || promo < 0 || promo >= price) {
    return { ok: false, error: "O preço da oferta precisa ser menor que o preço normal." };
  }
  const showS = Number(input.showS);
  if (!between(showS, SPECIAL_LIMITS.show_s)) return { ok: false, error: "O tempo na tela vai de 4 a 15 segundos." };
  const everyH = Number(input.everyH);
  if (!between(everyH, SPECIAL_LIMITS.every_h)) return { ok: false, error: "O intervalo vai de meia hora a 24 horas." };
  const limit = Number(input.limit);
  if (!Number.isInteger(limit) || !between(limit, SPECIAL_LIMITS.limit)) return { ok: false, error: "O limite vai de 1 a 10 por oferta." };
  const from = input.from && HHMM.test(input.from) ? input.from : null;
  const to = input.to && HHMM.test(input.to) ? input.to : null;
  if (!!from !== !!to) return { ok: false, error: "Preencha o horário de início e de fim, ou deixe os dois vazios." };
  const days = [...new Set((input.days ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  const times = input.useTimes ? [...new Set((input.times ?? []).filter((t) => HHMM.test(t)))].sort().slice(0, SPECIAL_MAX_TIMES) : [];
  if (input.useTimes && !times.length) return { ok: false, error: 'Adicione pelo menos um horário, ou escolha "a cada X horas".' };

  return {
    ok: true,
    row: {
      name,
      description,
      price_cents: price,
      promo_price_cents: promo,
      special_every_h: everyH,
      special_show_s: Math.round(showS),
      special_days: days,
      special_from: times.length ? null : from, // com horários marcados, o de/até não vale
      special_to: times.length ? null : to,
      special_limit: limit,
      special_times: times,
      active: !!input.active,
      price_options: null,
      featured: false,
      hide_price: false,
    },
  };
}
