// Selos do prato (mesma lista do banco), com o nome em cada idioma do cardápio.
export const TAGS = {
  vegetariano: ["Vegetariano", "Vegetarian", "Vegetariano", "Végétarien", "Vegetariano", "Vegetarisch"],
  vegano: ["Vegano", "Vegan", "Vegano", "Végan", "Vegano", "Vegan"],
  sem_gluten: ["Sem glúten", "Gluten-free", "Sin gluten", "Sans gluten", "Senza glutine", "Glutenfrei"],
  sem_lactose: ["Sem lactose", "Lactose-free", "Sin lactosa", "Sans lactose", "Senza lattosio", "Laktosefrei"],
  sem_acucar: ["Sem açúcar", "Sugar-free", "Sin azúcar", "Sans sucre", "Senza zucchero", "Zuckerfrei"],
  apimentado: ["Apimentado", "Spicy", "Picante", "Épicé", "Piccante", "Scharf"],
  contem_nozes: ["Contém nozes", "Contains nuts", "Contiene frutos secos", "Contient des noix", "Contiene frutta a guscio", "Enthält Nüsse"],
  contem_frutos_do_mar: ["Contém frutos do mar", "Contains seafood", "Contiene mariscos", "Contient des fruits de mer", "Contiene frutti di mare", "Enthält Meeresfrüchte"],
} as const;

export type TagId = keyof typeof TAGS;

export const TAG_IDS = Object.keys(TAGS) as TagId[];

const LANG_INDEX: Record<string, number> = { "pt-BR": 0, en: 1, es: 2, fr: 3, it: 4, de: 5 };

export function tagLabel(tag: string, lang = "pt-BR") {
  const row = TAGS[tag as TagId];
  if (!row) return tag;
  return row[LANG_INDEX[lang] ?? LANG_INDEX[lang.slice(0, 2)] ?? 0];
}
