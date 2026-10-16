import { describe, expect, it, vi } from "vitest";
import type { MenuItem, PublicMenu } from "@/lib/menu/types";
import type { CommunityHead, OptionId, PollRow, PostRow, VoteRow } from "./types";
import {
  STORY_CACHE_DONE,
  STORY_CACHE_LIVE,
  STORY_CACHE_POST,
  parseStoryQuery,
  qrPath,
  resolveStory,
  storyAccent,
  storyCache,
  storyHandle,
  storyImageSource,
  storyPhoto,
  storyComeSize,
  storyTitleSize,
  storyTexts,
  type StoryDeps,
  type StorySource,
} from "./story";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TZ = "America/Sao_Paulo";
const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = new Date("2026-10-16T23:00:00Z"); // sexta, 20:00 em São Paulo
const now = NOW.getTime();
const iso = (ms: number) => new Date(ms).toISOString();

const head = (over: Partial<CommunityHead> = {}): CommunityHead => ({
  id: "r1",
  slug: "forno",
  name: "Forno",
  enabled: true,
  day_start: "05:00",
  timezone: TZ,
  opening_hours: null,
  instagram: "forno",
  logo_path: null,
  brand_color: "#b8862f",
  tv_simple: false,
  ...over,
});

const ITEM_BURGER = U(101);
const ITEM_PIZZA = U(102);
const ITEM_GONE = U(103); // saiu do cardápio
const ITEM_VIDEO = U(104);

const item = (id: string, name: string, over: Partial<MenuItem> = {}): MenuItem => ({
  id,
  name,
  description: "",
  price_cents: 3000,
  media: [],
  category_id: "c1",
  half_half: false,
  ...over,
});
const photo = (path: string) => ({ id: `m-${path}`, kind: "photo" as const, storage_path: path, mux_playback_id: null, poster_path: `${path}-t` });

const MENU: PublicMenu = {
  restaurant: {
    id: "r1", name: "Forno", slug: "forno", logo_path: null, brand_color: null, languages: ["pt-BR"], menu_version: 1,
    cover_video_path: null, cover_image_path: null, font_theme: "fell", timezone: TZ, opening_hours: null, language: "pt-BR",
    orders_enabled: true,
  },
  categories: [
    {
      id: "c1",
      name: "Lanches",
      items: [
        item(ITEM_BURGER, "Burger Two", { media: [photo("https://x.public.blob.vercel-storage.com/r1/items/burger.webp")] }),
        item(ITEM_PIZZA, "Pizza doce", { featured: true, media: [photo("https://x.public.blob.vercel-storage.com/r1/items/pizza.webp")] }),
        item(ITEM_VIDEO, "Chopp", {
          media: [{ id: "v1", kind: "video", storage_path: null, mux_playback_id: "AbC123", poster_path: null }],
        }),
      ],
    },
  ],
};

const P_CLOSED = U(10); // encerrada com votos (burger vence)
const P_OPEN = U(11); // aberta com votos (pizza lidera)
const P_EMPTY = U(12); // encerrada sem votos
const P_SCHED = U(13); // agendada
const P_OTHER = U(14); // do r2
const P_MUSIC = U(15); // modelo de música, sem pratos

const poll = (id: string, over: Partial<PollRow> = {}): PollRow => ({
  id,
  restaurant_id: "r1",
  template: "custom",
  question: "Qual sai hoje?",
  options: [
    { id: "a", label: "burger da casa", item_id: ITEM_BURGER },
    { id: "b", label: "pizza", item_id: ITEM_PIZZA },
    { id: "c", label: "o que saiu", item_id: ITEM_GONE },
  ],
  starts_at: iso(now - 30 * MIN),
  ends_at: iso(now - 5 * MIN),
  closed_at: null,
  created_at: iso(now - 40 * MIN),
  ...over,
});

const POLLS: PollRow[] = [
  poll(P_CLOSED),
  poll(P_OPEN, { ends_at: iso(now + 10 * MIN) }),
  poll(P_EMPTY),
  poll(P_SCHED, { starts_at: iso(now + 10 * MIN), ends_at: iso(now + 20 * MIN) }),
  poll(P_OTHER, { restaurant_id: "r2" }),
  poll(P_MUSIC, {
    template: "music",
    question: "Qual a próxima música?",
    options: [
      { id: "a", label: "Rock", item_id: null },
      { id: "b", label: "Samba", item_id: null },
    ],
  }),
];

