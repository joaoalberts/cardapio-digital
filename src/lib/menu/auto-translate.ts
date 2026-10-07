import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { suggestTranslation, translationEnabled, type Texts } from "@/lib/translate";

export type Target = { categoryId: string } | { itemId: string };

// Traduções automáticas: preenche os idiomas sem tradução e refaz as que ainda são
// sugestão (auto). As que o dono já revisou ficam como estão.
export async function autoTranslate(supabase: SupabaseClient, restaurantId: string, target: Target, texts: Texts) {
  if (!translationEnabled()) return;
  const { data: r } = await supabase.from("restaurants").select("languages").eq("id", restaurantId).maybeSingle();
  const langs = ((r?.languages as string[] | undefined) ?? []).filter((l) => l !== "pt-BR");
  if (!langs.length) return;
  const col = "itemId" in target ? "item_id" : "category_id";
  const id = "itemId" in target ? target.itemId : target.categoryId;
  const { data: existing } = await supabase.from("translations").select("id, language, auto").eq(col, id);
  await Promise.all(
    langs.map(async (lang) => {
      const row = existing?.find((e) => e.language === lang);
      if (row && !row.auto) return;
      const out = await suggestTranslation(texts, lang).catch(() => null);
      if (!out) return;
      if (row) {
        await supabase.from("translations").update({ ...out, auto: true }).eq("id", row.id);
      } else {
        await supabase
          .from("translations")
          .insert({ restaurant_id: restaurantId, [col]: id, language: lang, ...out, auto: true });
      }
    }),
  );
}


// Ao ligar um idioma novo, sugere a tradução de todo o cardápio (poucos por vez).
export async function backfillTranslations(supabase: SupabaseClient, restaurantId: string) {
  if (!translationEnabled()) return 0;
  const [cats, items] = await Promise.all([
    supabase.from("categories").select("id, name").eq("restaurant_id", restaurantId),
    supabase.from("items").select("id, name, description").eq("restaurant_id", restaurantId),
  ]);
  const jobs: (() => Promise<void>)[] = [
    ...(cats.data ?? []).map((c) => () => autoTranslate(supabase, restaurantId, { categoryId: c.id }, { name: c.name, description: "" })),
    ...(items.data ?? []).map((i) => () => autoTranslate(supabase, restaurantId, { itemId: i.id }, { name: i.name, description: i.description })),
  ];
  for (let k = 0; k < jobs.length; k += 4) await Promise.all(jobs.slice(k, k + 4).map((j) => j()));
  return jobs.length;
}
