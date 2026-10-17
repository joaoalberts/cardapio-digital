// Formato do cardápio público (montado em lib/menu/data.ts).
export type MenuMedia = {
  id: string;
  kind: "photo" | "video";
  storage_path: string | null;
  mux_playback_id: string | null;
  mux_mp4?: string | null;
  poster_path: string | null;
};

export type MenuItem = {
  id: string;
  name: string;
  description: string;
  price_cents: number;
  promo_price_cents?: number | null;
  hide_price?: boolean;
  featured?: boolean;
  serves?: number | null;
  country?: string | null;
  price_options?: { label: string; price_cents: number }[] | null;
  tags?: string[];
  media: MenuMedia[];
  // Categoria real do prato (mesmo quando aparece em "Destaques") e se ela aceita meio a meio.
  category_id: string;
  half_half: boolean;
  // Só nos produtos especiais (oferta relâmpago).
  special?: SpecialInfo | null;
};

// Regras de um produto especial: a cada quantas horas aparece para o mesmo cliente,
// quantos segundos fica na tela, em que dias (0 = domingo; vazio = todos), em que
// horário ("HH:MM"; vazio = o dia todo) e quantas unidades cada vez que é pego.
// times = horários marcados ("HH:MM"): com algum, a oferta só aparece nos 5 minutos de cada um
// (no lugar do "a cada X horas").
export type SpecialInfo = { every_h: number; show_s: number; days: number[]; from: string | null; to: string | null; limit: number; times?: string[] };

export type MenuCategory = {
  id: string;
  name: string;
  description?: string;
  // "HH:MM:SS" no fuso do restaurante; os dois vazios = sempre visível.
  available_from?: string | null;
  available_to?: string | null;
  cover?: MenuMedia | null;
  items: MenuItem[];
};

export type MenuRestaurant = {
  id: string;
  name: string;
  slug: string;
  logo_path: string | null;
  brand_color: string | null;
  languages: string[];
  menu_version: number;
  cover_video_path: string | null;
  cover_image_path: string | null;
  cover?: MenuMedia | null;
  description?: string;
  phone?: string | null;
  address?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  wifi_name?: string | null;
  wifi_password?: string | null;
  payment_methods?: string[];
  font_theme: string;
  timezone: string;
  opening_hours: OpeningHours | null;
  language: string;
  // O restaurante recebe pedidos pelo cardápio (aba Pedidos do painel).
  orders_enabled: boolean;
};

// 7 dias (0 = domingo), cada um com faixas "HH:MM"; fechar antes de abrir passa da meia-noite.
export type OpeningHours = { open: string; close: string }[][];

// specials = a categoria escondida dos produtos especiais (só os ligados); nunca entra em categories.
export type PublicMenu = { restaurant: MenuRestaurant; categories: MenuCategory[]; specials?: MenuCategory | null };