const DEV = (n: number) => U(500 + n);
const MESA = U(900);
let vid = 0;
const vote = (pollId: string, option: OptionId, dev: string, over: Partial<VoteRow> = {}): VoteRow => ({
  id: `v${++vid}`,
  restaurant_id: "r1",
  poll_id: pollId,
  option_id: option,
  device_id: dev,
  table_id: MESA,
  created_at: iso(now - 10 * MIN),
  ...over,
});
const VOTES: Record<string, VoteRow[]> = {
  [P_CLOSED]: [vote(P_CLOSED, "a", DEV(1)), vote(P_CLOSED, "a", DEV(2)), vote(P_CLOSED, "b", DEV(3))],
  [P_OPEN]: [vote(P_OPEN, "b", DEV(4)), vote(P_OPEN, "b", DEV(5)), vote(P_OPEN, "a", DEV(6))],
  [P_EMPTY]: [],
  // Voto numa enquete que ainda não abriu (dado inconsistente): só a fase barra a arte.
  [P_SCHED]: [vote(P_SCHED, "a", DEV(9))],
  // Voto marcado como do r1 numa enquete do r2: só a checagem da enquete barra a arte.
  [P_OTHER]: [vote(P_OTHER, "a", DEV(7))],
  [P_MUSIC]: [vote(P_MUSIC, "b", DEV(8))],
};

const POST_OK = U(30);
const POST_HIDDEN = U(31);
const POST_OTHER = U(32);
const POST_GONE = U(33); // prato saiu do cardápio
const POST_PIZZA = U(34); // prato em destaque
const post = (id: string, itemId: string, over: Partial<PostRow> = {}): PostRow => ({
  id,
  restaurant_id: "r1",
  item_id: itemId,
  photo_path: `/api/arquivos-locais/r1/comunidade/${id}-full.webp`,
  thumb_path: `/api/arquivos-locais/r1/comunidade/${id}-thumb.webp`,
  source: "house",
  status: "approved",
  on_tv: false,
  hidden_at: null,
  created_at: iso(now - 20 * MIN),
  ...over,
});
const POSTS: PostRow[] = [
  post(POST_OK, ITEM_BURGER),
  post(POST_HIDDEN, ITEM_BURGER, { status: "hidden", hidden_at: iso(now - MIN) }),
  post(POST_OTHER, ITEM_BURGER, { restaurant_id: "r2" }),
  post(POST_GONE, ITEM_GONE),
  post(POST_PIZZA, ITEM_PIZZA),
];

function deps(over: Partial<StoryDeps> & { headRow?: CommunityHead | null } = {}) {
  const { headRow, ...rest } = over;
  const d = {
    getHead: vi.fn(async (slug: string) => (slug === "forno" ? (headRow === undefined ? head() : headRow) : null)),
    getContent: vi.fn(async (rid: string) => ({
      polls: rid === "r1" ? POLLS : [],
      posts: POSTS,
      tvs: [],
    })),
    getVotes: vi.fn(async (pollId: string) => VOTES[pollId] ?? []),
    getMenu: vi.fn(async (slug: string) => (slug === "forno" ? MENU : null)),
    now: () => NOW,
    off: () => false,
    ...rest,
  };
  return d;
}

const asPoll = (s: StorySource | null) => {
  if (!s || s.kind !== "poll") throw new Error("esperava enquete");
  return s;
};
const asPost = (s: StorySource | null) => {
  if (!s || s.kind !== "post") throw new Error("esperava foto da casa");
  return s;
};

