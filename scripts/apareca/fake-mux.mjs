// Mux falso da verificação ponta a ponta do Apareça (Tarefa 18). Só escuta em 127.0.0.1 e
// nunca fala com o Mux de verdade. Rode o app apontando para ele:
//
//   MUX_API_BASE=http://localhost:3999/video/v1 MUX_STREAM_BASE=http://localhost:3999/stream \
//   MUX_IMAGE_BASE=http://localhost:3999/image MUX_TOKEN_ID=falso MUX_TOKEN_SECRET=falso ...
//
//   node scripts/apareca/fake-mux.mjs [--porta=3999]
//
// O que imita (só o que o app usa, mux.ts e mux-video.ts):
//   POST /video/v1/uploads              cria o envio e devolve a URL de PUT (com CORS)
//   PUT  /_upload/:id                   recebe o arquivo; o asset nasce "preparing"
//   GET  /video/v1/uploads/:id          waiting → asset_created (com asset_id)
//   PUT  /video/v1/uploads/:id/cancel   cancela
//   GET  /video/v1/assets/:id           "ready" 3 s depois do PUT, com a duração lida do arquivo
//   DELETE /video/v1/assets/:id         apaga (204; 404 se já não existe)
//   GET  /stream/:playback/highest.mp4  o arquivo enviado (cliente) ou um MP4 de public/ (institucional)
//   GET  /image/:playback/thumbnail.jpg um JPG de public/
//   GET  /_estado                       envios e assets (sem os bytes), para o roteiro conferir
//
// Exporta startFakeMux() para o e2e subir no mesmo processo e mediaDuration() para o seed.

import { createServer } from "node:http";
import { readFileSync, realpathSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
export const HOUSE_MP4 = path.join(ROOT, "public/demo/v-forno.mp4");
export const FRAME_JPG = path.join(ROOT, "public/demo/v-rocambole-poster.jpg");
export const READY_MS = 3_000;
const MAX_UPLOAD = 250 * 1024 * 1024;

// ---------- duração do arquivo (MP4 inteiro ou fragmentado, WebM) ----------

const u32 = (b, o) => b.readUInt32BE(o);
const u64 = (b, o) => Number(b.readBigUInt64BE(o));
const MP4_CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "moof", "traf", "mvex", "edts"]);

