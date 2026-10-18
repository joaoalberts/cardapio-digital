// Tipos da TV do salão (telão). As linhas (*Row) são o formato do NocoDB; a tabela continua
// com o nome antigo (community_tvs) para as TVs já conectadas seguirem funcionando.
import type { OpeningHours } from "@/lib/menu/types";

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

// Cabeça do restaurante para o telão e o Apareça na TV: o que aparece na tela da TV.
export type TvHead = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  opening_hours: OpeningHours | null;
  instagram: string | null;
  logo_path: string | null;
  brand_color: string | null;
  // Modo simples do telão (interruptor do painel). Só a TV pareada recebe, pela rota de estado.
  tv_simple: boolean;
};