describe("resolveStory: o que pode virar arte", () => {
  it("enquete de outro restaurante não vira arte", async () => {
    // O conteúdo em cache do r1 traz uma enquete do r2 (erro do chamador): mesmo assim, nada.
    expect(await resolveStory(deps(), "forno", { poll: P_OTHER })).toBeNull();
  });

  it("post oculto não vira arte", async () => {
    expect(await resolveStory(deps(), "forno", { post: POST_HIDDEN })).toBeNull();
  });

  it("post de outro restaurante não vira arte", async () => {
    expect(await resolveStory(deps(), "forno", { post: POST_OTHER })).toBeNull();
  });

  it("Comunidade desligada no restaurante ou pela chave geral não vira arte", async () => {
    const off = deps({ headRow: head({ enabled: false }) });
    expect(await resolveStory(off, "forno", { poll: P_CLOSED })).toBeNull();
    expect(await resolveStory(off, "forno", { post: POST_OK })).toBeNull();
    const killed = deps({ off: () => true });
    expect(await resolveStory(killed, "forno", { poll: P_CLOSED })).toBeNull();
    expect(killed.getHead).not.toHaveBeenCalled();
  });

  it("slug inexistente, id malformado, nenhum ou os dois parâmetros: nada", async () => {
    expect(await resolveStory(deps(), "outro", { poll: P_CLOSED })).toBeNull();
    expect(await resolveStory(deps(), "forno", { poll: "abc" })).toBeNull();
    expect(await resolveStory(deps(), "forno", {})).toBeNull();
    expect(await resolveStory(deps(), "forno", { poll: P_CLOSED, post: POST_OK })).toBeNull();
    expect(await resolveStory(deps(), "forno", { poll: U(99) })).toBeNull(); // não existe
  });

  it("enquete agendada ou sem votos não vira arte (não há resultado)", async () => {
    expect(await resolveStory(deps(), "forno", { poll: P_SCHED })).toBeNull();
    expect(await resolveStory(deps(), "forno", { poll: P_EMPTY })).toBeNull();
  });

  it("post de prato que saiu do cardápio não vira arte", async () => {
    expect(await resolveStory(deps(), "forno", { post: POST_GONE })).toBeNull();
  });

  it("votos de outro restaurante ou de outra enquete não entram na conta", async () => {
    const d = deps({
      getVotes: async () => [
        vote(P_CLOSED, "b", DEV(1)),
        vote(P_CLOSED, "a", DEV(2), { restaurant_id: "r2" }),
        vote(P_CLOSED, "a", DEV(3), { restaurant_id: "r2" }),
        vote(P_OPEN, "a", DEV(4)),
      ],
    });
    const s = asPoll(await resolveStory(d, "forno", { poll: P_CLOSED }));
    expect(s.poll.options.map((o) => o.pct)).toEqual([0, 100, 0]);
    expect(s.poll.winner).toBe("b");
  });
});

