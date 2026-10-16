// Dados de teste da Comunidade na cópia local do Depot (depotmedieval-copia), só no NocoDB
// do Docker. Liga a Comunidade, cria 1 enquete aberta com 3 opções ligadas a pratos do
// cardápio, 1 agendada para daqui a 1 h e 3 fotos da casa no Mural, com os arquivos
// copiados para .local-blob/ (o driver local de STORAGE_DRIVER=local; nada vai ao Blob).
//
//   node --env-file=.env.local scripts/comunidade/seed-local.mjs [opções]
//
// Opções:
//   --minutos=N      duração da enquete aberta a partir de agora (padrão 30)
//   --limpar-votos   apaga os votos das enquetes do seed (volta ao "seja o primeiro a votar")
//   --aberto-agora   põe o horário da cópia em 00:00–23:59 todos os dias (a Comunidade só
//                    abre no horário do restaurante); para voltar, ajuste no painel
//   --slug=X         outro restaurante de teste (padrão depotmedieval-copia)
//
// Pode rodar de novo: as linhas têm uids fixos e são atualizadas (as datas andam para agora).
// Recusa qualquer NOCODB_URL que não seja http://localhost, antes de qualquer chamada.

import { copyFile, mkdir } from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
// Fotos do protótipo aprovado (docs/ fica só na árvore principal, fora do worktree).
const ASSETS = process.env.SEED_ASSETS_DIR ?? "/Users/joao/Desktop/joaoai/Aplicativos/Cardápio Digital/docs/prototipos/comunidade/assets";

// uids fixos: o seed atualiza as mesmas linhas a cada rodada.
export const SEED_IDS = {
  pollOpen: "5eed0000-c0de-4000-8000-000000000001",
  pollNext: "5eed0000-c0de-4000-8000-000000000002",
  posts: ["5eed0000-c0de-4000-8000-000000000011", "5eed0000-c0de-4000-8000-000000000012", "5eed0000-c0de-4000-8000-000000000013"],
};

// Pratos preferidos (pelo nome na cópia do Depot) e a foto do protótipo de cada post.
const POLL_DISHES = ["burger two", "calabresa", "valhala"];
const POST_FILES = [
  { dish: "burger two", file: "cat3.webp", agoMin: 5 },
  { dish: "calabresa", file: "cat2.webp", agoMin: 12 },
  { dish: "valhala", file: "cat5.webp", agoMin: 22 },
];

const MIN = 60_000;

/** Endereço do NocoDB de teste: só http://localhost[:porta]. Qualquer outro lança erro. */
export function assertLocalNocodb(raw) {
  if (typeof raw !== "string" || !raw) throw new Error("Falta NOCODB_URL (http://localhost:8080).");
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`NOCODB_URL inválida: ${raw}`);
  }
  const plain = u.protocol === "http:" && u.hostname === "localhost" && !u.username && !u.password && !u.search && !u.hash;
  if (!plain || (u.pathname !== "/" && u.pathname !== "")) {
    throw new Error(`Recusado: o seed só roda no NocoDB local (http://localhost), não em ${raw}.`);
  }
  return `http://localhost${u.port ? `:${u.port}` : ""}`;
}

/** URL que o driver local serve (/api/arquivos-locais/<pathname>), com cada pedaço codificado. */
export function localFileUrl(pathname) {
  return `/api/arquivos-locais/${pathname.split("/").map(encodeURIComponent).join("/")}`;
}

// ISO em segundos inteiros: o NocoDB perde os milissegundos.
const iso = (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * Linhas do seed (puro: sem rede nem disco).
 * @param {{ rid: string; items: { uid: string; name: string }[]; now: Date; minutes: number }} i
 */
export function buildSeed({ rid, items, now, minutes }) {
  const t = now.getTime();
  const used = new Set();
  const byName = (name) => items.find((it) => it.name.trim().toLowerCase() === name && !used.has(it.uid));
  const pick = (name) => {
    const it = byName(name) ?? items.find((x) => !used.has(x.uid));
    if (!it) throw new Error("O cardápio precisa de pelo menos 3 pratos.");
    used.add(it.uid);
    return it;
  };
  const dishes = POLL_DISHES.map(pick);
  const ids = /** @type {const} */ (["a", "b", "c"]);

  const start = t - MIN;
  const polls = [
    {
      uid: SEED_IDS.pollOpen,
      restaurant_id: rid,
      template: "custom",
      question: "Qual prato sai primeiro hoje?",
      options: dishes.map((d, k) => ({ id: ids[k], label: d.name, item_id: d.uid })),
      starts_at: iso(start),
      ends_at: iso(start + (minutes + 1) * MIN),
      closed_at: null,
      created_at: iso(start),
    },
    {
      uid: SEED_IDS.pollNext,
      restaurant_id: rid,
      template: "music",
      question: "Qual a próxima música?",
      options: [
        { id: "a", label: "Rock clássico", item_id: null },
        { id: "b", label: "Samba", item_id: null },
        { id: "c", label: "Jazz", item_id: null },
      ],
      starts_at: iso(t + 60 * MIN),
      ends_at: iso(t + 70 * MIN),
      closed_at: null,
      created_at: iso(t),
    },
  ];

  used.clear();
  const files = [];
  const posts = POST_FILES.map((f, k) => {
    const dish = pick(f.dish);
    const base = `${rid}/comunidade/seed-${k + 1}`;
    files.push({ pathname: base, file: f.file });
    return {
      uid: SEED_IDS.posts[k],
      restaurant_id: rid,
      item_id: dish.uid,
      photo_path: localFileUrl(`${base}-full.webp`),
      thumb_path: localFileUrl(`${base}-thumb.webp`),
      source: "house",
      status: "approved",
      on_tv: true,
      hidden_at: null,
      created_at: iso(t - f.agoMin * MIN),
    };
  });
  // files: o arquivo do protótipo que vira a foto e a miniatura de cada post.
  return { polls, posts, files };
}

// ---------- rede e disco (só quando chamado direto) ----------

function args() {
  const a = process.argv.slice(2);
  const val = (k, d) => a.find((x) => x.startsWith(`--${k}=`))?.split("=")[1] ?? d;
  const minutes = Number(val("minutos", "30"));
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) throw new Error("--minutos precisa ser um inteiro de 1 a 600.");
  return { minutes, clearVotes: a.includes("--limpar-votos"), openNow: a.includes("--aberto-agora"), slug: val("slug", "depotmedieval-copia") };
}

