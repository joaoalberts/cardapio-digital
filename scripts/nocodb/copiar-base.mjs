// Copia a base "Cardápio Digital" de um NocoDB para outro (nuvem -> VPS), com os mesmos uids e na mesma ordem.
// O destino precisa já ter as tabelas (rode antes o scripts/nocodb/setup.mjs nele). Só lê da origem.
//
//   node --env-file=.env.migracao scripts/nocodb/copiar-base.mjs               copia (para se o destino tiver linhas)
//   node --env-file=.env.migracao scripts/nocodb/copiar-base.mjs --substituir  apaga as linhas do destino antes
//   node --env-file=.env.migracao scripts/nocodb/copiar-base.mjs --conferir    só compara, não grava nada
//
// Variáveis: ORIGEM_URL, ORIGEM_TOKEN, ORIGEM_BASE e DESTINO_URL, DESTINO_TOKEN, DESTINO_BASE.
// Opcionais: ORIGEM_RPS (padrão 4: a nuvem bloqueia acima de 5 por segundo) e DESTINO_RPS (padrão 20).
// Gravar na nuvem (a volta, VPS -> nuvem) pede --permitir-nuvem.
//
// O "Id" numérico do NocoDB muda (o destino numera de novo), mas as linhas entram na ordem do Id da origem, então
// a ordem de criação continua a mesma. O app só usa o Id para alterar uma linha que acabou de ler.
// Nada das linhas é impresso: a tabela users tem os hashes das senhas.

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Colunas que o NocoDB cria sozinho em toda tabela: não se copiam.
const SYSTEM = new Set(["Id", "CreatedAt", "UpdatedAt", "nc_created_by", "nc_updated_by", "nc_order"]);
// Tipos calculados ou de ligação: não guardam valor próprio.
const VIRTUAL = new Set(["Links", "LinkToAnotherRecord", "Lookup", "Rollup", "Formula", "Count", "Button", "QrCode", "Barcode"]);
const BATCH = 100;

export function copyableColumns(meta) {
  return meta.columns
    .filter((c) => !c.pk && !c.system && !SYSTEM.has(c.title) && !VIRTUAL.has(c.uidt))
    .map((c) => ({ title: c.title, uidt: c.uidt }));
}

