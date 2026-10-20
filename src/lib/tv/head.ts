// Linhas do NocoDB → cabeça do restaurante e TVs. Funções puras, sem nada server-only, para
// os testes e para o Apareça reaproveitarem.
import type { OpeningHours } from "@/lib/menu/types";
import type { TvHead, TvRow } from "./types";

type Raw = Record<string, unknown>;
const DEFAULT_TZ = "America/Sao_Paulo";
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
// "AAAA-MM-DDTHH:MM[:SS[.mmm]]" com fuso; o NocoDB devolve "AAAA-MM-DD HH:MM:SS+00:00".
const ISO_DATE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/;

// Data do banco em ISO (o Safari antigo não lê "AAAA-MM-DD HH:MM:SS+00:00"); inválida = null.
function isoDate(v: unknown): string | null {
  if (typeof v !== "string" || !ISO_DATE.test(v.trim())) return null;
  const t = Date.parse(v.trim());
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// Linha de restaurants → cabeça. Horário escondido conta como sem horário.
export function toTvHead(r: Raw | null): TvHead | null {
  if (!r || !str(r.id) || !str(r.slug)) return null;
  return {
    id: r.id as string,
    slug: r.slug as string,
    name: str(r.name) ?? "",
    timezone: str(r.timezone) ?? DEFAULT_TZ,
    opening_hours: r.show_hours === true && Array.isArray(r.opening_hours) ? (r.opening_hours as OpeningHours) : null,
    instagram: str(r.instagram),
    logo_path: str(r.logo_path),
    brand_color: str(r.brand_color),
    tv_simple: r.community_tv_simple === true,
  };
}

// Linha de community_tvs → TV, sem o código nem o hash do segredo.
export function toTv(r: Raw): TvRow | null {
  const id = str(r.id);
  const restaurant_id = str(r.restaurant_id);
  if (!id || !restaurant_id) return null;
  return {
    id,
    restaurant_id,
    label: str(r.label),
    pair_code: null,
    pair_expires_at: isoDate(r.pair_expires_at),
    secret_hash: "",
    paired_at: isoDate(r.paired_at),
    last_seen_at: isoDate(r.last_seen_at),
    revoked: r.revoked === true,
    created_at: isoDate(r.created_at) ?? "",
  };
}

export const toTvs = (rows: Raw[]): TvRow[] => rows.map(toTv).filter((t): t is TvRow => t !== null);
