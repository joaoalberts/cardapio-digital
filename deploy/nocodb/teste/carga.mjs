// Carga no porteiro: N pedidos por segundo durante S segundos, como a cozinha e o "Meus pedidos" fazem (ler pedidos
// abertos de um restaurante). Mostra quantos deram certo, quantos o limite do NocoDB recusou (429) e a demora.
//   URL=http://127.0.0.1:18090 TOKEN=... BASE=p... RPS=20 SEGUNDOS=30 node deploy/nocodb/teste/carga.mjs
const { URL: API, TOKEN, BASE } = process.env;
const RPS = Number(process.env.RPS ?? 20);
const SECONDS = Number(process.env.SEGUNDOS ?? 30);
const h = { "xc-token": TOKEN };

const { list } = await (await fetch(`${API}/api/v2/meta/bases/${BASE}/tables`, { headers: h })).json();
const orders = list.find((t) => t.title === "orders").id;
const path = `/api/v2/tables/${orders}/records?limit=50&sort=-Id&where=(open,checked)`;

const res = { ok: 0, limite: 0, erro: 0, ms: [] };
const pending = [];
const t0 = Date.now();
for (let i = 0; i < RPS * SECONDS; i++) {
  const due = t0 + (i * 1000) / RPS;
  const wait = due - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const start = Date.now();
  pending.push(
    fetch(API + path, { headers: h })
      .then(async (r) => {
        await r.arrayBuffer();
        if (r.status === 200) {
          res.ok++;
          res.ms.push(Date.now() - start);
        } else if (r.status === 429) res.limite++;
        else res.erro++;
      })
      .catch(() => res.erro++),
  );
}
await Promise.all(pending);
res.ms.sort((a, b) => a - b);
const p = (q) => res.ms[Math.min(res.ms.length - 1, Math.floor(q * res.ms.length))] ?? 0;
console.log(`${RPS}/s por ${SECONDS} s: ${res.ok} ok, ${res.limite} recusados pelo limite (429), ${res.erro} erros; demora mediana ${p(0.5)} ms, 95% até ${p(0.95)} ms, pior ${res.ms.at(-1) ?? 0} ms`);
