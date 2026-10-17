// Dados de teste do Apareça na TV na cópia local do Depot (depotmedieval-copia), só no NocoDB
// do Docker. Liga a Comunidade e o Apareça (apareca_allowed e apareca_enabled), cria as zonas
// Salão e Bar, põe a mesa E74B9X no Bar, cria 2 institucionais "ready" que apontam para o Mux
// falso (fake-mux.mjs) e 2 TVs já pareadas (uma em cada zona), com segredos novos a cada rodada.
//
//   node --env-file=.env.local scripts/apareca/seed-local.mjs            liga e cria
//   node --env-file=.env.local scripts/apareca/seed-local.mjs --desfazer volta ao que era
//
// Opções: --slug=X (padrão depotmedieval-copia), --mesa=CODIGO (padrão E74B9X),
//         --exibicoes=N (1 a 3; padrão 1, o mesmo do painel; o celular vê "Olhe para a TV agora!" nos 20 s da 1ª exibição).
//
// O estado de antes (interruptores, apareca_config e os Ids que já existiam nas tabelas do
// Apareça e das TVs) fica em .local-blob/apareca-seed-estado.json (fora do git), junto com os
// segredos das 2 TVs de teste, que o e2e lê. Rodar de novo mantém o "antes" da primeira vez.
// "--desfazer" apaga tudo o que nasceu depois (vídeos, institucionais, tally, TVs) e devolve os
// interruptores e a config. Recusa qualquer NOCODB_URL que não seja http://localhost, antes de
// qualquer chamada.

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertLocalNocodb } from "../comunidade/seed-local.mjs";
import { HOUSE_MP4, mediaDuration } from "./fake-mux.mjs";

export { assertLocalNocodb };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
export const STATE_FILE = path.join(process.env.LOCAL_BLOB_DIR || path.join(ROOT, ".local-blob"), "apareca-seed-estado.json");

// uids fixos: o seed atualiza as mesmas linhas a cada rodada.
export const SEED_IDS = {
  zoneSalao: "5eed0000-a9a0-4000-8000-000000000001",
  zoneBar: "5eed0000-a9a0-4000-8000-000000000002",
  house: ["5eed0000-a9a0-4000-8000-000000000011", "5eed0000-a9a0-4000-8000-000000000012"],
  tvBar: "5eed0000-a9a0-4000-8000-000000000021",
  tvSalao: "5eed0000-a9a0-4000-8000-000000000022",
};
// Ids do Mux falso (só letras e números, como no Mux): qualquer playback desconhecido recebe o MP4 de public/.
export const HOUSE_MUX = [
  { asset: "seedcasa1asset", playback: "seedcasa1play" },
  { asset: "seedcasa2asset", playback: "seedcasa2play" },
];
// Tabelas que o e2e pode encher: no --desfazer, tudo com Id novo deste restaurante some.
export const TRACKED = ["apareca_videos", "apareca_house_videos", "apareca_tally", "community_tvs", "community_tally"];
// Campos do restaurante que o seed muda e o --desfazer devolve.
export const RESTAURANT_FIELDS = ["community_enabled", "apareca_allowed", "apareca_enabled", "apareca_config"];

