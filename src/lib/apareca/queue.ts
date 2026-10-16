// Posição na fila e tempo estimado do "Seu vídeo está na fila!". Funções puras.
import { currentPoll, pollPhase } from "@/lib/comunidade/clock";
import type { PollRow, TvRow } from "@/lib/comunidade/types";
import { CLIP_MS } from "./recording";
import type { AparecaConfig, ScheduleRule, VideoRow } from "./types";

const WAITING = new Set(["pending", "ai_review", "approved"]);

const byCreated = (a: VideoRow, b: VideoRow) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0) || a.Id - b.Id;

// 1 = próximo. Contam os vídeos ainda por tocar (em moderação ou aprovados com plays < plays_target)
// da mesma zona ou sem zona (o sem zona vai para todas as TVs), em ordem de chegada.
// Quem chama passa a zona "efetiva": zona apagada no painel já vem como null.
export function queuePosition(snapshot: VideoRow[], id: string, zone: string | null): number | null {
  const line = snapshot
    .filter((v) => WAITING.has(v.status) && !(v.status === "approved" && v.plays >= v.plays_target))
    .filter((v) => v.zone_id === zone || v.zone_id === null)
    .sort(byCreated);
  const k = line.findIndex((v) => v.id === id);
  return k < 0 ? null : k + 1;
}

const pos = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

// Tempo até o vídeo começar, em ms (como calculamos; a spec deixou "a decidir"):
// - a enquete aberta toma a tela: o que falta dela entra inteiro;
// - na frente há (posição - 1) clipes de 6 s;
// - a cada clients_max clientes entra um bloco de house_every institucionais, com a média
//   da duração dos institucionais ativos;
// - cada TV da zona segue o seu ritmo, então a fila anda tvs vezes mais rápido.
export function estimateWait(i: { position: number; rule: ScheduleRule; houseS: number[]; pollLeftMs: number; tvs: number }): number {
  const ahead = Math.max(0, Math.floor(pos(i.position)) - 1);
  const house = i.houseS.map(pos).filter((s) => s > 0);
  const avgHouseMs = house.length ? (house.reduce((a, b) => a + b, 0) / house.length) * 1000 : 0;
  const clientsMax = Math.max(1, Math.floor(pos(i.rule.clients_max)) || 1);
  const houseEvery = Math.max(1, Math.floor(pos(i.rule.house_every)) || 1);
  const blocks = Math.floor(ahead / clientsMax);
  const queueMs = ahead * CLIP_MS + blocks * houseEvery * avgHouseMs;
  const tvs = Math.max(1, Math.floor(pos(i.tvs)));
  return Math.round(pos(i.pollLeftMs) + queueMs / tvs);
}

// Quanto falta da enquete aberta (0 sem enquete aberta).
export function pollLeftMs(polls: PollRow[], now: Date): number {
  const p = currentPoll(polls, now);
  if (!p || pollPhase(p, now) !== "open") return 0;
  return Math.max(0, Date.parse(p.ends_at) - now.getTime());
}

// TVs que tocam o vídeo de uma zona: pareadas, não revogadas, da zona ou sem zona.
// TV numa zona apagada vale para todas. Vídeo sem zona (null) vai para todas as TVs.
export function tvsIn(tvs: TvRow[], cfg: Pick<AparecaConfig, "zones" | "tv_zones">, zone: string | null): number {
  const known = new Set(cfg.zones.map((z) => z.id));
  return tvs.filter((t) => {
    if (t.revoked || !t.paired_at) return false;
    if (zone === null) return true;
    const z = cfg.tv_zones[t.id];
    return !z || !known.has(z) || z === zone;
  }).length;
}
