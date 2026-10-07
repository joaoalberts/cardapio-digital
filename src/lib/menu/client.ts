import type { PublicMenu } from "./types";

// Busca o cardápio em outro idioma direto do navegador (função pública do banco).
export async function fetchPublicMenu(slug: string, lang: string): Promise<PublicMenu | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const res = await fetch(`${url}/rest/v1/rpc/get_public_menu`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ p_slug: slug, p_lang: lang }),
  });
  if (!res.ok) return null;
  return (await res.json()) as PublicMenu | null;
}
