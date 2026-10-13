import "server-only";
import * as db from "@/lib/db/nocodb";
import { suggestTranslation, translationEnabled, type Texts } from "@/lib/translate";

export type Target = { categoryId: string } | { itemId: string };

// Traduções automáticas: preenche os idiomas sem tradução e refaz as que ainda são
// sugestão (auto). As que o dono já revisou ficam como estão.
export async function autoTranslate(restaurantId: string, target: Target, texts: Texts) {
  if (!translationEnabled()) return;
  const r = await db.first<{ languages: string[] | null }>("restaurants", { uid: restaurantId });
  const langs = (r?.languages ?? []).filter((l) => l !== "pt-BR");
  if (!langs.length) return;
  const col = "itemId" in target ? "item_id" : "category_id";
  const id = "itemId" in target ? target.itemId : target.categoryId;
  const existing = await db.list<{ Id: number; language: string; auto: boolean }>("translations", {
    restaurant_id: restaurantId,
    [col]: id,
  });
  const outs = await Promise.all(
    langs.map(async (lang) => {
      const row = existing.find((e) => e.language === lang);
      if (row && !row.auto) return null;
      const out = await suggestTranslation(texts, lang).catch(() => null);
      return out ? { lang, row, out } : null;
    }),
  );
  const done = outs.filter((o): o is NonNullable<typeof o> => !!o);
  await db.updateRows(
    "translations",
    done.filter((d) => d.row).map((d) => ({ Id: d.row!.Id, ...d.out, auto: true })),
  );
  await db.insert(
    "translations",
    done
      .filter((d) => !d.row)
      .map((d) => ({ restaurant_id: restaurantId, [col]: id, language: d.lang, ...d.out, auto: true })),
  );
}

// Ao ligar um idioma novo, sugere a tradução de todo o cardápio (poucos por vez).
export async function backfillTranslations(restaurantId: string) {
  if (!translationEnabled()) return 0;
  const [cats, items] = await Promise.all([
    db.list<{ id: string; name: string }>("categories", { restaurant_id: restaurantId }),
    db.list<{ id: string; name: string; description: string | null }>("items", { restaurant_id: restaurantId }),
  ]);
  const jobs: (() => Promise<void>)[] = [
    ...cats.map((c) => () => autoTranslate(restaurantId, { categoryId: c.id }, { name: c.name, description: "" })),
    ...items.map((i) => () => autoTranslate(restaurantId, { itemId: i.id }, { name: i.name, description: i.description ?? "" })),
  ];
  for (let k = 0; k < jobs.length; k += 4) await Promise.all(jobs.slice(k, k + 4).map((j) => j()));
  return jobs.length;
}
