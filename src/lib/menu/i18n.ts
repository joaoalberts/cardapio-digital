// Textos da interface do cardápio nos idiomas que o sistema conhece.
// O texto dos pratos vem do banco; aqui só botões, avisos e rótulos.
export const KNOWN_LANGS = ["pt-BR", "en", "es", "fr", "it", "de"] as const;

export const LANG_NAME: Record<string, string> = {
  "pt-BR": "Português",
  en: "English",
  es: "Español",
  fr: "Français",
  it: "Italiano",
  de: "Deutsch",
};

export const LANG_FLAG: Record<string, string> = {
  "pt-BR": "br",
  en: "us",
  es: "es",
  fr: "fr",
  it: "it",
  de: "de",
};

const L6 = (a: [string, string, string, string, string, string]) =>
  Object.fromEntries(KNOWN_LANGS.map((l, i) => [l, a[i]])) as Record<string, string>;

const STRINGS = {
  items: L6(["itens", "items", "platos", "plats", "piatti", "Gerichte"]),
  video: L6(["vídeo", "video", "vídeo", "vidéo", "video", "Video"]),
  viewList: L6(["Ver lista", "View list", "Ver lista", "Voir la liste", "Vedi lista", "Liste"]),
  listTitle: L6(["Cardápio em lista", "Full menu", "Carta completa", "Carte complète", "Menù completo", "Speisekarte"]),
  share: L6(["Compartilhar", "Share", "Compartir", "Partager", "Condividi", "Teilen"]),
  copied: L6(["Link copiado", "Link copied", "Enlace copiado", "Lien copié", "Link copiato", "Link kopiert"]),
  end: L6(["Fim do cardápio", "End of the menu", "Fin de la carta", "Fin de la carte", "Fine del menù", "Ende der Karte"]),
  lang: L6(["Idioma", "Language", "Idioma", "Langue", "Lingua", "Sprache"]),
  now: L6(["Cardápio em português", "Menu in English", "Carta en español", "Carte en français", "Menù in italiano", "Speisekarte auf Deutsch"]),
  back: L6(["Voltar", "Back", "Volver", "Retour", "Indietro", "Zurück"]),
  pause: L6(["Pausar", "Pause", "Pausar", "Pause", "Pausa", "Pausieren"]),
  resume: L6(["Continuar", "Resume", "Continuar", "Reprendre", "Riprendi", "Fortsetzen"]),
  close: L6(["Fechar", "Close", "Cerrar", "Fermer", "Chiudi", "Schließen"]),
  empty: L6([
    "O cardápio está sendo preparado.",
    "The menu is being prepared.",
    "La carta se está preparando.",
    "La carte est en préparation.",
    "Il menù è in preparazione.",
    "Die Speisekarte wird vorbereitet.",
  ]),
  hint1: L6([
    "Toque à direita para o próximo prato",
    "Tap right for the next dish",
    "Toca a la derecha para el siguiente plato",
    "Touchez à droite pour le plat suivant",
    "Tocca a destra per il piatto successivo",
    "Rechts tippen für das nächste Gericht",
  ]),
  hint2: L6([
    "Arraste para o lado para trocar de categoria",
    "Swipe sideways to change category",
    "Desliza hacia el lado para cambiar de categoría",
    "Glissez sur le côté pour changer de catégorie",
    "Scorri di lato per cambiare categoria",
    "Zur Seite wischen, um die Kategorie zu wechseln",
  ]),
};

export type StringKey = keyof typeof STRINGS;

export function t(key: StringKey, lang: string) {
  const row = STRINGS[key];
  return row[lang] ?? row[lang.slice(0, 2)] ?? row["pt-BR"];
}

// Idioma inicial: escolha salva, senão o idioma do celular, senão português.
export function pickLanguage(available: string[], saved: string | null, browser: readonly string[]) {
  if (saved && available.includes(saved)) return saved;
  for (const b of browser) {
    const exact = available.find((a) => a.toLowerCase() === b.toLowerCase());
    if (exact) return exact;
    const base = available.find((a) => a.slice(0, 2) === b.slice(0, 2).toLowerCase());
    if (base) return base;
  }
  return available.includes("pt-BR") ? "pt-BR" : (available[0] ?? "pt-BR");
}
