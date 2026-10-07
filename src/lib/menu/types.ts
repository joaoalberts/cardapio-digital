// Formato devolvido por get_public_menu (supabase/migrations).
export type MenuMedia = {
  id: string;
  kind: "photo" | "video";
  storage_path: string | null;
  mux_playback_id: string | null;
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
};

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
};

// 7 dias (0 = domingo), cada um com faixas "HH:MM"; fechar antes de abrir passa da meia-noite.
export type OpeningHours = { open: string; close: string }[][];

export type PublicMenu = { restaurant: MenuRestaurant; categories: MenuCategory[] };
