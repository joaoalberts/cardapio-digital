// Só para o teste local: usa o cliente de verdade do app (src/lib/db/nocodb.ts) contra o porteiro (Caddy) e
// faz tudo o que o app faz: ler, filtrar, contar, criar, alterar e apagar. Grava e apaga uma linha de teste.
//   NOCODB_URL=http://127.0.0.1:18090 NOCODB_API_TOKEN=... NOCODB_BASE_ID=p... \
//     node --conditions=react-server deploy/nocodb/teste/app-contra-porteiro.mjs
// (--conditions=react-server faz o "server-only" do app virar um módulo vazio fora do Next)
import assert from "node:assert/strict";

const db = await import("../../../src/lib/db/nocodb.ts");

const restaurants = await db.list("restaurants");
console.log(`restaurants: ${restaurants.length} linhas; uid vira id: ${restaurants.every((r) => typeof r.id === "string")}`);
const one = restaurants[0];
if (one) {
  const again = await db.first("restaurants", { uid: one.id });
  assert.equal(again?.id, one.id);
  assert.ok(Array.isArray(again.languages) || again.languages === null, "JSON volta como objeto");
}
const translations = await db.list("translations");
assert.equal(translations.length, await db.count("translations", {}), "a lista paginada traz todas as linhas");
console.log(`translations (paginado): ${translations.length}`);
console.log(`orders abertas (filtro booleano): ${await db.count("orders", { open: true })}`);

const marca = `teste-porteiro-${Date.now()}`;
const row = await db.insertOne("support_requests", { restaurant_id: marca, subject: "Pão “coado” ½", message: "a,b (c)" });
assert.equal((await db.first("support_requests", { uid: row.id }))?.subject, "Pão “coado” ½");
assert.equal(await db.count("support_requests", { restaurant_id: marca, whatsapp: null }), 1, "filtro por coluna vazia");
assert.equal(await db.update("support_requests", { restaurant_id: marca }, { whatsapp: "5511999999999" }), 1);
const [saved] = await db.list("support_requests", { restaurant_id: marca });
assert.equal(saved.whatsapp, "5511999999999");
await db.updateRows("support_requests", [{ Id: saved.Id, subject: "ok" }]);
assert.equal((await db.first("support_requests", { uid: row.id }))?.subject, "ok");
assert.equal(await db.remove("support_requests", { restaurant_id: marca }), 1);
assert.equal(await db.count("support_requests", { restaurant_id: marca }), 0);
console.log("ok: ler, filtrar, contar, criar, alterar e apagar passam pelo porteiro");
