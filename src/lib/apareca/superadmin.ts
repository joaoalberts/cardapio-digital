import { parseConfig } from "./config";
import { parseDbDate } from "./reports";
import { isExpired } from "./retention";

// Super admin do Apareça (T17): o João, dono do sistema, libera o recurso e a IA por restaurante.
// A lista vem de SUPERADMIN_EMAILS, lida só no servidor (página e actions de /painel/apareca/admin).
// Nenhum e-mail real fica no código: quem chama passa process.env.SUPERADMIN_EMAILS.

export function superAdminList(env: string | undefined): Set<string> {
  return new Set(
    (env ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

// since (SUPERADMIN_SINCE, ISO, opcional): o cadastro não confirma e-mail, então quem criasse a conta
// de um e-mail da lista que ainda não tem conta viraria super admin. Com since definido, só vale a
// conta criada ANTES dessa data. Data da conta ausente ou ilegível, ou since ilegível = não (fecha).
export function isSuperAdmin(
  email: string | null | undefined,
  env: string | undefined,
  opts: { createdAt?: unknown; since?: string } = {},
): boolean {
  const e = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (e === "" || !superAdminList(env).has(e)) return false;
  const since = opts.since?.trim();
  if (!since) return true;
  const limit = parseDbDate(since);
  const created = parseDbDate(opts.createdAt);
  return Number.isFinite(limit) && Number.isFinite(created) && created < limit;
}

// Conferência do servidor: lê as duas variáveis (nunca vão para o navegador).
export function isSuperAdminUser(
  user: { email?: string | null; created_at?: string | null } | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return isSuperAdmin(user?.email, env.SUPERADMIN_EMAILS, { createdAt: user?.created_at, since: env.SUPERADMIN_SINCE });
}

// Desligar a liberação desliga também o interruptor do dono: religar depende dele de novo.
export function allowedPatch(on: boolean): { apareca_allowed: boolean; apareca_enabled?: false } {
  return on ? { apareca_allowed: true } : { apareca_allowed: false, apareca_enabled: false };
}

// Desligar a IA volta o modo para manual quando estava em automático ou híbrido.
export function aiAllowedPatch(on: boolean, rawConfig: unknown): { apareca_ai_allowed: boolean; apareca_config?: ReturnType<typeof parseConfig> } {
  if (on) return { apareca_ai_allowed: true };
  const cfg = parseConfig(rawConfig);
  return cfg.mode === "manual" ? { apareca_ai_allowed: false } : { apareca_ai_allowed: false, apareca_config: { ...cfg, mode: "manual" } };
}

// ---------- Linhas da página ----------

type Raw = Record<string, unknown>;
export type AdminRow = {
  id: string; name: string; slug: string; allowed: boolean; ai_allowed: boolean; enabled: boolean;
  stored_now: number; // vídeos com asset no Mux agora (clientes não vencidos + institucionais)
  mux_min_month: number; // minutos codificados no mês (clientes, já apagados e vivos) + institucionais ativos
};

const DEFAULT_TZ = "America/Sao_Paulo";
const GONE = new Set(["rejected", "removed", "failed"]); // asset apagado na hora
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

function localMonth(tz: string, iso: unknown): string | null {
  const at = new Date(typeof iso === "string" ? iso : Number.NaN);
  if (!Number.isFinite(at.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TZ, year: "numeric", month: "2-digit" }).format(at);
  }
}

// Mesma conta de store.ts (computeUsage), separada por restaurante: tally do mês + vídeos vivos
// criados no mês (no fuso da casa) + institucionais ativos (guardados o mês todo).
export function adminRows(i: { month: string; now: Date; restaurants: Raw[]; videos: Raw[]; tallies: Raw[]; houses: Raw[] }): AdminRow[] {
  const rows = new Map<string, AdminRow & { tz: string; encoded_s: number; house_min: number }>();
  for (const r of i.restaurants) {
    const id = str(r.id);
    const slug = str(r.slug);
    if (!id || !slug) continue;
    rows.set(id, {
      id, slug, name: str(r.name) ?? slug, tz: str(r.timezone) ?? DEFAULT_TZ,
      allowed: r.apareca_allowed === true, ai_allowed: r.apareca_ai_allowed === true, enabled: r.apareca_enabled === true,
      stored_now: 0, mux_min_month: 0, encoded_s: 0, house_min: 0,
    });
  }
  for (const t of i.tallies) {
    const r = rows.get(String(t.restaurant_id));
    if (!r || t.month !== i.month) continue;
    r.encoded_s += num((t.counts as Raw | null | undefined)?.encoded_s);
  }
  for (const v of i.videos) {
    const r = rows.get(String(v.restaurant_id));
    if (!r) continue;
    const expired = isExpired({ expires_at: String(v.expires_at ?? "") }, i.now);
    if (str(v.mux_asset_id) && !expired && !GONE.has(String(v.status))) r.stored_now += 1;
    const dur = num(v.duration_ms) / 1000;
    if (dur && localMonth(r.tz, v.created_at) === i.month) r.encoded_s += dur;
  }
  for (const h of i.houses) {
    const r = rows.get(String(h.restaurant_id));
    if (!r) continue;
    if (str(h.mux_asset_id)) r.stored_now += 1;
    if (h.active === true) r.house_min += num(h.duration_ms) / 60_000;
  }
  return [...rows.values()]
    .map((r): AdminRow => ({
      id: r.id, name: r.name, slug: r.slug, allowed: r.allowed, ai_allowed: r.ai_allowed, enabled: r.enabled,
      stored_now: r.stored_now, mux_min_month: r.encoded_s / 60 + r.house_min,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
