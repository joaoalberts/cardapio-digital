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
  featured: L6(["Destaques", "Highlights", "Destacados", "Coups de cœur", "In evidenza", "Empfehlungen"]),
  serves: L6(["Serve {n}", "Serves {n}", "Para {n}", "Pour {n}", "Per {n}", "Für {n}"]),
  from: L6(["a partir de", "from", "desde", "à partir de", "da", "ab"]),
  info: L6(["Informações", "Information", "Información", "Informations", "Informazioni", "Informationen"]),
  wifi: L6(["Wi-Fi", "Wi-Fi", "Wi-Fi", "Wi-Fi", "Wi-Fi", "WLAN"]),
  password: L6(["Senha", "Password", "Contraseña", "Mot de passe", "Password", "Passwort"]),
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
  open: L6(["Aberto", "Open", "Abierto", "Ouvert", "Aperto", "Geöffnet"]),
  closed: L6(["Fechado", "Closed", "Cerrado", "Fermé", "Chiuso", "Geschlossen"]),
  until: L6(["até {t}", "until {t}", "hasta las {t}", "jusqu’à {t}", "fino alle {t}", "bis {t}"]),
  opensAt: L6(["abre às {t}", "opens at {t}", "abre a las {t}", "ouvre à {t}", "apre alle {t}", "öffnet um {t}"]),
  opensOn: L6(["abre {d} às {t}", "opens {d} at {t}", "abre el {d} a las {t}", "ouvre {d} à {t}", "apre {d} alle {t}", "öffnet {d} um {t}"]),
  tomorrow: L6(["amanhã", "tomorrow", "mañana", "demain", "domani", "morgen"]),
  hint: L6([
    "Toque para avançar · deslize para trocar",
    "Tap to advance · swipe to switch",
    "Toca para avanzar · desliza para cambiar",
    "Touchez pour avancer · glissez pour changer",
    "Tocca per avanzare · scorri per cambiare",
    "Tippen zum Weiter · wischen zum Wechseln",
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
