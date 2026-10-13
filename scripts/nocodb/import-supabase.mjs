// Copia para o NocoDB os dados exportados do Supabase (uso único, na troca de banco).
//
//   NOCODB_API_TOKEN=... node scripts/nocodb/import-supabase.mjs export.json
//
// export.json: { "<tabela>": [linhas do Supabase], ... }, com os ids originais. Pula as
// linhas cujo uid já está no NocoDB, então pode rodar de novo. Arquivos (fotos e logos)
// são copiados depois pelo app, em /api/migrar-arquivos.

import { readFileSync } from "node:fs";

const API = process.env.NOCODB_URL ?? "https://app.nocodb.com";
const BASE = process.env.NOCODB_BASE_ID ?? "plh3ygo9orriee2";
const TOKEN = process.env.NOCODB_API_TOKEN;
if (!TOKEN || !process.argv[2]) {
  console.error("uso: NOCODB_API_TOKEN=... node scripts/nocodb/import-supabase.mjs export.json");
  process.exit(1);
}

const JSON_COLS = new Set(["languages", "opening_hours", "payment_methods", "price_options", "tags"]);
const ORDER = ["users", "restaurants", "members", "categories", "items", "media", "translations", "dining_tables", "support_requests"];

async function api(path, init = {}) {
  for (let attempt = 0; ; attempt++) {
    await new Promise((r) => setTimeout(r, 260));
    const res = await fetch(API + path, {
      ...init,
      headers: { "xc-token": TOKEN, "content-type": "application/json" },
    });
    if (res.status === 429 && attempt < 6) {
      await new Promise((r) => setTimeout(r, (Number(res.headers.get("retry-after")) || 2) * 1000));
      continue;
    }
    const body = await res.text();
    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${body.slice(0, 300)}`);
    return body ? JSON.parse(body) : null;
  }
}

const data = JSON.parse(readFileSync(process.argv[2], "utf8"));
const tables = new Map((await api(`/api/v2/meta/bases/${BASE}/tables`)).list.map((t) => [t.title, t.id]));

for (const name of ORDER) {
  const rows = data[name] ?? [];
  if (!rows.length) continue;
  const tid = tables.get(name);
  const existing = new Set();
  for (let offset = 0; ; offset += 1000) {
    const page = await api(`/api/v2/tables/${tid}/records?limit=1000&offset=${offset}`);
    for (const r of page.list) existing.add(name === "members" ? `${r.restaurant_id}|${r.user_id}` : r.uid);
    if (page.pageInfo?.isLastPage !== false) break;
  }
  // Na ordem de criação, para o "Id" do NocoDB seguir a mesma ordem.
  const fresh = rows
    .filter((r) => !existing.has(name === "members" ? `${r.restaurant_id}|${r.user_id}` : r.id))
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))
    .map(({ id, ...r }) => {
      const out = name === "members" ? {} : { uid: id };
      for (const [k, v] of Object.entries(r)) out[k] = JSON_COLS.has(k) && v !== null ? JSON.stringify(v) : v;
      return out;
    });
  for (let k = 0; k < fresh.length; k += 100) {
    await api(`/api/v2/tables/${tid}/records`, { method: "POST", body: JSON.stringify(fresh.slice(k, k + 100)) });
  }
  console.log(`${name}: ${fresh.length} copiadas, ${rows.length - fresh.length} já existiam`);
}
