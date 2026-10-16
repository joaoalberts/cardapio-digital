// Tipos da Comunidade (Palco da casa + Mural de pratos), fase 1a.
// As linhas (*Row) são o formato do NocoDB; os Public* são o que sai pela rota pública
// e nunca levam contagem de votos, device_id, table_id nem post oculto.
import type { OpeningHours } from "@/lib/menu/types";

export type PollTemplate = "dessert" | "drink" | "music" | "custom";
export type OptionId = "a" | "b" | "c";
export type PollOption = { id: OptionId; label: string; item_id: string | null };
export type PollRow = {
  id: string;
  restaurant_id: string;
  template: PollTemplate;
  question: string;
  options: PollOption[];
  starts_at: string;
  ends_at: string;
  closed_at: string | null;
  created_at: string;
  // Resultado final gravado pelo cron antes de apagar os votos (Decisão do João, 16/10):
  // quando existe, o estado público e o story usam ele, e não os votos.
  result?: PollResult | null;
};
// Porcentagem de cada opção da enquete (só as que existem nela), se houve voto e a vencedora.
export type PollResult = Partial<Record<OptionId, number>> & { has_votes: boolean; winner: OptionId | null };
export type VoteRow = { id: string; restaurant_id: string; poll_id: string; option_id: OptionId; device_id: string; table_id: string; created_at: string };
export type PostRow = {
  id: string;
  restaurant_id: string;
  item_id: string;
  photo_path: string;
  thumb_path: string;
  source: "house";
  status: "approved" | "hidden";
  on_tv: boolean;
  hidden_at: string | null;
  created_at: string;
};
export type TvRow = {
  id: string;
  restaurant_id: string;
  label: string | null;
  pair_code: string | null;
  pair_expires_at: string | null;
  secret_hash: string;
  paired_at: string | null;
  last_seen_at: string | null;
  revoked: boolean;
  created_at: string;
};
export type FunnelKey = "qr" | "balloon_seen" | "open" | "vote" | "buy_tap" | "share" | "ref_story" | "ref_telao";
export type TallyRow = {
  id: string;
  restaurant_id: string;
  day: string;
  counts: Partial<Record<FunnelKey, number>>;
  tables_qr: string[];
  tables_open: string[];
  created_at: string;
};
export type CommunityHead = {
  id: string;
  slug: string;
  name: string;
  enabled: boolean;
  day_start: string;
  timezone: string;
  opening_hours: OpeningHours | null;
  instagram: string | null;
  logo_path: string | null;
  brand_color: string | null;
  // Modo simples do telão (interruptor do painel). Só a TV pareada recebe, pela rota de estado.
  tv_simple: boolean;
};
export type PublicOption = { id: OptionId; label: string; item_id: string | null; pct: number };
export type PublicPoll = {
  id: string;
  template: PollTemplate;
  question: string;
  options: PublicOption[];
  starts_at: string;
  ends_at: string;
  closed: boolean;
  has_votes: boolean;
  winner: OptionId | null;
};
export type PublicPost = { id: string; item_id: string; thumb: string; photo: string; on_tv: boolean; created_at: string };
export type PublicState = {
  v: string;
  enabled: boolean;
  open: boolean;
  now: string;
  poll: PublicPoll | null;
  next: { starts_at: string; template: PollTemplate; question: string } | null;
  mural: PublicPost[];
  has_tv: boolean;
  instagram: string | null;
};
export type Origin = { origin: "comunidade_palco" | "comunidade_mural"; origin_ref: string; origin_at: number };
