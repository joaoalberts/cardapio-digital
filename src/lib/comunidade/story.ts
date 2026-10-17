// Cartão do story 9:16 da Comunidade (ficha do protótipo: telas 15 e 16), na parte sem I/O:
// qual enquete ou foto da casa vira arte, os textos, a foto, a cor e o cache da CDN. A rota
// api/comunidade/[slug]/story lê o banco, as imagens e desenha o PNG com o next/og.
// Regras: o restaurante vem do slug; só o resultado em porcentagem (nunca contagem, device
// nem mesa) ou uma foto aprovada da casa; Comunidade desligada não gera arte.
import { mediaUrl, posterSrc } from "@/lib/menu/media";
import type { MenuItem, PublicMenu } from "@/lib/menu/types";
import { houseHighlight, leaderOf, questionText } from "./client-logic";
import { pollPhase } from "./clock";
import { ct, ctf } from "./i18n";
import { communityOff } from "./off";
import { needsFreshResult, publicPoll } from "./public-state";
import type { CommunityHead, OptionId, PollRow, PostRow, PublicPoll, TvRow, VoteRow } from "./types";

// Enquete aberta: o resultado ainda muda, 60 s na CDN. Encerrada: 1 dia. Foto da casa: 1 h,
// porque a casa pode ocultar a foto no painel e a arte não deve circular por um dia depois.
export const STORY_CACHE_LIVE = "public, max-age=0, s-maxage=60";
export const STORY_CACHE_DONE = "public, max-age=0, s-maxage=86400";
export const STORY_CACHE_POST = "public, max-age=0, s-maxage=3600";
// Enquete de antes da virada do dia ainda sem result no banco (o cron não rodou ou falhou):
// sem arte (404) por 10 s, para a arte certa sair logo que o result for gravado.
export const STORY_CACHE_PENDING = "public, max-age=0, s-maxage=10";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Cor padrão do cardápio (menu.css, --accent) quando a casa não escolheu uma.
const DEFAULT_ACCENT = "#e8b04b";

// poll: a enquete com as porcentagens, e o nome de cada opção já resolvido pelo cardápio
// (label); photo: a foto da vencedora (ou de quem lidera, com a enquete aberta).
// post: a foto da casa, o nome do prato e se ele é o destaque da casa agora.
// lang: o idioma do cardápio em que a arte sai.
export type StorySource =
  | { kind: "poll"; head: CommunityHead; poll: PublicPoll; photo: string | null; thumbs: Partial<Record<OptionId, string | null>>; lang: string }
  | { kind: "post"; head: CommunityHead; post: PostRow; itemName: string; featured: boolean; lang: string };

export type StoryDeps = {
  getHead: (slug: string) => Promise<CommunityHead | null>;
  getContent: (rid: string) => Promise<{ polls: PollRow[]; posts: PostRow[]; tvs: TvRow[] }>;
  getVotes: (pollId: string) => Promise<VoteRow[]>;
  // A linha da enquete lida direto do banco, sem cache (ver needsFreshResult).
  getPoll: (pollId: string) => Promise<PollRow | null>;
  getMenu: (slug: string) => Promise<PublicMenu | null>;
  now?: () => Date;
  off?: () => boolean;
};

// Só ?poll= ou ?post=, uma vez cada. Qualquer outro parâmetro (ou repetido) é recusado: cada
// variação da URL seria um PNG novo desenhado pela função em vez de servido pela CDN.
export function parseStoryQuery(sp: URLSearchParams): { poll: string | null; post: string | null } | null {
  const keys = [...sp.keys()];
  if (keys.some((k) => k !== "poll" && k !== "post")) return null;
  if (new Set(keys).size !== keys.length) return null;
  return { poll: sp.get("poll"), post: sp.get("post") };
}

function itemsOf(menu: PublicMenu | null): Map<string, MenuItem> {
  const out = new Map<string, MenuItem>();
  if (!menu) return out;
  for (const c of menu.specials ? [...menu.categories, menu.specials] : menu.categories) {
    for (const i of c.items) if (!out.has(i.id)) out.set(i.id, i);
  }
  return out;
}