const iso = (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * Linhas do seed (puro: sem rede nem disco).
 * @param {{ rid: string; tableId: string; now: Date; plays?: number; houseMs: number; secrets: { bar: string; salao: string }; config?: unknown }} i
 */
export function buildSeed({ rid, tableId, now, plays = 1, houseMs, secrets, config }) {
  if (!Number.isInteger(plays) || plays < 1 || plays > 3) throw new Error("exibições de 1 a 3");
  const t = now.getTime();
  const base = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  const apareca_config = {
    ...base,
    mode: "manual",
    rule: { kind: "intercalar", house_every: 1, clients_max: 3 },
    plays,
    device_per_hour: 2,
    hours: null,
    retention_h: 6,
    zones: [
      { id: SEED_IDS.zoneSalao, name: "Salão" },
      { id: SEED_IDS.zoneBar, name: "Bar" },
    ],
    table_zones: { [tableId]: SEED_IDS.zoneBar },
    tv_zones: { [SEED_IDS.tvBar]: SEED_IDS.zoneBar, [SEED_IDS.tvSalao]: SEED_IDS.zoneSalao },
  };
  const house = SEED_IDS.house.map((uid, k) => ({
    uid,
    restaurant_id: rid,
    title: k === 0 ? "Boas-vindas da casa (teste)" : "Prato da noite (teste)",
    mux_upload_id: null,
    mux_asset_id: HOUSE_MUX[k].asset,
    mux_playback_id: HOUSE_MUX[k].playback,
    duration_ms: houseMs,
    aspect: "16:9",
    position: k + 1,
    active: true,
    status: "ready",
    created_at: iso(t - (2 - k) * 60_000),
  }));
  const tv = (uid, label, secret) => ({
    uid,
    restaurant_id: rid,
    label,
    pair_code: null,
    pair_expires_at: null,
    secret_hash: sha256(secret),
    paired_at: iso(t),
    last_seen_at: null,
    revoked: false,
    created_at: iso(t),
  });
  const tvs = [tv(SEED_IDS.tvBar, "TV do Bar (teste)", secrets.bar), tv(SEED_IDS.tvSalao, "TV do Salão (teste)", secrets.salao)];
  return {
    restaurant: { community_enabled: true, apareca_allowed: true, apareca_enabled: true, apareca_config },
    house,
    tvs,
  };
}

/**
 * O que o --desfazer faz (puro): os campos de antes do restaurante e os Ids a apagar
 * (tudo deste restaurante que não existia antes do seed).
 * @param {{ before: { restaurant: Record<string, unknown>; ids: Record<string, number[]> }; current: Record<string, { Id: number }[]> }} i
 */
export function undoPlan({ before, current }) {
  const restaurant = Object.fromEntries(RESTAURANT_FIELDS.map((k) => [k, before.restaurant[k] ?? null]));
  const remove = {};
  for (const table of TRACKED) {
    const had = new Set(before.ids[table] ?? []);
    const ids = (current[table] ?? []).map((r) => r.Id).filter((id) => !had.has(id));
    if (ids.length) remove[table] = ids;
  }
  return { restaurant, remove };
}

// ---------- rede e disco ----------

function args(argv) {
  const val = (k, d) => argv.find((x) => x.startsWith(`--${k}=`))?.split("=")[1] ?? d;
  const plays = Number(val("exibicoes", "1"));
  if (!Number.isInteger(plays) || plays < 1 || plays > 3) throw new Error("--exibicoes precisa ser 1, 2 ou 3.");
  return { undo: argv.includes("--desfazer"), slug: val("slug", "depotmedieval-copia"), mesa: val("mesa", "E74B9X"), plays };
}

/** Cliente mínimo do NocoDB local. Lança antes de qualquer chamada se o endereço não for local. */
export async function localNocodb(env, fetchImpl = fetch) {
  const API = assertLocalNocodb(env.NOCODB_URL);
  const TOKEN = env.NOCODB_API_TOKEN;
  if (!TOKEN) throw new Error("Falta NOCODB_API_TOKEN (rode com --env-file=.env.local).");
  const api = async (p, init = {}) => {
    const res = await fetchImpl(API + p, { ...init, headers: { "xc-token": TOKEN, "content-type": "application/json" } });
    const body = await res.text();
    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${p.split("?")[0]}: ${res.status} ${body.slice(0, 200)}`);
    return body ? JSON.parse(body) : null;
  };
  let baseId = env.NOCODB_BASE_ID;
  if (!baseId) {
    baseId = (await api("/api/v2/meta/bases/")).list.find((b) => b.title === "Cardápio Digital")?.id;
    if (!baseId) throw new Error('Base "Cardápio Digital" não encontrada; rode scripts/nocodb/setup.mjs.');
  }
  const tables = (await api(`/api/v2/meta/bases/${baseId}/tables`)).list;
  const tid = (n) => {
    const t = tables.find((x) => x.title === n || x.table_name === n);
    if (!t) throw new Error(`Tabela ${n} não existe; rode scripts/nocodb/setup.mjs.`);
    return t.id;
  };
  const where = (w) => Object.entries(w).map(([k, v]) => `(${k},eq,${v})`).join("~and");
  const enc = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v && typeof v === "object" ? JSON.stringify(v) : v]));
  return {
    list: async (t, w) => {
      const out = [];
      for (let offset = 0; ; offset += 1000) {
        const r = await api(`/api/v2/tables/${tid(t)}/records?limit=1000&offset=${offset}&where=${encodeURIComponent(where(w))}`);
        out.push(...r.list);
        if (r.pageInfo?.isLastPage !== false || !r.list.length) return out;
      }
    },
    patch: (t, rows) => api(`/api/v2/tables/${tid(t)}/records`, { method: "PATCH", body: JSON.stringify(rows.map(enc)) }),
    insert: (t, rows) => api(`/api/v2/tables/${tid(t)}/records`, { method: "POST", body: JSON.stringify(rows.map(enc)) }),
    remove: (t, ids) => api(`/api/v2/tables/${tid(t)}/records`, { method: "DELETE", body: JSON.stringify(ids.map((Id) => ({ Id }))) }),
  };
}

async function readState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

/**
 * O seed inteiro. env/argv/fetch injetáveis para o teste (que confere a recusa antes da rede).
 * @param {Record<string, string | undefined>} [env]
 * @param {string[]} [argv]
 * @param {(url: string, init?: object) => Promise<Response>} [fetchImpl]
 * @param {(s: string) => void} [log]
 */
export async function run(env = process.env, argv = process.argv.slice(2), fetchImpl = fetch, log = console.log) {
  assertLocalNocodb(env.NOCODB_URL);
  const opt = args(argv);
  const db = await localNocodb(env, fetchImpl);
  const [r] = await db.list("restaurants", { slug: opt.slug });
  if (!r) throw new Error(`Restaurante ${opt.slug} não existe no NocoDB local.`);
  const rid = r.uid;
  const saved = await readState();

  if (opt.undo) {
    if (!saved || saved.rid !== rid) throw new Error("Nada a desfazer (sem estado salvo deste restaurante).");
    const current = {};
    for (const t of TRACKED) current[t] = await db.list(t, { restaurant_id: rid });
    const plan = undoPlan({ before: saved.before, current });
    await db.patch("restaurants", [{ Id: r.Id, ...plan.restaurant }]);
    for (const [t, ids] of Object.entries(plan.remove)) {
      for (let i = 0; i < ids.length; i += 100) await db.remove(t, ids.slice(i, i + 100));
      log(`apagado: ${ids.length} em ${t}`);
    }
    await rm(STATE_FILE, { force: true });
    log(`${opt.slug} voltou ao que era (interruptores e apareca_config).`);
    return { undone: plan };
  }

  const [table] = (await db.list("dining_tables", { restaurant_id: rid, code: opt.mesa })).filter((x) => x.restaurant_id === rid);
  if (!table) throw new Error(`Mesa ${opt.mesa} não existe em ${opt.slug}.`);

  // "Antes" só na primeira rodada: rodar de novo não pode guardar o estado já mexido.
  let state = saved && saved.rid === rid ? saved : null;
  if (!state) {
    const ids = {};
    for (const t of TRACKED) ids[t] = (await db.list(t, { restaurant_id: rid })).map((x) => x.Id);
    state = {
      rid,
      slug: opt.slug,
      before: { restaurant: Object.fromEntries(RESTAURANT_FIELDS.map((k) => [k, r[k] ?? null])), ids },
    };
  }
  state.secrets = { bar: randomBytes(32).toString("hex"), salao: randomBytes(32).toString("hex") };
  state.mesa = opt.mesa;
  state.table_id = table.uid;

  const houseS = mediaDuration(readFileSync(HOUSE_MP4)) ?? 8;
  const seed = buildSeed({ rid, tableId: table.uid, now: new Date(), plays: opt.plays, houseMs: Math.round(houseS * 1000), secrets: state.secrets, config: r.apareca_config });

  await mkdir(path.dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });

  await db.patch("restaurants", [{ Id: r.Id, ...seed.restaurant }]);
  log(`Comunidade e Apareça ligados em ${opt.slug}; zonas Salão e Bar; mesa ${opt.mesa} no Bar; ${opt.plays} exibição(ões) por vídeo`);
  const upsert = async (t, rows) => {
    for (const row of rows) {
      const [have] = await db.list(t, { uid: row.uid });
      if (have) await db.patch(t, [{ ...row, Id: have.Id }]);
      else await db.insert(t, [row]);
      log(`${have ? "atualizado" : "criado"}: ${t} ${row.uid}`);
    }
  };
  await upsert("apareca_house_videos", seed.house);
  await upsert("community_tvs", seed.tvs);
  log(`estado e segredos das TVs de teste em ${path.relative(ROOT, STATE_FILE)} (fora do git)`);
  log("O cache do servidor de teste leva até 60 s para ver a mudança (ou suba o servidor depois do seed).");
  return { seed, state };
}

function calledDirectly() {
  try {
    return !!process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (calledDirectly()) {
  run().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