describe("resolveStory: enquete", () => {
  it("só porcentagem: o JSON não leva device_id, mesa nem contagem", async () => {
    const s = asPoll(await resolveStory(deps(), "forno", { poll: P_CLOSED }));
    const json = JSON.stringify(s);
    expect(json).not.toContain("device_id");
    expect(json).not.toContain("table_id");
    expect(json).not.toContain(MESA);
    for (const v of VOTES[P_CLOSED]) expect(json).not.toContain(v.device_id);
    expect(json).not.toContain('"count');
    expect(json).not.toContain('"votes"');
    expect(s.poll.options.map((o) => o.pct)).toEqual([67, 33, 0]);
  });

  it("encerrada: nomes do cardápio, a foto da vencedora e o idioma do cardápio", async () => {
    const s = asPoll(await resolveStory(deps(), "forno", { poll: P_CLOSED }));
    expect(s.poll.closed).toBe(true);
    expect(s.poll.winner).toBe("a");
    expect(s.poll.options.map((o) => o.label)).toEqual(["Burger Two", "Pizza doce", "o que saiu"]);
    expect(s.photo).toBe("https://x.public.blob.vercel-storage.com/r1/items/burger.webp");
    expect(s.lang).toBe("pt-BR");
  });

  it("encerrada com result gravado (votos já apagados pelo cron): usa o result, sem ler votos", async () => {
    const withResult = POLLS.map((p) =>
      p.id === P_CLOSED ? { ...p, result: { a: 0, b: 52, c: 48, has_votes: true, winner: "b" as const } } : p,
    );
    const d = deps({
      getContent: vi.fn(async () => ({ polls: withResult, posts: POSTS, tvs: [] })),
      getVotes: vi.fn(async () => []),
    });
    const s = asPoll(await resolveStory(d, "forno", { poll: P_CLOSED }));
    expect(s.poll.winner).toBe("b");
    expect(s.poll.options.map((o) => o.pct)).toEqual([0, 52, 48]);
    expect(d.getVotes).not.toHaveBeenCalled();
  });

  it("miniatura de cada opção (a das perdedoras aparece ao lado do %); sem prato, nada", async () => {
    const s = asPoll(await resolveStory(deps(), "forno", { poll: P_CLOSED }));
    expect(s.thumbs).toEqual({
      a: "https://x.public.blob.vercel-storage.com/r1/items/burger.webp-t",
      b: "https://x.public.blob.vercel-storage.com/r1/items/pizza.webp-t",
      c: null,
    });
    expect(asPoll(await resolveStory(deps(), "forno", { poll: P_MUSIC })).thumbs).toEqual({ a: null, b: null });
  });

  it("storyTitleSize: \"Deu X\" a 124 px; nome comprido desce", () => {
    expect(storyTitleSize("Deu Burger two")).toBe(124);
    expect(storyTitleSize("x".repeat(16))).toBe(124);
    expect(storyTitleSize("x".repeat(17))).toBe(104);
    expect(storyTitleSize("x".repeat(25))).toBe(104);
    expect(storyTitleSize("x".repeat(26))).toBe(84);
  });

  it("aberta: a foto de quem lidera agora", async () => {
    const s = asPoll(await resolveStory(deps(), "forno", { poll: P_OPEN }));
    expect(s.poll.closed).toBe(false);
    expect(s.photo).toBe("https://x.public.blob.vercel-storage.com/r1/items/pizza.webp");
  });

  it("opções só com texto (música) não têm foto", async () => {
    const s = asPoll(await resolveStory(deps(), "forno", { poll: P_MUSIC }));
    expect(s.photo).toBeNull();
    expect(s.poll.options.map((o) => o.label)).toEqual(["Rock", "Samba"]);
  });

  it("restaurante fechado agora não impede a arte de uma enquete da noite", async () => {
    const closed = Array.from({ length: 7 }, () => [{ open: "11:00", close: "15:00" }]);
    const s = await resolveStory(deps({ headRow: head({ opening_hours: closed }) }), "forno", { poll: P_CLOSED });
    expect(asPoll(s).poll.winner).toBe("a");
  });
});

describe("resolveStory: foto da casa", () => {
  it("devolve o post com o nome do prato no cardápio", async () => {
    const s = asPost(await resolveStory(deps(), "forno", { post: POST_OK }));
    expect(s.post.id).toBe(POST_OK);
    expect(s.itemName).toBe("Burger Two");
    expect(s.featured).toBe(false);
  });

  it("marca o destaque da casa", async () => {
    const s = asPost(await resolveStory(deps(), "forno", { post: POST_PIZZA }));
    expect(s.featured).toBe(true);
  });
});

describe("storyCache", () => {
  it("enquete aberta: 60 s na CDN; encerrada: 1 dia; foto da casa: 1 h (a casa pode ocultar)", async () => {
    expect(STORY_CACHE_LIVE).toBe("public, max-age=0, s-maxage=60");
    expect(STORY_CACHE_DONE).toBe("public, max-age=0, s-maxage=86400");
    expect(STORY_CACHE_POST).toBe("public, max-age=0, s-maxage=3600");
    const open = asPoll(await resolveStory(deps(), "forno", { poll: P_OPEN }));
    const closed = asPoll(await resolveStory(deps(), "forno", { poll: P_CLOSED }));
    const house = asPost(await resolveStory(deps(), "forno", { post: POST_OK }));
    expect(storyCache(open, NOW)).toBe(STORY_CACHE_LIVE);
    expect(storyCache(closed, NOW)).toBe(STORY_CACHE_DONE);
    expect(storyCache(house, NOW)).toBe(STORY_CACHE_POST);
    // A aberta que já passou do fim na hora de responder conta como encerrada.
    expect(storyCache(open, new Date(now + 11 * MIN))).toBe(STORY_CACHE_DONE);
  });
});