// Foto do prato para o fundo da arte: a foto inteira (não a miniatura); vídeo, a capa
// escolhida ou, sem ela, o quadro do Mux em JPEG.
export function storyPhoto(item: MenuItem | undefined): string | null {
  const m = item?.media[0];
  if (!m) return null;
  if (m.kind === "photo") return mediaUrl(m.storage_path) ?? mediaUrl(m.poster_path);
  const poster = mediaUrl(m.poster_path);
  if (poster) return poster;
  return m.mux_playback_id && /^[A-Za-z0-9]+$/.test(m.mux_playback_id)
    ? `https://image.mux.com/${m.mux_playback_id}/thumbnail.jpg?width=1080`
    : null;
}

export async function resolveStory(
  d: StoryDeps,
  slug: string,
  q: { poll?: string | null; post?: string | null },
): Promise<StorySource | "pending" | null> {
  const pollId = q.poll ?? null;
  const postId = q.post ?? null;
  if ((pollId === null) === (postId === null)) return null; // exatamente um dos dois
  const id = (pollId ?? postId) as string;
  if (!UUID.test(id)) return null;
  if ((d.off ?? communityOff)()) return null;
  const head = await d.getHead(slug);
  if (!head?.enabled) return null;
  const now = d.now?.() ?? new Date();
  const { polls, posts } = await d.getContent(head.id);

  if (pollId) {
    // Da agenda em cache (terminadas há até 24 h ou futuras), só deste restaurante. Agendada
    // ou sem votos não tem resultado para mostrar.
    let row = polls.find((p) => p.id === pollId && p.restaurant_id === head.id);
    if (!row || pollPhase(row, now) === "scheduled") return null;
    // Votos de antes da virada podem já ter saído: só com o result da linha lida na hora.
    // Ainda sem ele, "pending" (404 de cache curto), nunca a conta com os votos que sobraram.
    if (needsFreshResult(row, head, now)) {
      const fresh = await d.getPoll(row.id);
      if (!fresh?.result || fresh.id !== row.id || fresh.restaurant_id !== head.id) return "pending";
      row = fresh;
    }
    // Com o result gravado pelo cron (os votos duram 1 dia), nem lê os votos.
    const votes = row.result ? [] : (await d.getVotes(row.id)).filter((v) => v.restaurant_id === head.id && v.poll_id === row.id);
    const pub = publicPoll(row, votes, now);
    if (!pub.has_votes) return null;
    const menu = await d.getMenu(head.slug);
    const lang = menu?.restaurant.language || "pt-BR";
    const items = itemsOf(menu);
    // O nome de cada opção como o cliente lê no Palco: o prato no cardápio; sem ele, o texto da casa.
    const options = pub.options.map((o) => ({
      ...o,
      label: (o.item_id ? items.get(o.item_id)?.name : undefined) || o.label || ct("unavailable", lang),
    }));
    const lead = storyLead(pub);
    const leadOpt = pub.options.find((o) => o.id === lead);
    const photo = leadOpt?.item_id ? storyPhoto(items.get(leadOpt.item_id)) : null;
    // Miniatura de cada opção (as perdedoras aparecem ao lado do %); opção sem prato, nada.
    const thumbs = Object.fromEntries(pub.options.map((o) => [o.id, o.item_id ? storyThumb(items.get(o.item_id)) : null]));
    return { kind: "poll", head, poll: { ...pub, options }, photo, thumbs, lang };
  }

  // Foto da casa: só aprovada e deste restaurante, e o prato ainda no cardápio.
  const post = posts.find((p) => p.id === postId && p.restaurant_id === head.id && p.status === "approved");
  if (!post) return null;
  const menu = await d.getMenu(head.slug);
  const item = itemsOf(menu).get(post.item_id);
  if (!menu || !item) return null;
  const featured = houseHighlight(menu, now)?.id === item.id;
  return { kind: "post", head, post, itemName: item.name, featured, lang: menu.restaurant.language || "pt-BR" };
}

// A opção em destaque na arte: a vencedora; com a enquete aberta, a que lidera agora (no
// empate, a primeira).
export function storyLead(p: PublicPoll): OptionId | null {
  if (p.closed) return p.winner;
  return leaderOf(Object.fromEntries(p.options.map((o) => [o.id, o.pct])) as Partial<Record<OptionId, number>>);
}

export function storyCache(src: StorySource, now: Date): string {
  if (src.kind === "post") return STORY_CACHE_POST;
  if (!src.poll.closed && Date.parse(src.poll.ends_at) > now.getTime()) return STORY_CACHE_LIVE;
  return STORY_CACHE_DONE;
}

