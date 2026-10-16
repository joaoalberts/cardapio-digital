import { inWindow, openStatus } from "@/lib/menu/hours";
import type { AparecaConfig, AparecaHead, FeatureState, ModMode, ScheduleRule, Zone } from "./types";

export const DEFAULT_CONFIG: AparecaConfig = {
  mode: "manual",
  rule: { kind: "intercalar", house_every: 1, clients_max: 3 },
  plays: 1,
  device_per_hour: 2,
  hours: null,
  retention_h: 6,
  zones: [],
  table_zones: {},
  tv_zones: {},
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MODES: ModMode[] = ["manual", "hibrido", "automatico"];
const ZONE_NAME_MAX = 40;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const clampInt = (v: unknown, min: number, max: number, dflt: number) => {
  const n = typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt;
};

function parseRule(raw: unknown): ScheduleRule {
  const d = DEFAULT_CONFIG.rule;
  if (!isObj(raw) || raw.kind !== "intercalar") return { ...d };
  return {
    kind: "intercalar",
    house_every: clampInt(raw.house_every, 1, 10, d.house_every),
    clients_max: clampInt(raw.clients_max, 1, 10, d.clients_max),
  };
}

function parseZones(raw: unknown): Zone[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Zone[] = [];
  for (const z of raw) {
    if (!isObj(z) || typeof z.id !== "string" || !UUID.test(z.id) || seen.has(z.id)) continue;
    const name = typeof z.name === "string" ? z.name.trim() : "";
    if (!name || name.length > ZONE_NAME_MAX) continue;
    seen.add(z.id);
    out.push({ id: z.id, name });
  }
  return out;
}

// Mapa id -> zona: descarta chave ou valor que não seja uuid. Zona que não existe mais continua
// no mapa de propósito; quem lê trata como "sem zona" (spec: nada some da programação).
function parseMap(raw: unknown): Record<string, string> {
  if (!isObj(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (UUID.test(k) && typeof v === "string" && UUID.test(v)) out[k] = v;
  return out;
}

// Nunca lança: qualquer coisa vira config válida, com as faixas corrigidas.
export function parseConfig(raw: unknown): AparecaConfig {
  const r = isObj(raw) ? raw : {};
  const hours =
    isObj(r.hours) && typeof r.hours.from === "string" && typeof r.hours.to === "string" &&
    HHMM.test(r.hours.from) && HHMM.test(r.hours.to)
      ? { from: r.hours.from, to: r.hours.to }
      : null;
  return {
    mode: MODES.includes(r.mode as ModMode) ? (r.mode as ModMode) : DEFAULT_CONFIG.mode,
    rule: parseRule(r.rule),
    plays: clampInt(r.plays, 1, 3, 1) as 1 | 2 | 3,
    device_per_hour: clampInt(r.device_per_hour, 1, 20, DEFAULT_CONFIG.device_per_hour),
    hours,
    retention_h: clampInt(r.retention_h, 6, 168, DEFAULT_CONFIG.retention_h),
    zones: parseZones(r.zones),
    table_zones: parseMap(r.table_zones),
    tv_zones: parseMap(r.tv_zones),
  };
}

// Envio aberto agora? Janela própria (aceita virar a meia-noite) ou, sem ela, o horário de funcionamento.
export function withinHours(
  cfg: AparecaConfig,
  head: Pick<AparecaHead, "opening_hours" | "timezone">,
  now: Date,
): boolean {
  if (cfg.hours) return inWindow(cfg.hours.from, cfg.hours.to, head.timezone, now);
  if (!head.opening_hours) return true;
  return openStatus(head.opening_hours, head.timezone, now).open;
}

// Interruptores em cadeia: geral, liberado pelo João, ligado pelo dono, Comunidade, horário, teto.
export function featureState(
  head: AparecaHead | null,
  o: { now: Date; off: boolean; paused: boolean },
): FeatureState {
  if (o.off) return { on: false, why: "off" };
  if (!head) return { on: false, why: "disabled" };
  if (!head.allowed) return { on: false, why: "not_allowed" };
  if (!head.enabled) return { on: false, why: "disabled" };
  if (!head.community_enabled) return { on: false, why: "no_community" };
  if (!withinHours(head.config, head, o.now)) return { on: false, why: "closed" };
  if (o.paused) return { on: false, why: "paused" };
  return { on: true };
}
