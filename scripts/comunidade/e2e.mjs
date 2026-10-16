// Verificação ponta a ponta da Comunidade (Tarefa 12) com Playwright, contra o servidor de
// produção local (next start) e o NocoDB do Docker. Tira os prints t12-* e mede as chamadas
// ao NocoDB pelo contador de teste (NOCODB_COUNT=1, GET /api/arquivos-locais/_calls).
//
// Roteiro (no worktree):
//   node --env-file=.env.local scripts/comunidade/seed-local.mjs --minutos=55
//   STORAGE_DRIVER=local npm run build
//   STORAGE_DRIVER=local NOCODB_COUNT=1 npx next start -p 3011 -H 0.0.0.0
//   npx -y -p playwright@1.63.0 -c 'node --env-file=.env.local scripts/comunidade/e2e.mjs celular fontes'
//   # O painel abre o 1º restaurante da conta de teste; placar, telão e medição rodam nele:
//   node --env-file=.env.local scripts/comunidade/seed-local.mjs --slug=pizzaria-teste --aberto-agora --minutos=55 --limpar-votos
//   npx -y -p playwright@1.63.0 -c 'node --env-file=.env.local scripts/comunidade/e2e.mjs placar telao medir --slug=pizzaria-teste --mesa=4VEUC7'
//
// Fases:
//   celular  balão sem cobrir logo e botões, vidro da folha, QR → voto em 2 toques, % sem
//            device na leitura, pílula em 375×667
//   fontes   3 temas de fonte (um IM Fell) e as 6 línguas na camada; troca font_theme e
//            languages só no NocoDB local e volta ao original no fim
//   placar   "Pedir também" no Mural → pedido enviado → /painel/pedidos e placar do painel
//   telao    parear pelo painel, 2 celulares votando (tempo até a barra mudar), 2 min sem
//            rede e volta sozinho, ?debug=1 com o mesmo v do celular
//   medir    N minutos (--minutos=10) com 2 celulares de camada aberta e o telão
//
// Só roda contra http://localhost. A conta de teste vem do comentário do .env.local e não é
// impressa nem gravada. Prints em docs/prints-das-etapas/comunidade/ (fora do git).

import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertLocalNocodb } from "./seed-local.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const PRINTS = process.env.E2E_PRINTS ?? "/Users/joao/Desktop/joaoai/Aplicativos/Cardápio Digital/docs/prints-das-etapas/comunidade";

const PHONE = { width: 390, height: 844 };
const PHONE_SE = { width: 375, height: 667 };
const TV = { width: 1280, height: 720 };
const LANGS = ["pt-BR", "en", "es", "fr", "it", "de"];
// closeAria de cada língua (i18n.ts): confere que a camada trocou de verdade.
const CLOSE_ARIA = {
  "pt-BR": "Fechar a Comunidade",
  en: "Close the Community",
  es: "Cerrar la Comunidad",
  fr: "Fermer la Communauté",
  it: "Chiudi la Community",
  de: "Community schließen",
};
// Chaves que nunca podem sair na leitura pública (contagem, device, mesa, segredo do telão).
const FORBIDDEN = /^(device|device_id|table|table_id|mesa|votes|count|counts|secret|secret_hash|pair_code|ip)$/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- argumentos ----------

function parseArgs(argv) {
  const phases = argv.filter((a) => !a.startsWith("--"));
  const val = (k, d) => argv.find((x) => x.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
  const base = val("base", "http://localhost:3011");
  const u = new URL(base);
  if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") throw new Error(`Recusado: só http://localhost, não ${base}.`);
  const minutes = Number(val("minutos", "10"));
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 60) throw new Error("--minutos de 0 a 60.");
  return {
    phases: phases.length ? phases : ["celular"],
    base: u.origin,
    slug: val("slug", "depotmedieval-copia"),
    mesa: val("mesa", "E74B9X"),
    minutes,
    temas: val("temas", "letreiro,moderno,fell").split(","),
  };
}