// Textos da arte (ficha v2, tela 16), no idioma do cardápio. Enquete: rótulo, a pergunta em
// itálico e "Deu X" (aberta: "X na frente"). Foto da casa: "Saindo agora da cozinha" e o
// prato. O rodapé fala com quem não está na casa: "Vem pro <nome da casa>" e o convite do QR.
export type StoryTexts = { kicker: string; question: string | null; title: string; sub: string | null; come: string; point: string };
export function storyTexts(src: StorySource): StoryTexts {
  const L = src.lang;
  const come = ctf("artCome", L, { name: src.head.name.trim() || src.head.slug });
  const point = ct("artPoint", L);
  if (src.kind === "poll") {
    const lead = storyLead(src.poll);
    const name = src.poll.options.find((o) => o.id === lead)?.label ?? "";
    return {
      kicker: ct(src.poll.closed ? "artPollClosed" : "artPollLive", L),
      question: questionText(src.poll, L),
      title: ctf(src.poll.closed ? "won" : "artLeads", L, { name }),
      sub: null,
      come,
      point,
    };
  }
  return { kicker: ct("artKitchen", L), question: null, title: src.itemName, sub: src.featured ? ct("highlightLower", L) : null, come, point };
}

// Tamanho do "Deu X" (ou do nome do prato) na arte: 124 px até 16 letras, 104 até 25, depois 84
// (em até duas linhas, a coluna tem 912 px).
export function storyTitleSize(title: string): number {
  const n = title.trim().length;
  return n <= 16 ? 124 : n <= 25 ? 104 : 84;
}

// Tamanho do "Vem pro <casa>" no rodapé (coluna de 680 px ao lado do QR): 72 px numa linha
// até 16 letras; até 22, 60 px; acima, 52 px em até duas linhas, cortado em 44 letras.
const COME_MAX = 44;
export function storyComeSize(text: string): { text: string; size: number } {
  const t = text.trim();
  if (t.length <= 16) return { text: t, size: 72 };
  if (t.length <= 22) return { text: t, size: 60 };
  return { text: t.length > COME_MAX ? `${t.slice(0, COME_MAX - 1).trimEnd()}…` : t, size: 52 };
}

// Cor da marca em "#rrggbb"; qualquer outra coisa vira a cor padrão do cardápio (o valor
// vai para o estilo da arte, então só passa hexadecimal).
export function storyAccent(c: string | null | undefined): string {
  const v = (c ?? "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return DEFAULT_ACCENT;
}

// "#rrggbb" + opacidade → "rgba(r, g, b, a)" (o next/og não tem color-mix).
export function withAlpha(hex: string, a: number): string {
  const n = parseInt(storyAccent(hex).slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// @ do Instagram como o painel grava (só letras, números, ponto e _).
export function storyHandle(instagram: string | null | undefined): string | null {
  const h = (instagram ?? "").trim().replace(/^@+/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(h) ? `@${h}` : null;
}

// De onde a rota pode ler uma imagem da arte: arquivos públicos do Vercel Blob, do Supabase
// Storage (as fotos antigas guardam a URL completa do projeto) e quadros do Mux, em https;
// ou o arquivo do driver local de teste. Qualquer outro endereço fica de fora (a rota é
// pública e não vira proxy de nada além das fotos do app).
export function storyImageSource(url: string, o: { local: boolean }): "remote" | "local" | null {
  if (url.startsWith("/api/arquivos-locais/")) return o.local ? "local" : null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.port || u.username || u.password) return null;
  if (/^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/.test(u.hostname)) return "remote";
  if (u.hostname === "image.mux.com") return "remote";
  if (/^[a-z0-9]+\.supabase\.co$/.test(u.hostname) && u.pathname.startsWith("/storage/v1/object/public/")) return "remote";
  return null;
}

// Caminho SVG do QR: um quadrado de 1×1 por módulo escuro, em coordenadas de módulo
// (x = coluna, y = linha). A rota põe num <svg> com viewBox do tamanho do QR.
export function qrPath(size: number, dark: (row: number, col: number) => boolean): string {
  let d = "";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) if (dark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  }
  return d;
}

// Miniatura para a arte do story: o endereço completo do original (a arte é desenhada no servidor, que
// não resolve o /api/img relativo que o thumbSrc do cardápio usa).
function storyThumb(item: MenuItem | undefined): string | null {
  const m = item?.media[0];
  if (!m) return null;
  return posterSrc(m) ?? (m.kind === "photo" ? mediaUrl(m.storage_path) : null);
}