// Valor comparável, igual nos dois lados mesmo que cada banco devolva num formato (JSON em texto ou objeto,
// checkbox em 0/1 ou booleano, número em texto, data com ou sem fuso). Vazio e nulo contam como iguais.
export function canonical(value, uidt) {
  if (value === undefined || value === null || value === "") return null;
  if (uidt === "JSON") {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (uidt === "Checkbox") return value === true || value === 1 || value === "1" || value === "true";
  if (uidt === "Number" || uidt === "Decimal") return Number(value);
  if (uidt === "DateTime") {
    const t = Date.parse(value);
    return Number.isNaN(t) ? value : new Date(t).toISOString();
  }
  return value;
}

// Impressão digital da tabela: muda se mudar qualquer valor, a quantidade ou a ordem das linhas.
export function fingerprint(rows, cols) {
  const h = createHash("sha256");
  for (const row of rows) h.update(JSON.stringify(cols.map((c) => canonical(row[c.title], c.uidt))) + "\n");
  return h.digest("hex");
}

// Linha pronta para gravar: só as colunas copiáveis; JSON vai como texto, como o app grava (lib/db/nocodb.ts).
export function toInsert(row, cols) {
  const out = {};
  for (const c of cols) {
    const v = row[c.title];
    if (v === undefined) continue;
    out[c.title] = c.uidt === "JSON" && v !== null && typeof v !== "string" ? JSON.stringify(v) : v;
  }
  return out;
}

// Ids de base são sorteados: o mesmo id é a mesma base, mesmo com outro nome de host (127.0.0.1 e localhost).
export function checkTargets({ origem, destino, args }) {
  const errors = [];
  if (origem.base === destino.base) errors.push("origem e destino são a mesma base");
  let host = "";
  try {
    host = new URL(destino.url).hostname;
  } catch {
    errors.push(`DESTINO_URL inválida: ${destino.url}`);
  }
  if (/(^|\.)nocodb\.com$/.test(host) && !args.has("--permitir-nuvem"))
    errors.push("o destino é o NocoDB da nuvem; para gravar lá, use --permitir-nuvem");
  return errors;
}

// Do corpo de um erro, só a mensagem: o corpo inteiro pode repetir valores das linhas (hashes de senha).
export function errorMessage(text) {
  try {
    const j = JSON.parse(text);
    return String(j.msg ?? j.message ?? j.error ?? "").slice(0, 200);
  } catch {
    return "";
  }
}

export function client(url, token, rps, fetchImpl = fetch) {
  const sent = [];
  let calls = 0;
  async function slot() {
    for (;;) {
      const now = Date.now();
      while (sent.length && now - sent[0] >= 1000) sent.shift();
      if (sent.length < rps) return void sent.push(now);
      await new Promise((r) => setTimeout(r, 1000 - (now - sent[0]) + 5));
    }
  }
  async function api(path, init = {}) {
    for (let attempt = 0; ; attempt++) {
      await slot();
      calls++;
      const res = await fetchImpl(url + path, {
        method: init.method ?? "GET",
        headers: { "xc-token": token, "content-type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      if (res.status === 429 && attempt < 5) {
        await new Promise((r) => setTimeout(r, (Number(res.headers.get("retry-after")) || 2) * 1000 + 200));
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new Error(`${init.method ?? "GET"} ${url}${path.split("?")[0]}: ${res.status} ${errorMessage(text)}`);
      return text ? JSON.parse(text) : null;
    }
  }
  // Pede 1000 por página, mas segue o que o servidor devolver: um servidor que corta em 100 não pode fazer a cópia
  // parar no meio (achado do Verificador, 16/10). A conferência usa a contagem do próprio NocoDB, não esta leitura.
  async function rows(tableId) {
    const out = [];
    for (;;) {
      const q = new URLSearchParams({ limit: "1000", offset: String(out.length), sort: "Id" });
      const page = await api(`/api/v2/tables/${tableId}/records?${q}`);
      out.push(...page.list);
      const last = page.pageInfo?.isLastPage ?? page.list.length < 1000;
      if (last || !page.list.length) return out;
    }
  }
  async function count(tableId) {
    return Number((await api(`/api/v2/tables/${tableId}/records/count`)).count);
  }
  return { api, rows, count, calls: () => calls };
}

// Casa as tabelas pelo título ("users"), como o app: o nome interno pode vir com prefixo (nc_jc4p___users).
async function loadBase(c, base) {
  const { list } = await c.api(`/api/v2/meta/bases/${base}/tables`);
  const out = new Map();
  for (const t of list) {
    const meta = await c.api(`/api/v2/meta/tables/${t.id}`);
    out.set(t.title, { id: t.id, cols: copyableColumns(meta) });
  }
  return out;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const env = (k) => process.env[k] ?? "";
  const origem = { url: env("ORIGEM_URL").replace(/\/$/, ""), token: env("ORIGEM_TOKEN"), base: env("ORIGEM_BASE") };
  const destino = { url: env("DESTINO_URL").replace(/\/$/, ""), token: env("DESTINO_TOKEN"), base: env("DESTINO_BASE") };
  const faltam = ["ORIGEM_URL", "ORIGEM_TOKEN", "ORIGEM_BASE", "DESTINO_URL", "DESTINO_TOKEN", "DESTINO_BASE"].filter((k) => !env(k));
  if (faltam.length) throw new Error(`faltam variáveis: ${faltam.join(", ")}`);
  const errors = checkTargets({ origem, destino, args });
  if (errors.length) throw new Error(errors.join("; "));

  const src = client(origem.url, origem.token, Number(env("ORIGEM_RPS")) || 4);
  const dst = client(destino.url, destino.token, Number(env("DESTINO_RPS")) || 20);

  // 1. Estrutura: toda tabela e coluna da origem tem de existir no destino, ou nada é gravado.
  const [srcBase, dstBase] = [await loadBase(src, origem.base), await loadBase(dst, destino.base)];
  const problems = [];
  for (const [name, t] of srcBase) {
    const d = dstBase.get(name);
    if (!d) {
      problems.push(`tabela ${name} não existe no destino`);
      continue;
    }
    const have = new Set(d.cols.map((c) => c.title));
    const missing = t.cols.filter((c) => !have.has(c.title)).map((c) => c.title);
    if (missing.length) problems.push(`${name}: faltam no destino as colunas ${missing.join(", ")}`);
  }
  if (problems.length) throw new Error(`rode o setup.mjs no destino primeiro:\n  ${problems.join("\n  ")}`);

  // 2. Lê tudo da origem (de 1000 em 1000, na ordem do Id) e confere com a contagem do NocoDB.
  const data = new Map();
  for (const [name, t] of srcBase) {
    const rows = await src.rows(t.id);
    const total = await src.count(t.id);
    if (rows.length !== total) throw new Error(`${name}: li ${rows.length} linhas da origem, mas ela diz ter ${total}`);
    data.set(name, rows);
  }

  if (!args.has("--conferir")) {
    // 3. Destino vazio, ou --substituir.
    const cheias = [];
    for (const [name] of srcBase) {
      const n = (await dst.rows(dstBase.get(name).id)).length;
      if (n) cheias.push(`${name} (${n})`);
    }
    if (cheias.length && !args.has("--substituir"))
      throw new Error(`o destino já tem linhas em ${cheias.join(", ")}. Use --substituir para apagá-las antes.`);

    for (const [name, t] of srcBase) {
      const d = dstBase.get(name);
      if (args.has("--substituir")) {
        const ids = (await dst.rows(d.id)).map((r) => ({ Id: r.Id }));
        for (let k = 0; k < ids.length; k += BATCH)
          await dst.api(`/api/v2/tables/${d.id}/records`, { method: "DELETE", body: ids.slice(k, k + BATCH) });
      }
      // 4. Grava na ordem da origem.
      const rows = data.get(name).map((r) => toInsert(r, t.cols));
      for (let k = 0; k < rows.length; k += BATCH)
        await dst.api(`/api/v2/tables/${d.id}/records`, { method: "POST", body: rows.slice(k, k + BATCH) });
    }
  }

  // 5. Confere: quantidade (pela contagem do NocoDB nos dois lados) e impressão digital (valores e ordem).
  let ok = true;
  console.log("tabela               origem  destino  conteúdo");
  for (const [name, t] of srcBase) {
    const d = dstBase.get(name);
    const got = await dst.rows(d.id);
    const total = await dst.count(d.id);
    const same = got.length === total && fingerprint(data.get(name), t.cols) === fingerprint(got, t.cols);
    const line = data.get(name).length === total && same;
    ok &&= line;
    console.log(`${name.padEnd(20)} ${String(data.get(name).length).padStart(6)}  ${String(total).padStart(7)}  ${same ? "igual" : "DIFERENTE"}`);
  }
  console.log(`chamadas à origem: ${src.calls()}`);
  console.log(ok ? "ok: o destino é igual à origem" : "ERRO: o destino não ficou igual à origem");
  if (!ok) process.exitCode = 1;
}

// Roda só quando chamado direto (não quando o teste importa), mesmo por um caminho com link simbólico.
const direct = (() => {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (direct) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
