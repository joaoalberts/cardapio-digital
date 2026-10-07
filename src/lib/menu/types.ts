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
  media: MenuMedia[];
};

export type MenuCategory = { id: string; name: string; items: MenuItem[] };

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
  font_theme: string;
  language: string;
};

export type PublicMenu = { restaurant: MenuRestaurant; categories: MenuCategory[] };
