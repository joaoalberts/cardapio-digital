// Combinações de fonte que o restaurante pode escolher no painel (mesma lista do banco).
// Títulos = nomes dos pratos, categorias e logo; texto = descrições e botões.
export const FONT_THEMES = [
  { id: "moderno", label: "Moderna", tag: "jovem e com personalidade" },
  { id: "letreiro", label: "Letreiro", tag: "forte, para burger e bar" },
  { id: "boutique", label: "Boutique", tag: "fina e luxuosa" },
  { id: "neon", label: "Neon", tag: "manuscrita e romântica" },
  { id: "laboratorio", label: "Laboratório", tag: "técnica e minimalista" },
  { id: "taverna", label: "Taverna", tag: "gótica, de cervejaria" },
] as const;

export type FontThemeId = (typeof FONT_THEMES)[number]["id"];

export const DEFAULT_FONT_THEME: FontThemeId = "moderno";

export function isFontTheme(value: unknown): value is FontThemeId {
  return FONT_THEMES.some((f) => f.id === value);
}

export function fontThemeLabel(id: string) {
  return FONT_THEMES.find((f) => f.id === id)?.label ?? id;
}
