import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import * as db from "@/lib/db/nocodb";
import { SLUG_PATTERN } from "@/lib/slug";
import type { CommunityHead, PollRow, PostRow, TvRow } from "./types";
import { toContent, toHead } from "./votes";

// Leituras da Comunidade em cache na memória de cada instância do servidor. Não substituem
// a CDN: quem garante que telão e celulares veem a mesma versão é a resposta única da
// leitura agregada. As actions do painel chamam updateTag com estas tags depois de gravar;
// voto e evento nunca invalidam.
export const communityTags = { slug: (s: string) => `comunidade:${s}`, rid: (id: string) => `comunidade:${id}` };

// Até 200 enquetes, das mais novas: a casa agenda só para hoje, e a agenda guarda as que
// terminaram nas últimas 24 h (toContent).
const POLLS_READ = 200;

// Cabeça da Comunidade: uma consulta a restaurants pelo slug. Sem o getPublicMenu: a rota
// pública não precisa do cardápio, o celular já o tem.
export async function getCommunityHead(slug: string): Promise<CommunityHead | null> {
  "use cache";
  const s = slug.toLowerCase();
  cacheTag(communityTags.slug(s));
  cacheLife({ revalidate: 60, expire: 300 });
  if (!SLUG_PATTERN.test(s)) return null;
  return toHead(await db.first("restaurants", { slug: s }));
}

// Agenda, posts aprovados e telões do restaurante. Abrir e fechar a enquete é derivado do
// relógio, então a agenda pode ficar em cache sem errar a hora. O where só faz igualdade:
// o recorte por data é feito em memória.
export async function getCommunityContent(rid: string): Promise<{ polls: PollRow[]; posts: PostRow[]; tvs: TvRow[] }> {
  "use cache";
  cacheTag(communityTags.rid(rid));
  cacheLife({ revalidate: 60, expire: 300 });
  const mine = { restaurant_id: rid };
  const [polls, posts, tvs] = await Promise.all([
    db.list("community_polls", mine, { sort: "-Id", limit: POLLS_READ }),
    db.list("community_posts", { ...mine, status: "approved" }),
    db.list("community_tvs", mine),
  ]);
  return toContent({ polls, posts, tvs }, new Date());
}
