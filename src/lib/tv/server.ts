import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import * as db from "@/lib/db/nocodb";
import { SLUG_PATTERN } from "@/lib/slug";
import { toTvHead, toTvs } from "./head";
import { tvTags } from "./tags";
import type { TvHead, TvRow } from "./types";

// Leituras da TV em cache na memória de cada instância do servidor. As actions do painel
// (TVs e Perfil) chamam updateTag com estas tags depois de gravar.
export { tvTags } from "./tags";

// Cabeça do telão: uma consulta a restaurants pelo slug.
export async function getTvHead(slug: string): Promise<TvHead | null> {
  "use cache";
  const s = slug.toLowerCase();
  cacheTag(tvTags.slug(s));
  // 5 min (orçamento do NocoDB): o que muda aqui (modo simples, nome, logo, Instagram) vem do
  // painel, que chama updateTag na hora.
  cacheLife({ revalidate: 300, expire: 900 });
  if (!SLUG_PATTERN.test(s)) return null;
  return toTvHead(await db.first("restaurants", { slug: s }));
}

// TVs do restaurante (pareadas, pendentes e desconectadas), em cache de 2 min.
export async function getTvRows(rid: string): Promise<TvRow[]> {
  "use cache";
  cacheTag(tvTags.rid(rid));
  cacheLife({ revalidate: 120, expire: 600 });
  return toTvs(await db.list("community_tvs", { restaurant_id: rid }));
}
