import type { AparecaConfig, HouseVideoRow, ScheduleRule, VideoRow } from "./types";

export type ClientClip = { id: string; playback: string; name: string | null; plays_left: number; decided_at: string };
/** `duration_s: 0` significa "desconhecida": quem toca deve usar o fim do vídeo (evento `ended`), não esse número. */
export type HouseClip = { id: string; playback: string; aspect: string; duration_s: number };
export type Program = { house: HouseClip[]; clients: ClientClip[]; rule: ScheduleRule; plays: number };
/** `lastClient` (opcional) é o último cliente tocado no bloco atual; evita repetir o mesmo em seguida. */
export type Cursor = {
  houseIdx: number; clientsSinceHouse: number; playedHere: Record<string, number>; lastClient?: string;
};

/** Aceita "AAAA-MM-DDTHH:MM:SSZ" e "AAAA-MM-DD HH:MM:SS+00:00" (os dois convivem no NocoDB). */
const ts = (s: string) => {
  const t = Date.parse(s.replace(" ", "T"));
  return Number.isNaN(t) ? 0 : t;
};

const zoneExists = (cfg: AparecaConfig, z: string | null | undefined): z is string =>
  !!z && cfg.zones.some((x) => x.id === z);

/** Zona de uma mesa ou TV. Zona apagada do painel vale como "sem zona" (null). */
export function zoneOf(cfg: AparecaConfig, kind: "table" | "tv", id: string | null): string | null {
  if (!id) return null;
  const z = (kind === "table" ? cfg.table_zones : cfg.tv_zones)[id];
  return zoneExists(cfg, z) ? z : null;
}

/** O que uma TV pode tocar. Só vídeo `approved` (e com playback) entra: é a regra de ouro. */
export function programFor(i: {
  cfg: AparecaConfig; tvZone: string | null; videos: VideoRow[]; house: HouseVideoRow[];
}): Program {
  const tvZone = zoneExists(i.cfg, i.tvZone) ? i.tvZone : null;
  const clients: ClientClip[] = [];
  for (const v of i.videos) {
    if (v.status !== "approved" || !v.mux_playback_id) continue;
    if (v.plays >= v.plays_target) continue;
    const vz = zoneExists(i.cfg, v.zone_id) ? v.zone_id : null;
    if (tvZone !== null && vz !== null && vz !== tvZone) continue;
    clients.push({
      id: v.id, playback: v.mux_playback_id, name: v.name, plays_left: v.plays_target - v.plays,
      decided_at: v.decided_at ?? v.created_at,
    });
  }
  clients.sort((a, b) => ts(a.decided_at) - ts(b.decided_at));
  const house: HouseClip[] = i.house
    .filter((h) => h.active && h.status === "ready" && !!h.mux_playback_id)
    .sort((a, b) => a.position - b.position)
    .map((h) => ({
      id: h.id, playback: h.mux_playback_id as string, aspect: h.aspect ?? "16:9", duration_s: (h.duration_ms ?? 0) / 1000,
    }));
  return { house, clients, rule: i.cfg.rule, plays: i.cfg.plays };
}

/** Próximo item: institucional (house_every vezes), depois até clients_max clientes, sem repetir cliente na rodada. */
export function nextSlot(
  p: Program, c: Cursor,
): { kind: "house" | "client"; clip: HouseClip | ClientClip; cursor: Cursor } | null {
  const { house, clients } = p;
  if (!house.length && !clients.length) return null;

  // Poda: só ids do programa atual. Cliente novo (sem entrada) vale o mínimo dos que já têm contagem.
  const known = clients.filter((x) => x.id in c.playedHere).map((x) => c.playedHere[x.id]);
  const base = known.length ? Math.min(...known) : 0;
  const count = (id: string) => c.playedHere[id] ?? base;
  const pruned: Record<string, number> = {};
  for (const x of clients) if (x.id in c.playedHere) pruned[x.id] = c.playedHere[x.id];

  const playHouse = () => ({
    kind: "house" as const, clip: house[c.houseIdx % house.length],
    cursor: { houseIdx: c.houseIdx + 1, clientsSinceHouse: 0, playedHere: pruned },
  });
  if (!clients.length) return playHouse();

  const counts = clients.map((x) => count(x.id));
  const roundDone = counts.every((n) => n === counts[0]);

  if (house.length) {
    const every = Math.max(1, p.rule.house_every);
    const max = Math.max(1, p.rule.clients_max);
    const startOfCycle = c.houseIdx === 0 && c.clientsSinceHouse === 0;
    const midHouse = c.clientsSinceHouse === 0 && c.houseIdx % every !== 0;
    const blockEnded = c.clientsSinceHouse > 0 && (c.clientsSinceHouse >= max || roundDone);
    if (startOfCycle || midHouse || blockEnded) return playHouse();
  }

  // Menor contagem; nunca o mesmo cliente em seguida quando há outros.
  const pool = clients.length > 1 && c.lastClient ? clients.filter((x) => x.id !== c.lastClient) : clients;
  const min = Math.min(...pool.map((x) => count(x.id)));
  const clip = pool.find((x) => count(x.id) === min) as ClientClip;
  return {
    kind: "client", clip,
    cursor: {
      houseIdx: c.houseIdx, clientsSinceHouse: c.clientsSinceHouse + 1,
      playedHere: { ...pruned, [clip.id]: count(clip.id) + 1 }, lastClient: clip.id,
    },
  };
}
