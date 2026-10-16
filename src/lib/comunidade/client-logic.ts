// Regras do cliente da Comunidade (balão, Palco, Mural, "Pedir também") em funções puras,
// para os componentes só desenharem. Nada aqui fala com a rede nem com o localStorage.
import { formatTime, inWindow } from "@/lib/menu/hours";
import { thumbSrc } from "@/lib/menu/media";
import type { MenuItem, PublicMenu } from "@/lib/menu/types";
import { buildIndex, itemPrice, resolveLine } from "@/lib/orders/pricing";
import { ct, ctf } from "./i18n";
import type { OptionId, PollTemplate, PublicOption, PublicState } from "./types";

// ---------- Balão na capa ----------

// Faixa livre mínima para o balão completo (spec). A ficha do protótipo manda o balão caber
// inteiro com 8 px de folga em cima e embaixo, então quem chama passa a altura que precisa.
export const BALLOON_MIN_BAND = 96;
// Altura do balão grande na ficha v2, já com a ponta de 12 px: enquete 119 (pergunta em 2
// linhas), Mural 123. Cabe quando a faixa livre tem o balão + 16 px.
export const BALLOON_H = { poll: 119, mural: 123 } as const;
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

// O carrinho aceitaria este prato agora? Mesma regra do priceCart (pricing.ts): produto
// especial (oferta relâmpago) só entra pela oferta, e prato de categoria fora do horário é
// recusado (closed_category). Tamanho ainda não escolhido não conta: a folha do prato escolhe.
export function orderableNow(menu: PublicMenu, itemId: string, now: Date): boolean {
  if (menu.specials?.items.some((i) => i.id === itemId)) return false;
  const r = resolveLine(buildIndex(menu), { item: itemId, option: null, half: null }, now);
  return r.ok || (r.reason !== "unavailable" && r.reason !== "closed_category");
}

