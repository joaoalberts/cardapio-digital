import { describe, expect, it } from "vitest";
import type { Program } from "./schedule";
import {
  clipInProgram, houseCacheDropDue, muxHls, muxMp4, parseProgramReply, pickPlayable, playBody, pollDelay, programAfter,
  stageRuns, streamBase, uuid4, type ProgramReply,
} from "./tv-stage";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rule = { kind: "intercalar" as const, house_every: 1, clients_max: 3 };
const prog = (house = 1, clients = 2): Program => ({
  house: Array.from({ length: house }, (_, i) => ({ id: U(100 + i), playback: `casa${i}`, aspect: "16:9", duration_s: 0 })),
  clients: Array.from({ length: clients }, (_, i) => ({
    id: U(i + 1), playback: `cli${i}`, name: `Cliente ${i}`, plays_left: 1, decided_at: "2026-10-16T10:00:00Z",
  })),
  rule,
  plays: 1,
});
const cursor0 = { houseIdx: 0, clientsSinceHouse: 0, playedHere: {} };

describe("stageRuns (pausa do palco)", () => {
  it("só toca sem enquete: pausa com enquete aberta e durante o \"Deu X\"", () => {
    expect(stageRuns("feat")).toBe(true);
    expect(stageRuns("poll")).toBe(false);
    expect(stageRuns("win")).toBe(false);
    expect(stageRuns("off")).toBe(false);
  });
});

describe("parseProgramReply", () => {
  it("aceita a resposta da rota e devolve programa, logo e ligado", () => {
    const r = parseProgramReply({ enabled: true, program: prog(), logo: "https://x/logo.png", qr: "<svg/>" });
    expect(r?.enabled).toBe(true);
    expect(r?.program?.clients).toHaveLength(2);
    expect(r?.logo).toBe("https://x/logo.png");
  });
  it("desligado: programa null", () => {
    expect(parseProgramReply({ enabled: false, program: null, logo: null, qr: "" })).toEqual({
      enabled: false, program: null, logo: null, stream: "https://stream.mux.com",
    });
  });
  it("forma torta vira null (erro), nunca um programa pela metade", () => {
    expect(parseProgramReply(null)).toBeNull();
    expect(parseProgramReply({ ok: false, code: "error" })).toBeNull();
    expect(parseProgramReply({ enabled: true, program: { house: "x", clients: [] } })).toBeNull();
  });
  it("descarta clipe com id ou playback fora do formato (não vira URL)", () => {
    const p = prog(1, 2);
    p.clients[0] = { ...p.clients[0], playback: "../../evil" };
    p.house[0] = { ...p.house[0], id: "nao-uuid" };
    const r = parseProgramReply({ enabled: true, program: p, logo: null });
    expect(r?.program?.clients.map((c) => c.playback)).toEqual(["cli1"]);
    expect(r?.program?.house).toHaveLength(0);
  });
  it("logo só http(s)", () => {
    expect(parseProgramReply({ enabled: true, program: prog(), logo: "javascript:alert(1)" })?.logo).toBeNull();
  });
});

describe("base dos vídeos (stream)", () => {
  it("a da rota vale quando é http(s) simples; a barra do fim sai", () => {
    expect(parseProgramReply({ enabled: true, program: prog(), logo: null, stream: "http://localhost:4010/" })?.stream).toBe(
      "http://localhost:4010",
    );
    expect(streamBase("https://mux-falso.test/stream")).toBe("https://mux-falso.test/stream");
  });
  it("ausente ou torta: a do Mux (nunca javascript:, aspas ou query)", () => {
    for (const bad of [undefined, null, 42, "", "javascript:alert(1)", "//evil.com", "https://x.com/a?b=1", 'https://x.com/"><svg', "ftp://x.com"]) {
      expect(streamBase(bad)).toBe("https://stream.mux.com");
    }
    expect(parseProgramReply({ enabled: true, program: prog(), logo: null })?.stream).toBe("https://stream.mux.com");
  });
  it("muxMp4 e muxHls usam a base recebida", () => {
    expect(muxMp4("abc", "http://localhost:4010")).toBe("http://localhost:4010/abc/highest.mp4");
    expect(muxHls("abc", "http://localhost:4010")).toBe("http://localhost:4010/abc.m3u8");
  });
});

describe("pollDelay", () => {
  const off: ProgramReply = { enabled: false, program: null, logo: null, stream: "https://stream.mux.com" };
  const on: ProgramReply = { enabled: true, program: prog(), logo: null, stream: "https://stream.mux.com" };
  it("Apareça desligado: confere de novo só depois de 1 min", () => {
    expect(pollDelay({ reply: off }, 0)).toBeGreaterThanOrEqual(60_000);
  });
  it("ligado: 5 s; erro: o nextDelay (10, 20, 30 s)", () => {
    expect(pollDelay({ reply: on }, 0)).toBe(5_000);
    expect(pollDelay({ status: 503 }, 1)).toBe(10_000);
    expect(pollDelay({ status: 0 }, 9)).toBe(30_000);
  });
});