// ---------- Playwright (do cache do npx) ----------

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    // npx -p playwright põe o .bin dele no PATH; o pacote está na pasta ao lado.
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
      if (!dir.endsWith(`node_modules${path.sep}.bin`)) continue;
      try {
        const req = createRequire(path.join(dir, "..", "noop.js"));
        return req("playwright");
      } catch {}
    }
    throw new Error("Playwright não encontrado: rode com npx -y -p playwright@1.63.0 -c 'node ...'.");
  }
}

// ---------- relatório ----------

const results = [];
function check(passo, ok, detalhe) {
  results.push({ passo, ok: !!ok, detalhe });
  console.log(`${ok ? "ok  " : "FALHA"} ${passo}${detalhe ? ` · ${detalhe}` : ""}`);
}
const prints = [];
async function shot(page, name, opts = {}) {
  const file = path.join(PRINTS, `t12-${name}.png`);
  await page.screenshot({ path: file, ...opts });
  prints.push(path.basename(file));
}

// ---------- NocoDB local (só para trocar fonte/línguas e conferir o pedido) ----------

async function nocodb() {
  const API = assertLocalNocodb(process.env.NOCODB_URL);
  const TOKEN = process.env.NOCODB_API_TOKEN;
  if (!TOKEN) throw new Error("Falta NOCODB_API_TOKEN (rode com --env-file=.env.local).");
  const api = async (p, init = {}) => {
    const res = await fetch(API + p, { ...init, headers: { "xc-token": TOKEN, "content-type": "application/json" } });
    const body = await res.text();
    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${p.split("?")[0]}: ${res.status}`);
    return body ? JSON.parse(body) : null;
  };
  let baseId = process.env.NOCODB_BASE_ID;
  if (!baseId) baseId = (await api("/api/v2/meta/bases/")).list.find((b) => b.title === "Cardápio Digital")?.id;
  const tables = (await api(`/api/v2/meta/bases/${baseId}/tables`)).list;
  const tid = (n) => tables.find((x) => x.title === n || x.table_name === n).id;
  const where = (w) => Object.entries(w).map(([k, v]) => `(${k},eq,${v})`).join("~and");
  return {
    list: async (t, w, sort = "Id") =>
      (await api(`/api/v2/tables/${tid(t)}/records?limit=200&sort=${sort}&where=${encodeURIComponent(where(w))}`)).list,
    patch: (t, rows) => api(`/api/v2/tables/${tid(t)}/records`, { method: "PATCH", body: JSON.stringify(rows) }),
  };
}

// Conta de teste local, do comentário do .env.local. Nunca sai deste processo.
function testAccount() {
  const env = readFileSync(path.join(ROOT, ".env.local"), "utf8");
  const m = env.match(/^#\s*Conta de teste local[^:\n]*:\s*(\S+@\S+)\s*\/\s*(\S+)\s*$/m);
  if (!m) throw new Error("Conta de teste local não encontrada no .env.local.");
  return { email: m[1], password: m[2] };
}

// ---------- contextos ----------

function phoneCtx(browser, size = PHONE, lang = null) {
  return browser
    .newContext({ viewport: size, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "pt-BR" })
    .then(async (ctx) => {
      if (lang) await ctx.addInitScript((l) => localStorage.setItem("cardapio-lang", l), lang);
      return ctx;
    });
}

// Abre o cardápio pelo QR da mesa e espera o balão. Guarda as leituras públicas da página.
async function openMenu(ctx, cfg, { mesa = cfg.mesa } = {}) {
  const page = await ctx.newPage();
  const reads = [];
  page.on("response", async (r) => {
    const u = new URL(r.url());
    if (r.request().method() !== "GET" || u.pathname !== `/api/comunidade/${cfg.slug}`) return;
    try {
      reads.push({ at: Date.now(), status: r.status(), body: await r.json() });
    } catch {}
  });
  await page.goto(`${cfg.base}/${cfg.slug}${mesa ? `?mesa=${mesa}` : ""}`, { waitUntil: "domcontentloaded" });
  await page.locator(".cmu-bal").first().waitFor({ state: "visible", timeout: 30_000 });
  await sleep(1500); // a logo sobe quando o selo "Aberto" entra; o balão se reposiciona
  return { page, reads };
}

async function balloonBoxes(page) {
  return page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height, cls: el.className };
    };
    const bal = document.querySelector(".cmu-bal");
    const others = [...document.querySelectorAll(".hero .brand, .hero-top > .round, .hero-cart, .hero-info, .hero-top .flagbtn")]
      .filter((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0 && r.width > 0 && r.height > 0;
      })
      .map(box);
    return { bal: bal ? box(bal) : null, others, balBackdrop: bal ? getComputedStyle(bal).backdropFilter : null };
  });
}
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function forbiddenKeys(v, at = "") {
  if (Array.isArray(v)) return v.flatMap((x, i) => forbiddenKeys(x, `${at}[${i}]`));
  if (!v || typeof v !== "object") return [];
  return Object.entries(v).flatMap(([k, x]) => [...(FORBIDDEN.test(k) ? [`${at}.${k}`] : []), ...forbiddenKeys(x, `${at}.${k}`)]);
}

async function openLayer(page) {
  await page.locator(".cmu-bal").first().tap();
  await page.locator(".cmu-layer.on").waitFor({ state: "visible", timeout: 10_000 });
  await sleep(700); // fim da entrada (0,45 s)
}

// Vota na opção k da enquete aberta; devolve a resposta do /votar.
async function vote(page, k = 0) {
  const resp = page.waitForResponse((r) => r.url().includes("/votar") && r.request().method() === "POST", { timeout: 15_000 });
  await page.locator(".cmu-layer.on .cmu-opt").nth(k).tap();
  const r = await resp;
  return { status: r.status(), body: await r.json().catch(() => null), at: Date.now() };
}

// ---------- fases ----------

async function faseCelular(browser, cfg) {
  // 1. Balão sem cobrir logo e botões; vidro da folha.
  const ctx = await phoneCtx(browser);
  const { page, reads } = await openMenu(ctx, cfg);
  const b = await balloonBoxes(page);
  const hits = b.others.filter((o) => overlap(b.bal, o)).map((o) => o.cls);
  check("2.1 balão grande na capa 390×844", /cmu-bal-p|cmu-bal-m/.test(b.bal?.cls ?? ""), b.bal?.cls);
  check("2.1 balão não cobre logo nem botões", b.bal && b.others.length >= 3 && hits.length === 0, `caixas conferidas: ${b.others.length}; sobrepostas: ${hits.join(", ") || "nenhuma"}`);
  check("2.1 balão com vidro (backdrop-filter)", b.balBackdrop && b.balBackdrop !== "none", b.balBackdrop);
  await shot(page, "01-capa-balao-390");

  // 2. Do QR ao voto em 2 toques: balão → opção.
  let taps = 0;
  await openLayer(page);
  taps++;
  const sheet = await page.evaluate(() => getComputedStyle(document.querySelector(".cmu-layer")).backdropFilter);
  check("2.1 folha da camada com backdrop-filter", sheet && sheet !== "none", sheet);
  await shot(page, "02-palco-antes-do-voto");
  const v = await vote(page, 0);
  taps++;
  check("2.2 do QR ao voto em 2 toques", v.status === 200 && v.body?.ok === true && taps === 2, `toques: ${taps}; /votar ${v.status} ${JSON.stringify(v.body)?.slice(0, 80)}`);

  // 3. A barra mostra % e a leitura pública não tem device.
  await page.locator(".cmu-layer.on .cmu-opt.mine .cmu-pc").waitFor({ state: "visible", timeout: 10_000 });
  await sleep(900);
  const pcs = await page.locator(".cmu-layer.on .cmu-opt .cmu-pc").allTextContents();
  check("2.3 barras com porcentagem depois do voto", pcs.length >= 2 && pcs.every((t) => /^\d{1,3}%$/.test(t.trim())), pcs.join(" · "));
  // A releitura 5 s depois do voto (REFETCH_AFTER_VOTE_MS) já traz o voto contado.
  const t0 = Date.now();
  while (Date.now() - t0 < 12_000 && !reads.some((r) => r.at > v.at && r.body?.poll?.has_votes)) await sleep(250);
  const after = reads.filter((r) => r.at > v.at && r.body?.poll?.has_votes).at(-1);
  check("2.3 leitura depois do voto traz o voto em %", !!after && after.body.poll.options.some((o) => o.pct > 0), after ? after.body.poll.options.map((o) => `${o.label} ${o.pct}%`).join(", ") : "sem releitura");
  await sleep(900);
  await shot(page, "03-palco-votou"); // depois da releitura: com "Compartilhar no story"
  const bad = reads.flatMap((r) => forbiddenKeys(r.body));
  check("2.3 GET pública sem device_id, mesa nem contagem", reads.length > 0 && bad.length === 0, `${reads.length} leituras; chaves proibidas: ${bad.join(", ") || "nenhuma"}`);
  await page.locator("#cmu-tab-mural").tap();
  await sleep(800);
  await shot(page, "03b-mural");
  await ctx.close();

  // 5. 375×667: pílula compacta, também sem cobrir nada.
  const se = await phoneCtx(browser, PHONE_SE);
  const m = await openMenu(se, cfg);
  const b2 = await balloonBoxes(m.page);
  const hits2 = b2.others.filter((o) => overlap(b2.bal, o)).map((o) => o.cls);
  check("2.5 pílula compacta em 375×667", /cmu-bal-c/.test(b2.bal?.cls ?? ""), b2.bal?.cls);
  check("2.5 pílula não cobre logo nem botões", b2.bal && hits2.length === 0, `sobrepostas: ${hits2.join(", ") || "nenhuma"}`);
  await shot(m.page, "05-capa-pilula-375");
  await se.close();
}

// Espera o cardápio público (cache "minutes") refletir a troca feita no NocoDB.
async function waitMenu(cfg, ok, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < 240_000) {
    const m = await fetch(`${cfg.base}/api/menu/${cfg.slug}?lang=pt-BR`).then((r) => r.json()).catch(() => null);
    if (m && ok(m.restaurant)) return Date.now() - t0;
    await sleep(5000);
  }
  throw new Error(`o cardápio não refletiu ${label} em 4 min`);
}

// Recarrega até a página (cache da rota) mostrar o tema de fonte pedido.
async function openWithFont(browser, cfg, font) {
  const t0 = Date.now();
  for (;;) {
    const ctx = await phoneCtx(browser);
    const opened = await openMenu(ctx, cfg);
    if (await opened.page.evaluate((f) => document.querySelector(".cm")?.dataset.font === f, font)) return { ctx, ...opened };
    await ctx.close();
    if (Date.now() - t0 > 240_000) throw new Error("a página não refletiu a troca em 4 min");
    await sleep(5000);
  }
}

async function faseFontes(browser, cfg) {
  const db = await nocodb();
  const [r] = await db.list("restaurants", { slug: cfg.slug });
  const original = { font_theme: r.font_theme, languages: r.languages };
  const langs = JSON.parse(r.languages ?? '["pt-BR"]');
  const all = [...langs, ...LANGS.filter((l) => !langs.includes(l))];
  try {
    // 6. Três temas de fonte (o último é o original quando for IM Fell).
    if (!cfg.temas.some((t) => t.startsWith("fell"))) throw new Error("--temas precisa de um IM Fell (fell ou fell-sc).");
    for (const [i, tema] of cfg.temas.entries()) {
      const patch = { Id: r.Id, font_theme: tema };
      if (i === 0) patch.languages = JSON.stringify(all); // as 6 línguas, só na cópia local
      await db.patch("restaurants", [patch]);
      const waited = await waitMenu(cfg, (x) => x.font_theme === tema && LANGS.every((l) => x.languages.includes(l)), `o tema ${tema}`);
      const { ctx, page } = await openWithFont(browser, cfg, tema);
      const fam = await page.evaluate(() => getComputedStyle(document.querySelector(".cmu-bal .cmu-bq") ?? document.querySelector(".cmu-bal .cmu-t") ?? document.body).fontFamily);
      await shot(page, `06-fonte-${tema}-capa`);
      await openLayer(page);
      const h2 = await page.evaluate(() => getComputedStyle(document.querySelector(".cmu-layer.on .fd") ?? document.body).fontFamily);
      await shot(page, `06-fonte-${tema}-palco`);
      check(`2.6 tema de fonte ${tema}`, true, `cache levou ${Math.round(waited / 1000)} s; balão: ${fam.split(",")[0]}; palco: ${h2.split(",")[0]}`);
      await ctx.close();
    }
    // 7. As 6 línguas na camada.
    for (const l of LANGS) {
      const ctx = await phoneCtx(browser, PHONE, l);
      const { page } = await openMenu(ctx, cfg);
      await openLayer(page);
      const aria = await page.locator(".cmu-layer.on .cmu-x").getAttribute("aria-label");
      const htmlLang = await page.evaluate(() => document.documentElement.lang);
      check(`2.7 camada em ${l}`, aria === CLOSE_ARIA[l] && htmlLang === l, `lang=${htmlLang}; fechar="${aria}"`);
      await shot(page, `07-lingua-${l}`);
      await ctx.close();
    }
  } finally {
    await db.patch("restaurants", [{ Id: r.Id, ...original }]);
    console.log(`restaurante ${cfg.slug} de volta ao original (font_theme=${original.font_theme}, languages=${original.languages})`);
  }
}

async function login(browser, cfg) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "pt-BR" });
  const page = await ctx.newPage();
  const acct = testAccount();
  await page.goto(`${cfg.base}/entrar`);
  await page.fill('input[name="email"]', acct.email);
  await page.fill('input[name="password"]', acct.password);
  await Promise.all([page.waitForURL(/\/painel/, { timeout: 20_000 }), page.locator('form button[type="submit"]').click()]);
  return { ctx, page };
}

async function fasePlacar(browser, cfg, shared) {
  const ctx = await phoneCtx(browser);
  const { page } = await openMenu(ctx, cfg);
  await openLayer(page);
  await page.locator("#cmu-tab-mural").tap();
  const buy = page.locator(".cmu-layer.on #cmu-pane-mural .cmu-post button.cmu-also:not([disabled])").first();
  await buy.waitFor({ state: "visible", timeout: 10_000 });
  const post = await buy.evaluate((b) => b.closest(".cmu-post")?.querySelector(".cmu-pimg")?.getAttribute("aria-label"));
  await buy.tap();
  // Prato com tamanhos/meio a meio fecha a camada e abre a folha do prato (o "Adicionar" leva
  // ao carrinho); prato simples entra direto e o carrinho é o da camada.
  const cta = page.locator(".g-cta");
  const layerCart = page.locator(".cmu-layer.on .cmu-cart");
  await Promise.race([cta.waitFor({ state: "visible", timeout: 5000 }), sleep(1500)]).catch(() => {});
  const sized = await cta.isVisible().catch(() => false);
  if (sized) {
    await shot(page, "04a-mural-pedir-tambem-folha");
    await cta.tap();
  }
  await sleep(900);
  await shot(page, sized ? "04a2-adicionado" : "04a-mural-pedir-tambem");
  const slide = page.locator(".o-slide");
  if (!(await slide.isVisible().catch(() => false))) await layerCart.tap();
  await slide.waitFor({ state: "visible", timeout: 10_000 });
  await shot(page, "04b-carrinho");
  const sent = page.waitForResponse((r) => r.url().includes(`/api/pedidos/${cfg.slug}`) && r.request().method() === "POST", { timeout: 20_000 });
  await slide.focus();
  await page.keyboard.press("Enter");
  const resp = await sent;
  const body = await resp.json().catch(() => null);
  await page.locator(".o-done").waitFor({ state: "visible", timeout: 10_000 });
  await shot(page, "04c-pedido-enviado");
  check("2.4 pedido com Pedir também enviado", resp.ok() && body?.ok !== false, `${post ?? "post"} · HTTP ${resp.status()}`);
  await ctx.close();

  // A linha chega com a origem do Mural (orders.lines no NocoDB local).
  const db = await nocodb();
  const [r] = await db.list("restaurants", { slug: cfg.slug });
  const [order] = await db.list("orders", { restaurant_id: r.uid }, "-Id");
  const lines = typeof order?.lines === "string" ? JSON.parse(order.lines) : (order?.lines ?? []);
  const marked = lines.filter((l) => l.origin === "comunidade_mural" && typeof l.origin_ref === "string");
  check("2.4 linha marcada com a origem do Mural", marked.length >= 1 && !order.discarded, `pedido ${order?.uid?.slice(0, 8) ?? "?"}: ${marked.length} de ${lines.length} linha(s) com origin=comunidade_mural`);

  // Painel: /painel/pedidos e o placar da Comunidade.
  const p = shared.panel ?? (shared.panel = await login(browser, cfg));
  await p.page.goto(`${cfg.base}/painel/comunidade`);
  const tvUrl = await p.page.locator(".cp-url").textContent();
  if (!tvUrl?.includes(`/${cfg.slug}/telao`)) throw new Error(`o painel abriu outro restaurante (${tvUrl}); use --slug do 1º restaurante da conta`);
  // A cozinha mostra os novos do mais velho ao mais novo: o pedido de agora é o último
  // cartão de "Novos" com o prato e "agora"/"há N min" de poucos minutos.
  await p.page.goto(`${cfg.base}/painel/pedidos`);
  await p.page.locator(".kb-card").first().waitFor({ state: "visible", timeout: 20_000 });
  const age = Math.max(0, Math.floor((Date.now() - Date.parse(String(order.created_at).replace(" ", "T"))) / 60_000));
  const when = age < 1 ? /agora/ : new RegExp(`há (${age - 1}|${age}|${age + 1}) min`);
  const card = p.page.locator(".kb-card").filter({ hasText: lines[0]?.name ?? "" }).filter({ hasText: when }).last();
  const found = await card.isVisible().catch(() => false);
  if (found) await card.scrollIntoViewIfNeeded();
  check("2.4 pedido aparece em /painel/pedidos", found, `${order.table_label} · ${lines.map((l) => `${l.qty}× ${l.name}${l.option ? ` ${l.option}` : ""}`).join(", ")}`);
  await shot(p.page, "04d-painel-pedidos");
  await p.page.goto(`${cfg.base}/painel/comunidade`);
  const score = await p.page.locator(".cp-score b").textContent();
  const sub = await p.page.locator(".cp-score-sub").innerText();
  check("2.4 placar conta o pedido da Comunidade", Number(score) >= 1, `placar: ${score} · ${sub.replace(/\s+/g, " ")}`);
  await p.page.locator(".cp-score").scrollIntoViewIfNeeded();
  await shot(p.page, "04e-painel-placar");
}

// Opções do telão: largura (transform) de cada barra.
const tvBars = (tv) => tv.$$eval(".tl-bar .tl-fill", (els) => els.map((e) => e.style.transform).join("|"));

async function waitTvChange(tv, before, from, limit = 15_000) {
  for (;;) {
    const now = await tvBars(tv);
    if (now !== before) return Date.now() - from;
    if (Date.now() - from > limit) return null;
    await sleep(100);
  }
}

async function pairTv(browser, cfg, shared) {
  const ctx = await browser.newContext({ viewport: TV, deviceScaleFactor: 1, locale: "pt-BR" });
  const tv = await ctx.newPage();
  await tv.goto(`${cfg.base}/${cfg.slug}/telao`);
  const codeEl = tv.locator(".tl-code[aria-label]");
  await codeEl.waitFor({ state: "visible", timeout: 30_000 });
  const code = await codeEl.getAttribute("aria-label");
  await shot(tv, "10-telao-codigo");
  const p = shared.panel ?? (shared.panel = await login(browser, cfg));
  await p.page.goto(`${cfg.base}/painel/comunidade`);
  await p.page.fill('input[aria-label="Código da TV"]', code);
  const t0 = Date.now();
  await p.page.getByRole("button", { name: "Parear", exact: true }).click();
  await p.page.locator(".cp-pairok").waitFor({ state: "visible", timeout: 20_000 });
  await shot(p.page, "11-painel-tv-pareada", { fullPage: false });
  await tv.locator(".tl-pair").waitFor({ state: "detached", timeout: 20_000 });
  check("3 parear pelo painel", true, `TV saiu do código ${Math.round((Date.now() - t0) / 100) / 10} s depois do Parear`);
  await tv.locator(".tl-bars, .tl-idle").first().waitFor({ state: "visible", timeout: 20_000 });
  await sleep(1500);
  await shot(tv, "12-telao-pareado");
  shared.tv = { ctx, page: tv };
}

async function faseTelao(browser, cfg, shared) {
  if (!shared.tv) await pairTv(browser, cfg, shared);
  const tv = shared.tv.page;
  await tv.locator(".tl-bars").waitFor({ state: "visible", timeout: 20_000 });

  // Dois celulares (devices novos) votando: tempo até a barra do telão mudar.
  const phones = [];
  for (const k of [0, 1]) {
    const ctx = await phoneCtx(browser);
    const opened = await openMenu(ctx, cfg);
    await openLayer(opened.page);
    phones.push({ ctx, ...opened });
    const before = await tvBars(tv);
    const v = await vote(opened.page, k === 0 ? 1 : 2);
    const dt = v.status === 200 ? await waitTvChange(tv, before, v.at) : null;
    check(`3 voto ${k + 1}: barra do telão muda em ≤ 5 s`, dt != null && dt <= 5000, dt == null ? `não mudou (voto ${v.status} ${JSON.stringify(v.body)})` : `${(dt / 1000).toFixed(1)} s`);
    await sleep(1200);
    await shot(tv, `13-telao-voto-${k + 1}`);
  }
  await shot(phones[1].page, "13b-celular-votou");

  // Sem rede por 2 min: "reconectando" aparece e some sozinho.
  const off0 = Date.now();
  await shared.tv.ctx.setOffline(true);
  await tv.locator(".tl-rec").waitFor({ state: "visible", timeout: 20_000 });
  const shown = Date.now() - off0;
  await shot(tv, "14-telao-reconectando");
  await sleep(Math.max(0, 120_000 - (Date.now() - off0)));
  await shared.tv.ctx.setOffline(false);
  const on0 = Date.now();
  await tv.locator(".tl-rec").waitFor({ state: "hidden", timeout: 60_000 }).catch(() => {});
  const back = (await tv.locator(".tl-rec").isVisible()) ? null : Date.now() - on0;
  check("3 sem rede 2 min: reconectando e volta sozinho", back != null, `aviso em ${(shown / 1000).toFixed(1)} s; voltou ${back == null ? "não" : `${(back / 1000).toFixed(1)} s depois da rede`}`);
  await sleep(1000);
  await shot(tv, "15-telao-reconectou");

  // ?debug=1 com o mesmo v do celular.
  await tv.goto(`${cfg.base}/${cfg.slug}/telao?debug=1`);
  await tv.locator(".tl-debug").waitFor({ state: "visible", timeout: 20_000 });
  await tv.locator(".tl-bars").waitFor({ state: "visible", timeout: 20_000 });
  await sleep(4500);
  const dbg = await tv.locator(".tl-debug").innerText();
  const tvV = dbg.match(/v\s+([0-9a-f]{8})/)?.[1];
  const phoneV = await phones[0].page.evaluate(async (s) => (await (await fetch(`/api/comunidade/${s}`)).json()).v, cfg.slug);
  check("3 ?debug=1 mostra o mesmo v do celular", tvV && tvV === phoneV, `telão ${tvV} · celular ${phoneV}`);
  await shot(tv, "16-telao-debug");
  for (const p of phones) await p.ctx.close();
}

async function calls(cfg) {
  const r = await fetch(`${cfg.base}/api/arquivos-locais/_calls`, { cache: "no-store" });
  if (r.status !== 200) throw new Error("contador desligado: suba o servidor com STORAGE_DRIVER=local NOCODB_COUNT=1");
  return r.json();
}

async function faseMedir(browser, cfg, shared) {
  const state = await fetch(`${cfg.base}/api/comunidade/${cfg.slug}`).then((r) => r.json());
  if (!state.poll || state.poll.closed) throw new Error("medir precisa de enquete aberta (rode o seed)");
  const left = Date.parse(state.poll.ends_at) - Date.now();
  if (left < cfg.minutes * 60_000 + 60_000) throw new Error(`a enquete fecha em ${Math.round(left / 60_000)} min; rode o seed de novo`);
  if (!shared.tv) await pairTv(browser, cfg, shared);
  await shared.tv.page.goto(`${cfg.base}/${cfg.slug}/telao`);
  await shared.tv.page.locator(".tl-bars").waitFor({ state: "visible", timeout: 20_000 });
  // Painel fechado durante a medição (só celulares e telão contam).
  if (shared.panel) {
    await shared.panel.ctx.close();
    shared.panel = null;
  }

  const counts = { phone1: {}, phone2: {}, tv: {} };
  const tally = (who) => (req) => {
    const u = new URL(req.url());
    if (!u.pathname.startsWith("/api/")) return;
    const key = `${req.method()} ${u.pathname.replace(cfg.slug, ":slug").replace(/\/api\/arquivos-locais\/.*/, "/api/arquivos-locais/*")}`;
    counts[who][key] = (counts[who][key] ?? 0) + 1;
  };
  const phones = [];
  for (const who of ["phone1", "phone2"]) {
    const ctx = await phoneCtx(browser);
    const opened = await openMenu(ctx, cfg);
    await openLayer(opened.page);
    phones.push(ctx);
    ctx.on("request", tally(who));
  }
  shared.tv.ctx.on("request", tally("tv"));
  await sleep(5000);
  for (const c of Object.values(counts)) for (const k of Object.keys(c)) delete c[k];
  const a = await calls(cfg);
  const t0 = Date.now();
  console.log(`medindo ${cfg.minutes} min (2 celulares com a camada aberta + telão, enquete aberta)…`);
  await sleep(cfg.minutes * 60_000);
  const b = await calls(cfg);
  const secs = (Date.now() - t0) / 1000;
  const diff = {};
  for (const [k, n] of Object.entries(b.byKey)) if (n - (a.byKey[k] ?? 0)) diff[k] = n - (a.byKey[k] ?? 0);
  const total = b.total - a.total;
  const gets = Object.values(counts).reduce((s, c) => s + (c["GET /api/comunidade/:slug"] ?? 0), 0);
  const tvGets = counts.tv["GET /api/comunidade/:slug"] ?? 0;
  console.log(JSON.stringify({ minutos: Math.round(secs / 6) / 10, nocodb_total: total, nocodb_por_chave: diff, pedidos_dos_clientes: counts }, null, 2));
  check(
    "4 chamadas ao NocoDB em 10 min",
    true,
    `${total} chamadas em ${Math.round(secs)} s; ${gets} leituras públicas (telão ${tvGets}); ${(total / Math.max(1, gets)).toFixed(2)} chamada por leitura`,
  );
  shared.measure = { total, diff, counts, secs, gets, tvGets };
  for (const c of phones) await c.close();
}

// ---------- principal ----------

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  await mkdir(PRINTS, { recursive: true });
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  const shared = {};
  const phases = { celular: faseCelular, fontes: faseFontes, placar: fasePlacar, telao: faseTelao, medir: faseMedir };
  try {
    for (const ph of cfg.phases) {
      if (!phases[ph]) throw new Error(`fase desconhecida: ${ph}`);
      console.log(`\n== ${ph} (${cfg.slug}) ==`);
      try {
        await phases[ph](browser, cfg, shared);
      } catch (e) {
        check(`${ph}: erro`, false, e.message.split("\n")[0]);
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`\nprints: ${prints.join(", ") || "nenhum"}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length} ok, ${failed.length} falha(s)`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