async function main() {
  const API = assertLocalNocodb(process.env.NOCODB_URL);
  const TOKEN = process.env.NOCODB_API_TOKEN;
  if (!TOKEN) throw new Error("Falta NOCODB_API_TOKEN (rode com --env-file=.env.local).");
  const opt = args();

  const api = async (p, init = {}) => {
    const res = await fetch(API + p, { ...init, headers: { "xc-token": TOKEN, "content-type": "application/json" } });
    const body = await res.text();
    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${p.split("?")[0]}: ${res.status} ${body.slice(0, 200)}`);
    return body ? JSON.parse(body) : null;
  };

  let baseId = process.env.NOCODB_BASE_ID;
  if (!baseId) {
    const bases = await api("/api/v2/meta/bases/");
    baseId = bases.list.find((b) => b.title === "Cardápio Digital")?.id;
    if (!baseId) throw new Error('Base "Cardápio Digital" não encontrada; rode scripts/nocodb/setup.mjs.');
  }
  const tables = (await api(`/api/v2/meta/bases/${baseId}/tables`)).list;
  const tid = (n) => {
    const t = tables.find((x) => x.title === n || x.table_name === n);
    if (!t) throw new Error(`Tabela ${n} não existe; rode scripts/nocodb/setup.mjs.`);
    return t.id;
  };
  const where = (w) => Object.entries(w).map(([k, v]) => `(${k},eq,${v})`).join("~and");
  const list = async (t, w) => (await api(`/api/v2/tables/${tid(t)}/records?limit=1000&where=${encodeURIComponent(where(w))}`)).list;
  const json = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, k === "options" ? JSON.stringify(v) : v]));

  const [r] = await list("restaurants", { slug: opt.slug });
  if (!r) throw new Error(`Restaurante ${opt.slug} não existe no NocoDB local.`);
  const rid = r.uid;
  const patch = { Id: r.Id, community_enabled: true };
  if (opt.openNow) patch.opening_hours = JSON.stringify(Array.from({ length: 7 }, () => [{ open: "00:00", close: "23:59" }]));
  await api(`/api/v2/tables/${tid("restaurants")}/records`, { method: "PATCH", body: JSON.stringify([patch]) });
  console.log(`Comunidade ligada em ${opt.slug}${opt.openNow ? " (horário 00:00–23:59)" : ""}`);

  const items = (await list("items", { restaurant_id: rid })).map((i) => ({ uid: i.uid, name: String(i.name ?? "") }));
  const seed = buildSeed({ rid, items, now: new Date(), minutes: opt.minutes });

  // Arquivos pelo driver local: <raiz>/.local-blob/<rid>/comunidade/seed-N-{full,thumb}.webp.
  const root = path.resolve(process.env.LOCAL_BLOB_DIR || path.join(ROOT, ".local-blob"));
  for (const p of seed.files) {
    await mkdir(path.join(root, rid, "comunidade"), { recursive: true });
    for (const kind of ["full", "thumb"]) {
      const dest = path.join(root, `${p.pathname}-${kind}.webp`);
      if (!dest.startsWith(root + path.sep)) throw new Error("caminho fora da raiz local");
      await copyFile(path.join(ASSETS, p.file), dest);
    }
  }

  const upsert = async (table, rows) => {
    for (const row of rows) {
      const [have] = await list(table, { uid: row.uid });
      if (have) await api(`/api/v2/tables/${tid(table)}/records`, { method: "PATCH", body: JSON.stringify([{ ...json(row), Id: have.Id }]) });
      else await api(`/api/v2/tables/${tid(table)}/records`, { method: "POST", body: JSON.stringify([json(row)]) });
      console.log(`${have ? "atualizado" : "criado"}: ${table} ${row.uid}`);
    }
  };
  await upsert("community_polls", seed.polls);
  await upsert("community_posts", seed.posts);

  if (opt.clearVotes) {
    for (const p of seed.polls) {
      const votes = await list("community_votes", { restaurant_id: rid, poll_id: p.uid });
      if (votes.length) {
        await api(`/api/v2/tables/${tid("community_votes")}/records`, { method: "DELETE", body: JSON.stringify(votes.map((v) => ({ Id: v.Id }))) });
      }
      console.log(`votos apagados: ${votes.length} (${p.uid})`);
    }
  }

  const tablesRows = await list("dining_tables", { restaurant_id: rid });
  console.log(`mesas: ${tablesRows.map((t) => `${t.code}${t.active ? "" : " (desativada)"}`).join(", ") || "nenhuma"}`);
  console.log(`enquete aberta até ${seed.polls[0].ends_at}; próxima às ${seed.polls[1].starts_at}`);
  console.log("Os dados em cache no servidor de teste levam até 60 s para aparecer (ou reinicie o next dev).");
}

// Só roda quando chamado direto; importado pelos testes, não (o "á" e o espaço do caminho
// vêm codificados em import.meta.url, então compara os caminhos reais).
function calledDirectly() {
  try {
    return !!process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (calledDirectly()) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
