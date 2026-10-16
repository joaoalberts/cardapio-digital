// Regras do cliente da Comunidade (balão, Palco, Mural, "Pedir também") em funções puras,
// para os componentes só desenharem. Nada aqui fala com a rede nem com o localStorage.
import { formatTime, inWindow } from "@/lib/menu/hours";
import { thumbSrc } from "@/lib/menu/media";
import type { MenuItem, PublicMenu } from "@/lib/menu/types";
import { ct, ctf } from "./i18n";
import type { OptionId, PollTemplate, PublicOption } from "./types";

// ---------- Balão na capa ----------

// Faixa livre mínima para o balão completo (spec). A ficha do protótipo manda o balão caber
// inteiro com 8 px de folga em cima e embaixo, então quem chama passa a altura que precisa.
export const BALLOON_MIN_BAND = 96;
// Altura do balão grande na ficha: enquete 106 + 12 de ponta; Mural 122.
export const BALLOON_H = { poll: 118, mural: 122 } as const;
export const BALLOON_GAP = 8;
export const balloonNeed = (kind: keyof typeof BALLOON_H) => BALLOON_H[kind] + 2 * BALLOON_GAP;

export function balloonMode(freeBandPx: number, needPx: number = BALLOON_MIN_BAND): "full" | "compact" {
  const need = Math.max(BALLOON_MIN_BAND, needPx);
  return Number.isFinite(freeBandPx) && freeBandPx >= need ? "full" : "compact";
}

// ---------- Destaque da casa ----------

const hasPrice = (i: MenuItem) =>
  !i.hide_price && (i.price_options?.length ? i.price_options.some((o) => o.price_cents > 0) : (i.promo_price_cents ?? i.price_cents) > 0);

// O primeiro prato marcado como destaque (★) que tenha preço e esteja no horário agora; sem
// nenhum, o primeiro prato com foto. Substitui "o mais pedido hoje" na fase 1a.
export function houseHighlight(menu: PublicMenu, now: Date): MenuItem | null {
  const tz = menu.restaurant.timezone;
  const items = menu.categories
    .filter((c) => inWindow(c.available_from, c.available_to, tz, now))
    .flatMap((c) => c.items)
    .filter((i) => !i.special);
  return items.find((i) => i.featured && hasPrice(i)) ?? items.find((i) => thumbSrc(i) !== null) ?? null;
}

// ---------- "Pedir também" ----------

export type BuyState = "hidden" | "unavailable" | "in_cart" | "buy";

// Mesma regra do "Pedir" do story: some sem pedido ligado (sem mesa), com preço escondido ou
// no meio da escolha da outra metade. linked = há um prato ligado (opção da enquete só com o
// texto da casa, como no modelo Música, não tem): sem prato ligado, o botão some. Prato
// ligado que saiu do cardápio vira "indisponível".
export function buyState(
  item: MenuItem | undefined,
  o: { linked: boolean; enabled: boolean; pick: boolean; inCart: number },
): BuyState {
  if (!o.linked || !o.enabled || o.pick) return "hidden";
  if (!item) return "unavailable";
  if (item.hide_price) return "hidden";
  return o.inCart > 0 ? "in_cart" : "buy";
}

// ---------- Tempo ----------

// "agora", "há 5 min", "há 2 h", "há 3 d". Relógio do celular adiantado conta como agora.
export function relativeTime(iso: string, now: Date, lang: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const ms = Math.max(0, now.getTime() - t);
  if (ms < 60_000) return ct("relNow", lang);
  if (ms < 3_600_000) return ctf("relMin", lang, { n: Math.floor(ms / 60_000) });
  if (ms < 86_400_000) return ctf("relH", lang, { n: Math.floor(ms / 3_600_000) });
  return ctf("relD", lang, { n: Math.floor(ms / 86_400_000) });
}