function mp4Duration(buf) {
  let movie = 0;
  const tracks = new Map(); // track_ID -> { scale, dur, end }
  let cur = null; // trak em leitura: { id, scale, dur }
  let frag = null; // traf em leitura: { id, base, defDur, sum }
  const walk = (start, end) => {
    let o = start;
    while (o + 8 <= end) {
      let size = u32(buf, o);
      const type = buf.toString("latin1", o + 4, o + 8);
      let head = 8;
      if (size === 1) {
        if (o + 16 > end) return;
        size = u64(buf, o + 8);
        head = 16;
      } else if (size === 0) size = end - o;
      if (size < head || o + size > end) return;
      const body = o + head;
      const v = buf[body];
      if (type === "mvhd") {
        const scale = v === 1 ? u32(buf, body + 20) : u32(buf, body + 12);
        const dur = v === 1 ? u64(buf, body + 24) : u32(buf, body + 16);
        if (scale) movie = dur / scale;
      } else if (type === "trak") {
        cur = { id: 0, scale: 0, dur: 0 };
        walk(body, o + size);
        if (cur.id) tracks.set(cur.id, { scale: cur.scale, dur: cur.dur, end: 0 });
        cur = null;
      } else if (type === "tkhd" && cur) {
        cur.id = v === 1 ? u32(buf, body + 20) : u32(buf, body + 12);
      } else if (type === "mdhd" && cur) {
        cur.scale = v === 1 ? u32(buf, body + 20) : u32(buf, body + 12);
        cur.dur = v === 1 ? u64(buf, body + 24) : u32(buf, body + 16);
      } else if (type === "traf") {
        frag = { id: 0, base: 0, defDur: 0, sum: 0 };
        walk(body, o + size);
        const t = tracks.get(frag.id);
        if (t) t.end = Math.max(t.end, frag.base + frag.sum);
        frag = null;
      } else if (type === "tfhd" && frag) {
        const flags = buf.readUIntBE(body + 1, 3);
        frag.id = u32(buf, body + 4);
        let p = body + 8;
        if (flags & 0x1) p += 8;
        if (flags & 0x2) p += 4;
        if (flags & 0x8) frag.defDur = u32(buf, p);
      } else if (type === "tfdt" && frag) {
        frag.base = v === 1 ? u64(buf, body + 4) : u32(buf, body + 4);
      } else if (type === "trun" && frag) {
        const flags = buf.readUIntBE(body + 1, 3);
        const count = u32(buf, body + 4);
        let p = body + 8;
        if (flags & 0x1) p += 4;
        if (flags & 0x4) p += 4;
        const per = ((flags & 0x100) ? 4 : 0) + ((flags & 0x200) ? 4 : 0) + ((flags & 0x400) ? 4 : 0) + ((flags & 0x800) ? 4 : 0);
        for (let i = 0; i < count && p + per <= o + size; i++, p += per) frag.sum += flags & 0x100 ? u32(buf, p) : frag.defDur;
      } else if (MP4_CONTAINERS.has(type)) {
        walk(body, o + size);
      }
      o += size;
    }
  };
  walk(0, buf.length);
  let best = movie;
  for (const t of tracks.values()) {
    if (!t.scale) continue;
    best = Math.max(best, t.dur / t.scale, t.end / t.scale);
  }
  return best > 0 ? best : null;
}

// EBML: id com o marcador, tamanho sem ele; tamanho "desconhecido" (todos os bits 1) = -1.
function vint(buf, o, keepMarker) {
  const first = buf[o];
  if (first === undefined || first === 0) return null;
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || o + len > buf.length) return null;
  let value = keepMarker ? first : first & (0xff >> len);
  let allOnes = value === (0xff >> len);
  for (let i = 1; i < len; i++) {
    value = value * 256 + buf[o + i];
    if (buf[o + i] !== 0xff) allOnes = false;
  }
  return { value, len, unknown: !keepMarker && allOnes };
}

const EBML_MASTER = new Set([0x18538067, 0x1549a966, 0x1f43b675, 0xa0]); // Segment, Info, Cluster, BlockGroup

function webmDuration(buf) {
  let scale = 1_000_000; // ns por unidade (padrão do Matroska)
  let declared = 0;
  let cluster = 0;
  let last = 0;
  let o = 0;
  while (o < buf.length) {
    const id = vint(buf, o, true);
    if (!id) break;
    const size = vint(buf, o + id.len, false);
    if (!size) break;
    const body = o + id.len + size.len;
    if (EBML_MASTER.has(id.value)) {
      if (id.value === 0x1f43b675) cluster = 0;
      o = body; // desce (aceita tamanho desconhecido, como o MediaRecorder grava)
      continue;
    }
    if (size.unknown || body + size.value > buf.length) break;
    if (id.value === 0x2ad7b1) scale = buf.readUIntBE(body, Math.min(6, size.value));
    else if (id.value === 0x4489) declared = size.value === 4 ? buf.readFloatBE(body) : buf.readDoubleBE(body);
    else if (id.value === 0xe7) cluster = buf.readUIntBE(body, Math.min(6, size.value));
    else if (id.value === 0xa3 || id.value === 0xa1) {
      const track = vint(buf, body, false);
      if (track) last = Math.max(last, cluster + buf.readInt16BE(body + track.len));
    }
    o = body + size.value;
  }
  const s = (Math.max(declared, last) * scale) / 1e9;
  return s > 0 ? s : null;
}

