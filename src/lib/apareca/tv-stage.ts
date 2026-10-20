// Regras puras do palco do Apareça no telão (T14): quando o palco toca, o que vale da resposta
// da programação, o que fazer em erro, o que tocar sem rede e o corpo do "tocou".
// Sem DOM e sem rede: o componente (src/app/[slug]/apareca/tv/stage.tsx) só aplica.
import { nextSlot, type ClientClip, type Cursor, type HouseClip, type Program } from "./schedule";
import { nextDelay } from "./tv-layout";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MUX_ID = /^[A-Za-z0-9]{1,128}$/;
export const MUX_STREAM = "https://stream.mux.com";
// Base dos vídeos: a que a rota manda (MUX_STREAM_BASE no servidor, para o Mux falso dos testes) ou a do Mux.
const BASE = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~-]+)*$/;

export const muxMp4 = (playback: string, base: string = MUX_STREAM) => `${base}/${playback}/highest.mp4`;
export const muxHls = (playback: string, base: string = MUX_STREAM) => `${base}/${playback}.m3u8`;

/** Base dos vídeos vinda da rota: só http(s) com host e caminho simples, sem barra no fim; senão a do Mux. */
export function streamBase(x: unknown): string {
  if (typeof x !== "string") return MUX_STREAM;
  const b = x.replace(/\/+$/, "");
  return BASE.test(b) ? b : MUX_STREAM;
}

export type ProgramReply = { enabled: boolean; program: Program | null; logo: string | null; stream: string };

const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const num = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);

function houseClip(x: unknown): HouseClip | null {
  if (!obj(x) || typeof x.id !== "string" || !UUID.test(x.id) || typeof x.playback !== "string" || !MUX_ID.test(x.playback)) {
    return null;
  }
  return { id: x.id, playback: x.playback, aspect: typeof x.aspect === "string" ? x.aspect : "16:9", duration_s: Math.max(0, num(x.duration_s, 0)) };
}

function clientClip(x: unknown): ClientClip | null {
  if (!obj(x) || typeof x.id !== "string" || !UUID.test(x.id) || typeof x.playback !== "string" || !MUX_ID.test(x.playback)) {
    return null;
  }
  return {
    id: x.id, playback: x.playback, name: typeof x.name === "string" && x.name.trim() ? x.name.trim() : null,
    plays_left: num(x.plays_left, 1), decided_at: typeof x.decided_at === "string" ? x.decided_at : "",
  };
}

/** Resposta de POST tv/programa. Forma torta → null (conta como erro, nunca um programa pela metade). */
export function parseProgramReply(j: unknown): ProgramReply | null {
  if (!obj(j) || typeof j.enabled !== "boolean") return null;
  const logo = typeof j.logo === "string" && /^https?:\/\//.test(j.logo) ? j.logo : null;
  const stream = streamBase(j.stream);
  if (!j.enabled || j.program === null) {
    return { enabled: j.enabled && j.program !== null, program: null, logo: j.enabled ? logo : null, stream };
  }
  const p = j.program;
  if (!obj(p) || !Array.isArray(p.house) || !Array.isArray(p.clients) || !obj(p.rule)) return null;
  const rule = {
    kind: "intercalar" as const,
    house_every: Math.max(1, Math.floor(num(p.rule.house_every, 1))),
    clients_max: Math.max(1, Math.floor(num(p.rule.clients_max, 3))),
  };
  const house = p.house.map(houseClip).filter((c): c is HouseClip => !!c);
  const clients = p.clients.map(clientClip).filter((c): c is ClientClip => !!c);
  return { enabled: true, program: { house, clients, rule, plays: num(p.plays, 1) }, logo, stream };
}

/**
 * Programa depois de uma consulta. Boa: o novo (ou null, desligado). Erro de rede ou do servidor:
 * continua com o último. 401 (TV desconectada ou segredo trocado) e 404 (casa sumiu): para de
 * mostrar clientes na hora.
 */
export function programAfter(prev: Program | null, r: { reply: ProgramReply } | { status: number }): Program | null {
  if ("reply" in r) return r.reply.enabled ? r.reply.program : null;
  if (r.status === 401 || r.status === 404) return null;
  return prev;
}

export const OFF_POLL_MS = 60_000; // Apareça desligado: a TV confere de novo a cada 1 min
export const HOUSE_CACHE_DROP_MS = 10 * 60_000; // sem programa por 10 min: apaga os institucionais guardados

/** Espera até a próxima consulta: com o Apareça desligado, 1 min; senão 5 s (10, 20, 30 s depois de erros). */
export function pollDelay(r: { reply: ProgramReply } | { status: number }, failures: number): number {
  if ("reply" in r && !r.reply.enabled) return Math.max(OFF_POLL_MS, nextDelay(failures));
  return nextDelay(failures);
}

/** Hora de apagar o cache dos institucionais: sem programa (null ou desligado) há 10 min ou mais. */
export function houseCacheDropDue(noProgramSince: number | null, now: number): boolean {
  return noProgramSince !== null && now - noProgramSince >= HOUSE_CACHE_DROP_MS;
}

export type Pick = NonNullable<ReturnType<typeof nextSlot>>;

/**
 * Próximo item a tocar. Sem rede, os clientes (que vêm do Mux) são pulados e só os institucionais
 * (do cache local) tocam; sem nenhum institucional, null (fica o pôster). Limite de voltas: nunca trava.
 */
export function pickPlayable(p: Program, c: Cursor, offline: boolean): Pick | null {
  let cur = c;
  const max = p.house.length + p.clients.length * Math.max(1, p.rule.clients_max) + 2;
  for (let i = 0; i < max; i += 1) {
    const s = nextSlot(p, cur);
    if (!s) return null;
    if (!offline || s.kind === "house") return s;
    cur = s.cursor;
  }
  return null;
}

/** O clipe pré-carregado ainda está no programa de agora? */
export function clipInProgram(p: Program | null, kind: "house" | "client", id: string): boolean {
  if (!p) return false;
  return (kind === "house" ? p.house : p.clients).some((x) => x.id === id);
}

export type PlayInfo = { kind: "house" | "client"; id: string; play: string; fromCache: boolean; duration: number };

/**
 * Corpo do "tocou" (no evento playing, um play novo por exibição). Institucional só quando veio do
 * Mux: do cache local não passou pela entrega e não entra na conta.
 */
export function playBody(i: PlayInfo): Record<string, string | number> | null {
  if (i.kind === "client") return { video: i.id, play: i.play, kind: "client" };
  if (i.fromCache) return null;
  const b: Record<string, string | number> = { video: i.id, play: i.play, kind: "house" };
  if (Number.isFinite(i.duration) && i.duration > 0 && i.duration <= 3_600) b.duration_s = Math.round(i.duration * 10) / 10;
  return b;
}

/** uuid v4 a partir de 16 bytes aleatórios (crypto.randomUUID não existe em http://<IP> da TV). */
export function uuid4(bytes: Uint8Array): string {
  const b = Array.from(bytes.slice(0, 16));
  while (b.length < 16) b.push(0);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