// Consulta da leitura agregada: 12 s com a camada aberta, 60 s só com o balão, parada com a
// aba escondida (null).
export function pollDelay(open: boolean, visible: boolean): number | null {
  if (!visible) return null;
  return open ? 12_000 : 60_000;
}

// "1:42"; arredonda para cima, para "0:00" só aparecer quando acabou. Com 1 h ou mais (enquete
// agendada longa), "3h47", que ainda cabe no anel de 36 px.
export function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// O que falta, o total e o ângulo do anel (360° = o tempo todo pela frente).
export function pollTiming(p: { starts_at: string; ends_at: string }, nowMs: number) {
  const start = Date.parse(p.starts_at);
  const end = Date.parse(p.ends_at);
  const total = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
  const left = total ? Math.min(total, Math.max(0, end - nowMs)) : 0;
  const angle = total ? Math.round((left / total) * 3600) / 10 : 0;
  return { left, total, angle };
}

// Diferença entre o relógio do servidor e o do celular. Até 2 min conta como certo (a resposta
// pode vir da CDN com alguns segundos); passou disso, o celular está com a hora errada.
export const SKEW_TOLERANCE_MS = 120_000;
export function clockSkew(serverIso: string, deviceMs: number): number {
  const t = Date.parse(serverIso);
  if (!Number.isFinite(t)) return 0;
  const d = t - deviceMs;
  return Math.abs(d) <= SKEW_TOLERANCE_MS ? 0 : d;
}

// Hora no fuso do restaurante, no jeito da língua ("21h", "9 PM").
export function localTime(iso: string, timezone: string, lang: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
  return formatTime(hhmm, lang);
}

// ---------- Enquete ----------

const TEMPLATE_KEY = { dessert: "tplDessert", drink: "tplDrink", music: "tplMusic" } as const;

// Nos modelos, o cliente lê a pergunta traduzida; na personalizada, o texto da casa.
export function questionText(p: { template: PollTemplate; question: string }, lang: string): string {
  return p.template === "custom" ? p.question : ct(TEMPLATE_KEY[p.template], lang);
}

// Porcentagens na tela. Com votos no servidor, as dele. O primeiro voto da enquete ainda não
// chegou ao placar (CDN de até 8 s): 100% na opção votada, sem inventar contagem.
export function shownPcts(p: { has_votes: boolean; options: PublicOption[] }, mine: OptionId | null): Record<OptionId, number> {
  const out = {} as Record<OptionId, number>;
  for (const o of p.options) out[o.id] = p.has_votes ? o.pct : mine === o.id ? 100 : 0;
  return out;
}

// A opção que lidera (no empate, a primeira); tudo zero, nenhuma.
export function leaderOf(pcts: Partial<Record<OptionId, number>>): OptionId | null {
  let best: OptionId | null = null;
  let max = 0;
  for (const [id, v] of Object.entries(pcts) as [OptionId, number][]) {
    if (v > max) {
      max = v;
      best = id;
    }
  }
  return best;
}

// ---------- Mural ----------

// Mosaico de 2 colunas desencontradas: na esquerda 4:5, 1:1, 4:5…; na direita 1:1, 4:5…
// (a coluna da direita ainda desce 44 px no CSS). i = posição original (atraso da entrada).
export function muralColumns<T>(posts: T[]) {
  const left: { post: T; ar: string; i: number }[] = [];
  const right: { post: T; ar: string; i: number }[] = [];
  posts.forEach((post, i) => {
    const col = i % 2 === 0 ? left : right;
    const k = col.length;
    const tall = i % 2 === 0 ? k % 2 === 0 : k % 2 === 1;
    col.push({ post, ar: tall ? "4 / 5" : "1 / 1", i });
  });
  return { left, right };
}

// ---------- Chegada ----------

// De onde a pessoa veio: QR do telão ou do story (contado no funil uma vez por carga).
export function refFrom(search: string): "telao" | "story" | null {
  const r = new URLSearchParams(search).get("ref");
  return r === "telao" || r === "story" ? r : null;
}
