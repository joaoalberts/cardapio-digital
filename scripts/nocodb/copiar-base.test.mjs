// node --test scripts/nocodb/
import assert from "node:assert/strict";
import { test } from "node:test";
import { canonical, checkTargets, client, copyableColumns, errorMessage, fingerprint, toInsert } from "./copiar-base.mjs";

const cols = [
  { title: "uid", uidt: "SingleLineText" },
  { title: "tags", uidt: "JSON" },
  { title: "active", uidt: "Checkbox" },
  { title: "price_cents", uidt: "Number" },
  { title: "created_at", uidt: "DateTime" },
];

test("copia só as colunas com valor próprio", () => {
  const meta = {
    columns: [
      { title: "Id", uidt: "ID", pk: true },
      { title: "uid", uidt: "SingleLineText" },
      { title: "CreatedAt", uidt: "CreatedTime", system: true },
      { title: "nc_order", uidt: "Order" },
      { title: "restaurant", uidt: "Links" },
      { title: "tags", uidt: "JSON" },
    ],
  };
  assert.deepEqual(copyableColumns(meta), [
    { title: "uid", uidt: "SingleLineText" },
    { title: "tags", uidt: "JSON" },
  ]);
});

test("o mesmo valor em formatos diferentes de banco conta como igual", () => {
  assert.deepEqual(canonical('["vegano"]', "JSON"), canonical(["vegano"], "JSON"));
  assert.equal(canonical(1, "Checkbox"), canonical(true, "Checkbox"));
  assert.equal(canonical(0, "Checkbox"), false);
  assert.equal(canonical(null, "Checkbox"), null);
  assert.equal(canonical("1990", "Number"), 1990);
  assert.equal(canonical("2026-10-15 03:12:45+00:00", "DateTime"), canonical("2026-10-15T03:12:45.000Z", "DateTime"));
  assert.equal(canonical("", "SingleLineText"), canonical(null, "SingleLineText"));
});

test("a impressão digital muda com valor, quantidade e ordem", () => {
  const a = { uid: "a", tags: ["x"], active: true, price_cents: 100, created_at: "2026-10-15 03:12:45+00:00" };
  const b = { uid: "b", tags: null, active: false, price_cents: 0, created_at: null };
  const base = fingerprint([a, b], cols);
  assert.equal(fingerprint([{ ...a, tags: '["x"]', active: 1, price_cents: "100" }, b], cols), base);
  assert.notEqual(fingerprint([b, a], cols), base);
  assert.notEqual(fingerprint([a], cols), base);
  assert.notEqual(fingerprint([{ ...a, price_cents: 101 }, b], cols), base);
});

test("JSON vai como texto e as outras colunas como vieram", () => {
  const row = { Id: 7, uid: "a", tags: ["x"], active: true, price_cents: 100, CreatedAt: "x" };
  assert.deepEqual(toInsert(row, cols), { uid: "a", tags: '["x"]', active: true, price_cents: 100 });
  assert.deepEqual(toInsert({ tags: '["x"]' }, cols), { tags: '["x"]' });
  assert.deepEqual(toInsert({ tags: null }, cols), { tags: null });
});

test("não grava na própria origem nem na nuvem sem pedir", () => {
  const vps = { url: "https://db.exemplo.test", base: "p1" };
  const nuvem = { url: "https://app.nocodb.com", base: "p2" };
  const none = new Set();
  assert.deepEqual(checkTargets({ origem: nuvem, destino: vps, args: none }), []);
  assert.equal(checkTargets({ origem: vps, destino: vps, args: none }).length, 1);
  assert.equal(checkTargets({ origem: vps, destino: { url: "http://localhost:1", base: "p1" }, args: none }).length, 1);
  assert.equal(checkTargets({ origem: vps, destino: nuvem, args: none }).length, 1);
  assert.equal(checkTargets({ origem: vps, destino: { url: "https://APP.NOCODB.COM", base: "p2" }, args: none }).length, 1);
  assert.equal(checkTargets({ origem: vps, destino: { url: "https://eu.nocodb.com/", base: "p2" }, args: none }).length, 1);
  assert.deepEqual(checkTargets({ origem: vps, destino: nuvem, args: new Set(["--permitir-nuvem"]) }), []);
});

test("lê todas as linhas mesmo se o servidor devolver páginas menores que as pedidas", async () => {
  const total = 250;
  const fake = async (url) => {
    const q = new URL(url).searchParams;
    const offset = Number(q.get("offset"));
    const list = Array.from({ length: Math.max(0, Math.min(100, total - offset)) }, (_, i) => ({ Id: offset + i + 1 }));
    return new Response(JSON.stringify({ list, pageInfo: { isLastPage: offset + list.length >= total } }));
  };
  const rows = await client("http://x.test", "t", 1000, fake).rows("m1");
  assert.equal(rows.length, total);
  assert.deepEqual(rows.map((r) => r.Id), Array.from({ length: total }, (_, i) => i + 1));
});

test("erro mostra só a mensagem, nunca o corpo inteiro", () => {
  assert.equal(errorMessage('{"msg":"Invalid token","row":{"password_hash":"x"}}'), "Invalid token");
  assert.equal(errorMessage("<html>password_hash</html>"), "");
});
