import type { PublicMenu } from "./types";

// Busca o cardápio em outro idioma pelo navegador (rota /api/menu, com o mesmo cache).
export async function fetchPublicMenu(slug: string, lang: string): Promise<PublicMenu | null> {
  const res = await fetch(`/api/menu/${encodeURIComponent(slug)}?lang=${encodeURIComponent(lang)}`);
  if (!res.ok) return null;
  return (await res.json()) as PublicMenu | null;
}