describe("houseCacheDropDue", () => {
  it("apaga o cache só depois de 10 min sem programa", () => {
    expect(houseCacheDropDue(null, 1e9)).toBe(false);
    expect(houseCacheDropDue(1_000, 1_000 + 9 * 60_000)).toBe(false);
    expect(houseCacheDropDue(1_000, 1_000 + 10 * 60_000)).toBe(true);
  });
});

describe("programAfter", () => {
  const p = prog();
  it("resposta boa troca o programa; desligado zera", () => {
    expect(programAfter(null, { reply: { enabled: true, program: p, logo: null, stream: "https://stream.mux.com" } })).toBe(p);
    expect(programAfter(p, { reply: { enabled: false, program: null, logo: null, stream: "https://stream.mux.com" } })).toBeNull();
  });
  it("erro de rede ou 503 continua com o último programa", () => {
    expect(programAfter(p, { status: 0 })).toBe(p);
    expect(programAfter(p, { status: 503 })).toBe(p);
    expect(programAfter(null, { status: 503 })).toBeNull();
  });
  it("401 e 404 param de mostrar clientes (TV desconectada ou casa sumiu)", () => {
    expect(programAfter(p, { status: 401 })).toBeNull();
    expect(programAfter(p, { status: 404 })).toBeNull();
  });
});

describe("pickPlayable", () => {
  it("com rede: segue o nextSlot (institucional e depois clientes)", () => {
    const a = pickPlayable(prog(), cursor0, false);
    expect(a?.kind).toBe("house");
    const b = pickPlayable(prog(), a!.cursor, false);
    expect(b?.kind).toBe("client");
  });
  it("sem rede: pula os clientes e fica nos institucionais", () => {
    let c = cursor0;
    for (let i = 0; i < 6; i += 1) {
      const s = pickPlayable(prog(1, 3), c, true);
      expect(s?.kind).toBe("house");
      c = s!.cursor;
    }
  });
  it("sem rede e sem institucional: nada para tocar (fica o pôster), sem laço infinito", () => {
    expect(pickPlayable(prog(0, 3), cursor0, true)).toBeNull();
  });
  it("programa vazio: null", () => {
    expect(pickPlayable(prog(0, 0), cursor0, false)).toBeNull();
  });
});

describe("clipInProgram", () => {
  const p = prog();
  it("o pré-carregado ainda vale só se continua no programa novo", () => {
    expect(clipInProgram(p, "client", U(1))).toBe(true);
    expect(clipInProgram(p, "house", U(100))).toBe(true);
    expect(clipInProgram(p, "client", U(100))).toBe(false);
    expect(clipInProgram({ ...p, clients: [] }, "client", U(1))).toBe(false);
    expect(clipInProgram(null, "house", U(100))).toBe(false);
  });
});

describe("playBody (\"tocou\")", () => {
  it("cliente: kind client com o play da exibição", () => {
    expect(playBody({ kind: "client", id: U(1), play: U(9), fromCache: false, duration: 6 })).toEqual({
      video: U(1), play: U(9), kind: "client",
    });
  });
  it("institucional vindo do Mux: kind house com a duração", () => {
    expect(playBody({ kind: "house", id: U(100), play: U(9), fromCache: false, duration: 31.4 })).toEqual({
      video: U(100), play: U(9), kind: "house", duration_s: 31.4,
    });
  });
  it("institucional do cache local: não manda (não passou pelo Mux)", () => {
    expect(playBody({ kind: "house", id: U(100), play: U(9), fromCache: true, duration: 31 })).toBeNull();
  });
  it("institucional do Mux sem duração conhecida: manda sem duration_s", () => {
    expect(playBody({ kind: "house", id: U(100), play: U(9), fromCache: false, duration: Number.NaN })).toEqual({
      video: U(100), play: U(9), kind: "house",
    });
  });
});

describe("uuid4", () => {
  it("sai no formato que a rota aceita, versão 4", () => {
    const id = uuid4(new Uint8Array(16).fill(255));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuid4(new Uint8Array(16))).toBe("00000000-0000-4000-8000-000000000000");
  });
});

describe("URLs do Mux", () => {
  it("MP4 highest e HLS", () => {
    expect(muxMp4("abc")).toBe("https://stream.mux.com/abc/highest.mp4");
    expect(muxHls("abc")).toBe("https://stream.mux.com/abc.m3u8");
  });
});