/** Duração em segundos de um MP4 (inteiro ou fragmentado) ou WebM; null se não der para ler. */
export function mediaDuration(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null;
  try {
    if (buf.readUInt32BE(0) === 0x1a45dfa3) return webmDuration(buf);
    return mp4Duration(buf);
  } catch {
    return null;
  }
}

// ---------- servidor ----------

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, PUT, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, range",
  "access-control-expose-headers": "content-length, content-range, accept-ranges",
};
const newId = (n = 12) => randomBytes(n).toString("hex"); // só letras e números, como o Mux

/**
 * Sobe o Mux falso. Devolve { port, state, close() }; state.assets/state.uploads são Maps.
 * @param {{ port?: number; readyMs?: number; log?: (s: string) => void }} [o]
 */
export function startFakeMux({ port = 3999, readyMs = READY_MS, log = () => {} } = {}) {
  const houseMp4 = readFileSync(HOUSE_MP4);
  const frame = readFileSync(FRAME_JPG);
  const state = { uploads: new Map(), assets: new Map(), deleted: [], calls: [] };
  const base = `http://localhost:${port}`;

  const json = (res, status, data) => {
    res.writeHead(status, { ...CORS, "content-type": "application/json", "cache-control": "no-store" });
    res.end(data === undefined ? "" : JSON.stringify(data));
  };
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      const parts = [];
      let n = 0;
      req.on("data", (c) => {
        n += c.length;
        if (n > MAX_UPLOAD) {
          reject(new Error("grande demais"));
          req.destroy();
        } else parts.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(parts)));
      req.on("error", reject);
    });
  const assetView = (a) => {
    const ready = Date.now() >= a.readyAt;
    return {
      id: a.id,
      status: ready ? "ready" : "preparing",
      ...(ready && a.duration ? { duration: a.duration } : {}),
      playback_ids: ready ? [{ id: a.playback, policy: "public" }] : [],
      passthrough: a.passthrough,
      static_renditions: { status: ready ? "ready" : "preparing", files: [{ name: "highest.mp4", resolution: "highest", status: ready ? "ready" : "preparing" }] },
    };
  };
  const sendMedia = (req, res, buf, type) => {
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    const headers = { ...CORS, "content-type": type, "accept-ranges": "bytes", "cache-control": "public, max-age=60" };
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : buf.length - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : buf.length - 1;
      start = Math.max(0, start);
      end = Math.min(buf.length - 1, end);
      if (start > end) {
        res.writeHead(416, { ...headers, "content-range": `bytes */${buf.length}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${buf.length}`, "content-length": end - start + 1 });
      return res.end(req.method === "HEAD" ? undefined : buf.subarray(start, end + 1));
    }
    res.writeHead(200, { ...headers, "content-length": buf.length });
    res.end(req.method === "HEAD" ? undefined : buf);
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", base);
    const p = url.pathname;
    const m = req.method ?? "GET";
    state.calls.push(`${m} ${p.replace(/[0-9a-f]{24}/g, ":id")}`);
    try {
      if (m === "OPTIONS") return json(res, 204);
      if (p === "/_estado") {
        return json(res, 200, {
          uploads: [...state.uploads.values()].map(({ id, status, asset_id, passthrough }) => ({ id, status, asset_id, passthrough })),
          assets: [...state.assets.values()].map(({ id, playback, duration, passthrough, deleted, bytes, type }) => ({ id, playback, duration, passthrough, deleted, bytes, type })),
        });
      }
      const api = /^\/video\/v1\/(uploads|assets)(?:\/([A-Za-z0-9]+))?(?:\/(cancel|static-renditions))?$/.exec(p);
      if (api) {
        if (!/^Basic /.test(req.headers.authorization ?? "")) return json(res, 401, { error: { type: "unauthorized" } });
        const [, kind, id, extra] = api;
        if (kind === "uploads" && !id && m === "POST") {
          const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
          const up = { id: newId(), status: "waiting", asset_id: null, passthrough: body?.new_asset_settings?.passthrough ?? null, settings: body?.new_asset_settings ?? null };
          state.uploads.set(up.id, up);
          return json(res, 201, { data: { id: up.id, url: `${base}/_upload/${up.id}`, status: up.status, cors_origin: body?.cors_origin, new_asset_settings: up.settings } });
        }
        if (kind === "uploads" && id) {
          const up = state.uploads.get(id);
          if (!up) return json(res, 404, { error: { type: "not_found" } });
          if (extra === "cancel" && m === "PUT") {
            if (up.status === "waiting") up.status = "cancelled";
            return json(res, 200, { data: { id: up.id, status: up.status } });
          }
          if (m === "GET") return json(res, 200, { data: { id: up.id, status: up.status, ...(up.asset_id ? { asset_id: up.asset_id } : {}) } });
        }
        if (kind === "assets" && id) {
          const a = state.assets.get(id);
          if (!a || a.deleted) return json(res, 404, { error: { type: "not_found" } });
          if (m === "GET" && !extra) return json(res, 200, { data: assetView(a) });
          if (m === "DELETE" && !extra) {
            a.deleted = new Date().toISOString();
            state.deleted.push(a.id);
            log(`asset apagado ${a.id}`);
            return json(res, 204);
          }
          if (m === "POST" && extra === "static-renditions") return json(res, 201, { data: { id: newId(), status: "preparing" } });
        }
        return json(res, 404, { error: { type: "not_found" } });
      }
      const put = /^\/_upload\/([A-Za-z0-9]+)$/.exec(p);
      if (put && m === "PUT") {
        const up = state.uploads.get(put[1]);
        if (!up || up.status !== "waiting") return json(res, 404, {});
        const buf = await readBody(req);
        const asset = {
          id: newId(), playback: newId(), passthrough: up.passthrough, bytes: buf.length,
          type: String(req.headers["content-type"] ?? "application/octet-stream").split(";")[0],
          buf, duration: mediaDuration(buf), readyAt: Date.now() + readyMs, deleted: null,
        };
        state.assets.set(asset.id, asset);
        up.status = "asset_created";
        up.asset_id = asset.id;
        log(`envio recebido: ${buf.length} bytes, ${asset.type}, duração ${asset.duration?.toFixed(2) ?? "?"} s`);
        res.writeHead(200, CORS);
        return res.end();
      }
      const stream = /^\/stream\/([A-Za-z0-9]+)(\/[a-z]+\.mp4|\.m3u8)$/.exec(p);
      if (stream && (m === "GET" || m === "HEAD")) {
        if (stream[2] === ".m3u8") return json(res, 404, {});
        const a = [...state.assets.values()].find((x) => x.playback === stream[1]);
        if (a?.deleted) return json(res, 404, {});
        if (a) return sendMedia(req, res, a.buf, a.type.startsWith("video/") ? a.type : "video/mp4");
        return sendMedia(req, res, houseMp4, "video/mp4"); // institucionais do seed
      }
      if (/^\/image\/[A-Za-z0-9]+\/[a-z]+\.(jpg|png|webp)$/.test(p) && m === "GET") return sendMedia(req, res, frame, "image/jpeg");
      return json(res, 404, {});
    } catch (e) {
      return json(res, 500, { error: String(e?.message ?? e) });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () =>
      resolve({ port, base, state, close: () => new Promise((r) => server.close(() => r())) }),
    );
  });
}

function calledDirectly() {
  try {
    return !!process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (calledDirectly()) {
  const port = Number(process.argv.find((a) => a.startsWith("--porta="))?.split("=")[1] ?? 3999);
  startFakeMux({ port, log: (s) => console.log(s) }).then(
    (m) => console.log(`Mux falso em ${m.base} (Ctrl+C para parar)`),
    (e) => {
      console.error(e.message);
      process.exit(1);
    },
  );
}
