// Só para o teste local: enche uma base de origem com dados variados (acentos, emoji, aspas, quebras de linha,
// JSON, vazios, datas com fuso) e mais de 1000 linhas numa tabela, para testar a paginação da cópia.
//   URL=http://127.0.0.1:18081 TOKEN=... BASE=p... node deploy/nocodb/teste/semear.mjs
const { URL: API, TOKEN, BASE } = process.env;
const api = async (path, init = {}) => {
  const res = await fetch(API + path, {
    method: init.method ?? "GET",
    headers: { "xc-token": TOKEN, "content-type": "application/json" },
    body: init.body && JSON.stringify(init.body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
};

const SIZES = { translations: 1234, items: 60, media: 40, orders: 25 };
const textos = ["Pão de queijo", "Café “coado” 🍕", "Linha 1\nLinha 2", "", null, "vírgula, (parênteses) ~til", "Ñandú à la carte"];
const pick = (i, list) => list[i % list.length];

function value(c, i) {
  switch (c.uidt) {
    case "Email": return `pessoa${i}@exemplo.test`;
    case "LongText": return pick(i, textos) === null ? null : `${pick(i, textos)} — descrição longa ${"x".repeat(i % 300)}`;
    case "Number": return i % 7 === 0 ? null : i * 137;
    case "Checkbox": return i % 3 === 0;
    case "JSON": return pick(i, [["vegano", "picante"], { seg: ["11:00", "23:00"], dom: null }, null, [], { linhas: [{ q: 2, nome: "Pizza ½" }] }]);
    case "DateTime": return pick(i, ["2026-10-15 03:12:45+00:00", "2026-01-31T23:59:59.000Z", null, "2026-10-16 09:00:00-03:00"]);
    default: return c.title === "uid" ? crypto.randomUUID() : pick(i, textos);
  }
}

const { list } = await api(`/api/v2/meta/bases/${BASE}/tables`);
for (const t of list) {
  const meta = await api(`/api/v2/meta/tables/${t.id}`);
  const cols = meta.columns.filter((c) => !c.pk && !c.system && !["CreatedAt", "UpdatedAt", "nc_created_by", "nc_updated_by", "nc_order"].includes(c.title));
  const rows = Array.from({ length: SIZES[t.table_name] ?? 5 }, (_, i) => Object.fromEntries(cols.map((c) => [c.title, value(c, i)])));
  for (let k = 0; k < rows.length; k += 100) await api(`/api/v2/tables/${t.id}/records`, { method: "POST", body: rows.slice(k, k + 100) });
  console.log(`${t.table_name}: ${rows.length}`);
}