// Mesma regra do "Pedir" do story: some sem pedido ligado (sem mesa), com preço escondido ou
// no meio da escolha da outra metade. linked = há um prato ligado (opção da enquete só com o
// texto da casa, como no modelo Música, não tem): sem prato ligado, o botão some. Prato
// ligado que saiu do cardápio, especial ou de categoria fora do horário (pelo relógio now,
// que anda a cada minuto) vira "indisponível hoje", como o carrinho recusaria.
export function buyState(
  item: MenuItem | undefined,
  o: { linked: boolean; enabled: boolean; pick: boolean; inCart: number; menu: PublicMenu | null; now: Date },
): BuyState {
  if (!o.linked || !o.enabled || o.pick) return "hidden";
  if (!item) return "unavailable";
  if (item.hide_price) return "hidden";
  if (!o.menu || !orderableNow(o.menu, item.id, o.now)) return "unavailable";
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

// Relógio do provider: o minuto cheio (ms) do relógio corrigido e quanto falta para o
// próximo. É o "agora" do destaque da casa e do "Pedir também", que muda de categoria no
// horário mesmo sem a leitura mudar (o v só muda quando a Comunidade muda).
export const MINUTE_MS = 60_000;
export function minuteClock(ms: number): { minute: number; next: number } {
  const minute = Math.floor(ms / MINUTE_MS) * MINUTE_MS;
  return { minute, next: minute + MINUTE_MS - ms };
}

// Consulta da leitura agregada. enabled = a última resposta (null antes da primeira):
// - aba escondida: parada (null);
// - Comunidade desligada (enabled:false): a cada 10 min, para não gastar Edge Requests nas
//   casas que não usam a Comunidade; a resposta que vier ligada volta ao ritmo normal;
// - senão, 12 s com a camada aberta e 60 s só com o balão.
export const POLL_OPEN_MS = 12_000;
export const POLL_BALLOON_MS = 60_000;
export const POLL_OFF_MS = 10 * 60_000;
export function pollDelay(o: { open: boolean; visible: boolean; enabled: boolean | null }): number | null {
  if (!o.visible) return null;
  if (o.enabled === false) return POLL_OFF_MS;
  return o.open ? POLL_OPEN_MS : POLL_BALLOON_MS;
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

// Página de revista (ficha v2, tela 10): a foto mais nova grande (1:1); depois duas quadradas
// lado a lado e uma larga (16:10), repetindo. Uma quadrada que sobraria sozinha vira larga.
// i = posição da primeira foto do bloco (atraso do reflexo).
export type MuralBlock<T> = { kind: "big" | "pair" | "wide"; posts: T[]; i: number };
export function muralLayout<T>(posts: T[]): MuralBlock<T>[] {
  if (!posts.length) return [];
  const out: MuralBlock<T>[] = [{ kind: "big", posts: [posts[0]], i: 0 }];
  let i = 1;
  while (i < posts.length) {
    if (i + 1 < posts.length) {
      out.push({ kind: "pair", posts: [posts[i], posts[i + 1]], i });
      i += 2;
    }
    if (i < posts.length) {
      out.push({ kind: "wide", posts: [posts[i]], i });
      i += 1;
    }
  }
  return out;
}

// ---------- Comunidade v2: Palco e "Pedir também" ----------

// Anel do tempo (ficha v2: "41 min"): minutos arredondados para cima; no último minuto, os
// segundos; com 1 h ou mais, "3h47" sem unidade (cabe no anel de 38 px).
export function ringText(ms: number): { n: string; unit: "min" | "s" | "" } {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) return { n: `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`, unit: "" };
  if (s >= 60) return { n: String(Math.ceil(s / 60)), unit: "min" };
  return { n: String(s), unit: "s" };
}

// Resultado de uma enquete encerrada. Venceu só com 1 ponto ou mais de diferença; senão é
// empate entre as que dividem o topo. rest = as outras, da maior para a menor.
export type PollOutcome = { kind: "none" } | { kind: "win"; id: OptionId; rest: OptionId[] } | { kind: "tie"; ids: OptionId[]; rest: OptionId[] };
export function pollOutcome(p: { has_votes: boolean; options: PublicOption[] }): PollOutcome {
  if (!p.has_votes || !p.options.length) return { kind: "none" };
  const top = Math.max(...p.options.map((o) => o.pct));
  const ids = p.options.filter((o) => top - o.pct < 1).map((o) => o.id);
  const rest = p.options.filter((o) => !ids.includes(o.id)).sort((a, b) => b.pct - a.pct).map((o) => o.id);
  return ids.length === 1 ? { kind: "win", id: ids[0], rest } : { kind: "tie", ids, rest };
}

// A barra acesa (cor da casa) durante a enquete: só a líder sozinha; empate no topo ou tudo
// zero, nenhuma.
export function soleLeader(pcts: Partial<Record<OptionId, number>>): OptionId | null {
  const e = Object.entries(pcts) as [OptionId, number][];
  const max = Math.max(0, ...e.map(([, v]) => v));
  if (!(max > 0)) return null;
  const top = e.filter(([, v]) => max - v < 1);
  return top.length === 1 ? top[0][0] : null;
}

// Preço ao lado do nome do prato: com tamanhos, o menor ("a partir de" quando variam);
// preço escondido ou zero, nada.
export function priceInfo(item: MenuItem | undefined): { cents: number; from: boolean } | null {
  if (!item || item.hide_price) return null;
  if (item.price_options?.length) {
    const p = item.price_options.map((o) => o.price_cents).filter((c) => c > 0);
    if (!p.length) return null;
    return { cents: Math.min(...p), from: new Set(p).size > 1 };
  }
  const c = item.promo_price_cents ?? item.price_cents;
  return c > 0 ? { cents: c, from: false } : null;
}

// Tamanhos da folha de tamanhos (label null = prato sem tamanhos, a inteira).
export function sizeChoices(item: MenuItem): { label: string | null; cents: number }[] {
  if (item.price_options?.length) {
    return item.price_options.flatMap((o) => {
      const c = itemPrice(item, o.label);
      return c == null ? [] : [{ label: o.label, cents: c }];
    });
  }
  const c = itemPrice(item, null);
  return c == null ? [] : [{ label: null, cents: c }];
}

// Sabores que podem ser a outra metade (mesma regra da folha do prato e do canPair):
// mesma categoria, outro prato, com preço no tamanho escolhido.
export function halfPartners(menu: PublicMenu | null, item: MenuItem, option: string | null): MenuItem[] {
  if (!menu || !item.half_half) return [];
  const cat = menu.categories.find((c) => c.id === item.category_id);
  return (cat?.items ?? []).filter((p) => p.id !== item.id && !p.hide_price && itemPrice(p, option) != null);
}

// "Pedir também": entra direto (prato simples, ou com um tamanho só e sem meio a meio
// possível) ou abre a folha de tamanhos dentro da Comunidade.
export function buyFlow(item: MenuItem, menu: PublicMenu | null): { kind: "add"; option: string | null } | { kind: "sheet" } {
  const sizes = sizeChoices(item);
  const half = item.half_half && sizes.some((s) => halfPartners(menu, item, s.label).length > 0);
  if (!half && sizes.length <= 1) return { kind: "add", option: sizes[0]?.label ?? null };
  return { kind: "sheet" };
}

// Meio a meio começado na Comunidade: ela volta quando a escolha acaba e nenhuma folha do
// pedido está aberta (montou e fechou o pedido, ou desistiu).
export function cmuReturnDue(o: { waiting: boolean; pick: boolean; sheet: boolean }): boolean {
  return o.waiting && !o.pick && !o.sheet;
}

// Capa do Palco: tríptico com as fotos das opções; se alguma opção não tem foto (ex.: música),
// a capa da casa (null).
export function stageCover(photos: (string | null)[]): string[] | null {
  return photos.length >= 2 && photos.every((p): p is string => !!p) ? photos : null;
}

// "Vote: qual prato sai…" na pílula; o alemão mantém a maiúscula dos substantivos.
export function lowerFirst(text: string, lang: string): string {
  if (lang.startsWith("de")) return text;
  const i = text.search(/\p{L}/u);
  return i < 0 ? text : text.slice(0, i) + text[i].toLocaleLowerCase(lang) + text.slice(i + 1);
}

// Contorno do balão da capa com a ponta (clip-path: path(), para o desfoque seguir a ponta).
// w × h é o corpo; a ponta tem base tw e altura th, no meio de baixo.
export function balloonPath(w: number, h: number, r: number, tw: number, th: number): string {
  const c = w / 2;
  return `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w} ${r}V${h - r}A${r} ${r} 0 0 1 ${w - r} ${h}H${c + tw / 2}L${c + 3} ${h + th - 2}Q${c} ${h + th} ${c - 3} ${h + th - 2}L${c - tw / 2} ${h}H${r}A${r} ${r} 0 0 1 0 ${h - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`;
}

// ---------- Story ----------

// O que a folha "Compartilhar no story" oferece (ids para a rota do cartão):
// - a enquete, se tem votos e esta pessoa já vê o resultado (votou, não tem mesa ou ela
//   encerrou): a arte com as porcentagens não aparece antes do voto;
// - uma foto da casa de prato ainda no cardápio: a pedida (foto aberta no Mural), senão a do
//   destaque da casa, senão a mais nova.
export function storyChoices(
  s: PublicState | null,
  o: { mine: OptionId | null; canVote: boolean; highlightId: string | null; hasItem: (id: string) => boolean; post?: string | null },
): { poll: string | null; post: string | null } {
  if (!s?.enabled) return { poll: null, post: null };
  const p = s.poll;
  const poll = p && p.has_votes && (p.closed || !!o.mine || !o.canVote) ? p.id : null;
  const ok = s.mural.filter((x) => o.hasItem(x.item_id));
  const post =
    ok.find((x) => x.id === o.post) ?? (o.highlightId ? ok.find((x) => x.item_id === o.highlightId) : undefined) ?? ok[0] ?? null;
  return { poll, post: post?.id ?? null };
}

// ---------- Chegada ----------

// De onde a pessoa veio: QR do telão ou do story (contado no funil uma vez por carga).
export function refFrom(search: string): "telao" | "story" | null {
  const r = new URLSearchParams(search).get("ref");
  return r === "telao" || r === "story" ? r : null;
}

// ---------- Telão ----------

// O telão lê a mesma resposta da CDN que os celulares, a cada 4 s. Caiu a rede: tenta de
// novo em 4, 8, 16 e 30 s (máximo), mantendo o último estado na tela.
export const TV_POLL_MS = 4_000;
const TV_BACKOFF_MAX_MS = 30_000;
export function backoff(failures: number): number {
  if (!(failures > 0)) return TV_POLL_MS; // 0, negativo ou NaN
  return Math.min(TV_BACKOFF_MAX_MS, TV_POLL_MS * 2 ** Math.floor(failures));
}

// O que o telão mostra: nada da Comunidade se ela está desligada (ou sem estado); as barras
// com enquete aberta, ou encerrada com votos (a vencedora, pelos 15 min em que ela fica no
// estado); senão as fotos da casa, o destaque e a próxima enquete.
export type TvMode = "off" | "poll" | "idle";
export function tvMode(s: PublicState | null): TvMode {
  if (!s || !s.enabled) return "off";
  if (s.poll && (!s.poll.closed || s.poll.has_votes)) return "poll";
  return "idle";
}

// Pergunta do telão: 62 px numa linha; se quebra em mais de uma, passa a 46 px (.long) para
// as barras não descerem sobre o aviso do QR. Decide pela altura medida a 62 px, não pelo
// número de letras: a largura muda com a língua, com as letras e com a fonte. Uma linha tem
// cerca de 1,04 × o tamanho da fonte; duas, 2,08. Sem medida, fica nos 62 px.
export function tvQuestionLong(height: number, fontPx: number): boolean {
  if (!(height > 0) || !(fontPx > 0)) return false;
  return height > fontPx * 1.5;
}

// Código de pareamento guardado na TV (localStorage tl-code:<slug>): { code, exp, hash }, com
// exp no relógio da própria TV e hash = SHA-256 do segredo que pediu o código. Na recarga, a
// TV mostra o mesmo código sem pedir outro (o pedido novo gasta o limite por IP da rota).
// Renova só depois de vencer, com 1 s de folga: antes disso o servidor devolveria o mesmo.
export type SavedPairCode = { code: string; exp: number };
export const PAIR_RENEW_GRACE_MS = 1_000;
// O servidor dá 10 min; um prazo maior que 11 min daqui é relógio mexido ou lixo.
const PAIR_SAVED_MAX_MS = 11 * 60_000;
const PAIR_CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export function pairCodeDue(c: SavedPairCode | null, nowMs: number): boolean {
  return !c || nowMs >= c.exp + PAIR_RENEW_GRACE_MS;
}

export function pairCodeRecord(c: SavedPairCode, hash: string): string {
  return JSON.stringify({ code: c.code, exp: c.exp, hash });
}

export function savedPairCode(raw: string | null, hash: string, nowMs: number): SavedPairCode | null {
  if (!raw || !HEX64.test(hash)) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const { code, exp, hash: h } = v as Record<string, unknown>;
  if (h !== hash || typeof code !== "string" || !PAIR_CODE.test(code) || typeof exp !== "number" || !Number.isFinite(exp)) return null;
  const c = { code, exp };
  if (pairCodeDue(c, nowMs) || exp - nowMs > PAIR_SAVED_MAX_MS) return null;
  return c;
}

// A página do telão recarrega sozinha a cada 3 h, nunca no meio de uma enquete aberta.
export const TV_RELOAD_MS = 3 * 60 * 60_000;
export function tvReloadDue(loadedAt: number, now: number, pollOpen: boolean): boolean {
  return !pollOpen && now - loadedAt >= TV_RELOAD_MS;
}

// Sinal sonoro quando abre uma enquete nova. prev: a enquete aberta da leitura anterior
// (undefined = ainda não houve leitura, então a que já estava aberta ao ligar não toca;
// null = não havia enquete aberta).
export function pollChime(prev: string | null | undefined, s: PublicState | null): { open: string | null; chime: boolean } {
  const open = s?.enabled && s.poll && !s.poll.closed ? s.poll.id : null;
  return { open, chime: prev !== undefined && open !== null && open !== prev };
}