describe("parseStoryQuery", () => {
  const q = (s: string) => parseStoryQuery(new URLSearchParams(s));
  it("aceita só poll ou post, uma vez cada", () => {
    expect(q(`poll=${P_CLOSED}`)).toEqual({ poll: P_CLOSED, post: null });
    expect(q(`post=${POST_OK}`)).toEqual({ poll: null, post: POST_OK });
  });
  it("recusa parâmetro desconhecido ou repetido (cada variação seria um PNG novo na CDN)", () => {
    expect(q(`poll=${P_CLOSED}&v=2`)).toBeNull();
    expect(q(`poll=${P_CLOSED}&poll=${P_OPEN}`)).toBeNull();
  });
});

describe("textos, cor, @ e foto da arte", () => {
  it("textos da enquete encerrada e da foto da casa (ficha v2, tela 16)", async () => {
    const closed = asPoll(await resolveStory(deps(), "forno", { poll: P_CLOSED }));
    expect(storyTexts(closed)).toEqual({
      kicker: "Enquete da casa, encerrada",
      question: "Qual sai hoje?",
      title: "Deu Burger Two",
      sub: null,
      come: "Vem pro Forno",
      point: "o cardápio da casa: aponte a câmera",
    });
    const open = asPoll(await resolveStory(deps(), "forno", { poll: P_OPEN }));
    expect(storyTexts(open)).toMatchObject({ kicker: "Enquete da casa, ao vivo", title: "Pizza doce na frente" });
    const music = asPoll(await resolveStory(deps(), "forno", { poll: P_MUSIC }));
    expect(storyTexts(music)).toMatchObject({ question: "Qual a próxima música?", title: "Deu Samba" });
    const house = asPost(await resolveStory(deps(), "forno", { post: POST_PIZZA }));
    expect(storyTexts(house)).toEqual({
      kicker: "Saindo agora da cozinha",
      question: null,
      title: "Pizza doce",
      sub: "destaque da casa",
      come: "Vem pro Forno",
      point: "o cardápio da casa: aponte a câmera",
    });
    const plain = asPost(await resolveStory(deps(), "forno", { post: POST_OK }));
    expect(storyTexts(plain).sub).toBeNull();
  });

  it("\"Vem pro\" usa o nome inteiro da casa (sem campo novo); sem nome, o slug", async () => {
    const depot = deps({ headRow: head({ name: "Depot Medieval" }) });
    expect(storyTexts(asPoll(await resolveStory(depot, "forno", { poll: P_CLOSED }))).come).toBe("Vem pro Depot Medieval");
    const noName = deps({ headRow: head({ name: "" }) });
    expect(storyTexts(asPoll(await resolveStory(noName, "forno", { poll: P_CLOSED }))).come).toBe("Vem pro forno");
  });

  it("storyComeSize: 72 px numa linha; nome comprido desce o tamanho e corta com reticências", () => {
    // Medido no PNG: "Vem pro depotmedieval" (21 letras) a 72 px quebra na coluna de 680 px.
    expect(storyComeSize("Vem pro Depot")).toEqual({ text: "Vem pro Depot", size: 72 });
    expect(storyComeSize("Vem pro Depot Bar")).toEqual({ text: "Vem pro Depot Bar", size: 60 });
    expect(storyComeSize("Vem pro Depot Medieval")).toEqual({ text: "Vem pro Depot Medieval", size: 60 });
    expect(storyComeSize("Vem pro Cantina da Nona Rosa").size).toBe(52);
    const long = storyComeSize("Vem pro " + "x".repeat(80));
    expect(long.size).toBe(52);
    expect(long.text).toHaveLength(44);
    expect(long.text.endsWith("…")).toBe(true);
  });

  it("cor da marca só em hexadecimal; senão, a do cardápio", () => {
    expect(storyAccent("#B8862F")).toBe("#b8862f");
    expect(storyAccent("#abc")).toBe("#aabbcc");
    expect(storyAccent("red; background:url(x)")).toBe("#e8b04b");
    expect(storyAccent(null)).toBe("#e8b04b");
  });

  it("@ do Instagram só com letras, números, ponto e _", () => {
    expect(storyHandle("depotmedieval")).toBe("@depotmedieval");
    expect(storyHandle("@depot.medieval")).toBe("@depot.medieval");
    expect(storyHandle("https://evil")).toBeNull();
    expect(storyHandle(null)).toBeNull();
  });

  it("foto do prato: a foto inteira; vídeo, a capa ou o quadro JPEG do Mux", () => {
    expect(storyPhoto(MENU.categories[0].items[0])).toBe("https://x.public.blob.vercel-storage.com/r1/items/burger.webp");
    expect(storyPhoto(MENU.categories[0].items[2])).toBe("https://image.mux.com/AbC123/thumbnail.jpg?width=1080");
    expect(storyPhoto(item(U(1), "sem foto"))).toBeNull();
    expect(storyPhoto(undefined)).toBeNull();
  });
});

