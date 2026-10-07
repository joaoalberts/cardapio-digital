// Selos e alergênicos do prato (mesma lista do banco), com o nome em cada idioma do
// cardápio: pt-BR, en, es, fr, it, de. A ordem é a do painel.
export const TAGS = {
  vegetariano: ["Vegetariano", "Vegetarian", "Vegetariano", "Végétarien", "Vegetariano", "Vegetarisch"],
  vegano: ["Vegano", "Vegan", "Vegano", "Végan", "Vegano", "Vegan"],
  sem_lactose: ["Sem lactose", "Lactose-free", "Sin lactosa", "Sans lactose", "Senza lattosio", "Laktosefrei"],
  com_lactose: ["Com lactose", "Contains lactose", "Con lactosa", "Contient du lactose", "Con lattosio", "Enthält Laktose"],
  sem_acucar: ["Sem açúcar", "Sugar-free", "Sin azúcar", "Sans sucre", "Senza zucchero", "Zuckerfrei"],
  com_leite: ["Com leite", "Contains milk", "Con leche", "Contient du lait", "Con latte", "Enthält Milch"],
  sem_gluten: ["Sem glúten", "Gluten-free", "Sin gluten", "Sans gluten", "Senza glutine", "Glutenfrei"],
  com_gluten: ["Com glúten", "Contains gluten", "Con gluten", "Contient du gluten", "Con glutine", "Enthält Gluten"],
  com_ovo: ["Com ovo", "Contains egg", "Con huevo", "Contient des œufs", "Con uova", "Enthält Ei"],
  com_soja: ["Com soja", "Contains soy", "Con soja", "Contient du soja", "Con soia", "Enthält Soja"],
  com_crustaceos: ["Com crustáceos", "Contains shellfish", "Con crustáceos", "Contient des crustacés", "Con crostacei", "Enthält Krebstiere"],
  com_peixe: ["Com peixe", "Contains fish", "Con pescado", "Contient du poisson", "Con pesce", "Enthält Fisch"],
  com_amendoas: ["Com amêndoas", "Contains almonds", "Con almendras", "Contient des amandes", "Con mandorle", "Enthält Mandeln"],
  com_castanhas: ["Com castanhas", "Contains tree nuts", "Con frutos secos", "Contient des fruits à coque", "Con frutta a guscio", "Enthält Schalenfrüchte"],
  com_corantes: ["Com corantes", "Contains colorings", "Con colorantes", "Contient des colorants", "Con coloranti", "Enthält Farbstoffe"],
  apimentado: ["Apimentado", "Spicy", "Picante", "Épicé", "Piccante", "Scharf"],
  contem_nozes: ["Contém nozes", "Contains nuts", "Contiene frutos secos", "Contient des noix", "Contiene frutta a guscio", "Enthält Nüsse"],
  contem_frutos_do_mar: ["Contém frutos do mar", "Contains seafood", "Contiene mariscos", "Contient des fruits de mer", "Contiene frutti di mare", "Enthält Meeresfrüchte"],
} as const;

export type TagId = keyof typeof TAGS;

export const TAG_IDS = Object.keys(TAGS) as TagId[];

const LANG_INDEX: Record<string, number> = { "pt-BR": 0, en: 1, es: 2, fr: 3, it: 4, de: 5 };

const langIndex = (lang: string) => LANG_INDEX[lang] ?? LANG_INDEX[lang.slice(0, 2)] ?? 0;

export function tagLabel(tag: string, lang = "pt-BR") {
  const row = TAGS[tag as TagId];
  if (!row) return tag;
  return row[langIndex(lang)];
}

// País de origem (vinhos, queijos, cervejas…): código guardado no prato, nome traduzido.
export const COUNTRIES = {
  BR: ["Brasil", "Brazil", "Brasil", "Brésil", "Brasile", "Brasilien"],
  AR: ["Argentina", "Argentina", "Argentina", "Argentine", "Argentina", "Argentinien"],
  CL: ["Chile", "Chile", "Chile", "Chili", "Cile", "Chile"],
  UY: ["Uruguai", "Uruguay", "Uruguay", "Uruguay", "Uruguay", "Uruguay"],
  PT: ["Portugal", "Portugal", "Portugal", "Portugal", "Portogallo", "Portugal"],
  ES: ["Espanha", "Spain", "España", "Espagne", "Spagna", "Spanien"],
  FR: ["França", "France", "Francia", "France", "Francia", "Frankreich"],
  IT: ["Itália", "Italy", "Italia", "Italie", "Italia", "Italien"],
  DE: ["Alemanha", "Germany", "Alemania", "Allemagne", "Germania", "Deutschland"],
  BE: ["Bélgica", "Belgium", "Bélgica", "Belgique", "Belgio", "Belgien"],
  GB: ["Reino Unido", "United Kingdom", "Reino Unido", "Royaume-Uni", "Regno Unito", "Vereinigtes Königreich"],
  IE: ["Irlanda", "Ireland", "Irlanda", "Irlande", "Irlanda", "Irland"],
  US: ["Estados Unidos", "United States", "Estados Unidos", "États-Unis", "Stati Uniti", "Vereinigte Staaten"],
  MX: ["México", "Mexico", "México", "Mexique", "Messico", "Mexiko"],
  JP: ["Japão", "Japan", "Japón", "Japon", "Giappone", "Japan"],
  ZA: ["África do Sul", "South Africa", "Sudáfrica", "Afrique du Sud", "Sudafrica", "Südafrika"],
  AU: ["Austrália", "Australia", "Australia", "Australie", "Australia", "Australien"],
  NZ: ["Nova Zelândia", "New Zealand", "Nueva Zelanda", "Nouvelle-Zélande", "Nuova Zelanda", "Neuseeland"],
} as const;

export function countryLabel(code: string | null | undefined, lang = "pt-BR") {
  if (!code) return null;
  const row = COUNTRIES[code as keyof typeof COUNTRIES];
  return row ? row[langIndex(lang)] : code;
}