describe("storyImageSource: de onde a rota pode ler uma imagem", () => {
  const opts = { local: false };
  it("aceita Blob, Supabase público e Mux em https", () => {
    expect(storyImageSource("https://x1.public.blob.vercel-storage.com/r1/a.webp", opts)).toBe("remote");
    expect(storyImageSource("https://abc.supabase.co/storage/v1/object/public/media/r1/a.webp", opts)).toBe("remote");
    expect(storyImageSource("https://image.mux.com/AbC/thumbnail.jpg?width=1080", opts)).toBe("remote");
  });
  it("recusa outro host, http, porta, usuário e caminho privado do Supabase", () => {
    expect(storyImageSource("https://evil.com/a.jpg", opts)).toBeNull();
    expect(storyImageSource("http://x1.public.blob.vercel-storage.com/a.webp", opts)).toBeNull();
    expect(storyImageSource("https://x1.public.blob.vercel-storage.com:8443/a.webp", opts)).toBeNull();
    expect(storyImageSource("https://u:p@image.mux.com/a.jpg", opts)).toBeNull();
    expect(storyImageSource("https://abc.supabase.co/storage/v1/object/sign/media/a.webp", opts)).toBeNull();
    expect(storyImageSource("https://abc.supabase.co.evil.com/storage/v1/object/public/a.webp", opts)).toBeNull();
    expect(storyImageSource("https://a.b.supabase.co/storage/v1/object/public/a.webp", opts)).toBeNull();
    expect(storyImageSource("http://localhost:8080/a.png", opts)).toBeNull();
    expect(storyImageSource("/demo/x.jpg", opts)).toBeNull();
  });
  it("arquivo local só com o driver local", () => {
    const url = "/api/arquivos-locais/r1/comunidade/a.webp";
    expect(storyImageSource(url, opts)).toBeNull();
    expect(storyImageSource(url, { local: true })).toBe("local");
  });
});

describe("qrPath", () => {
  it("um quadrado por módulo escuro, em coordenadas de módulo", () => {
    const dark = new Set(["0,0", "1,2"]);
    expect(qrPath(3, (r, c) => dark.has(`${r},${c}`))).toBe("M0 0h1v1h-1zM2 1h1v1h-1z");
    expect(qrPath(2, () => false)).toBe("");
  });
});

describe("tempo de enquete aberta que acaba de passar do fim", () => {
  it("encerrada pelo relógio na hora da leitura vira resultado final", async () => {
    const later = deps({ now: () => new Date(now + 11 * MIN) });
    const s = asPoll(await resolveStory(later, "forno", { poll: P_OPEN }));
    expect(s.poll.closed).toBe(true);
    expect(s.poll.winner).toBe("b");
    expect(storyCache(s, new Date(now + 11 * MIN))).toBe(STORY_CACHE_DONE);
  });
  it("encerrada há mais de 1 h ainda vira arte enquanto está na agenda em cache", async () => {
    const later = deps({ now: () => new Date(now + 2 * HOUR) });
    expect(asPoll(await resolveStory(later, "forno", { poll: P_CLOSED })).poll.closed).toBe(true);
  });
});
