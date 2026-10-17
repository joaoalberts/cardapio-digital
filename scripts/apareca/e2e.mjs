// Verificação ponta a ponta do Apareça na TV (Tarefa 18) com Playwright: o celular grava, o
// painel aprova, a TV toca. Sobe o Mux falso (fake-mux.mjs) neste processo e o servidor de
// produção local (next start) como filho, com o contador de chamadas ao NocoDB ligado.
// Câmera falsa do Chrome (--use-fake-device-for-media-stream --use-fake-ui-for-media-stream).
//
// Roteiro (no worktree, NocoDB do Docker no ar):
//   node --env-file=.env.local scripts/apareca/seed-local.mjs
//   STORAGE_DRIVER=local npm run build
//   npx -y -p playwright@1.63.0 -c 'node --env-file=.env.local scripts/apareca/e2e.mjs passos'
//   npx -y -p playwright@1.63.0 -c 'node --env-file=.env.local scripts/apareca/e2e.mjs medir --minutos=30 --base=5'
//   node --env-file=.env.local scripts/apareca/seed-local.mjs --desfazer
//
// Fases:
//   passos  os 9 passos da Tarefa 18 (convite, nome, gravação e regravações, envio, painel,
//           TV do Bar, TV do Salão, reprovação e relógio adiantado além do prazo)
//   medir   --base min só com 2 TVs e o painel abertos, depois --minutos min com um celular
//           novo enviando a cada --intervalo min (padrão 2), o painel aprovando; chamadas ao
//           NocoDB por GET /api/arquivos-locais/_calls e projeção para 5 h e 50 vídeos
//
// Login no painel: cookie de sessão assinado aqui com o AUTH_SECRET do .env.local (só neste
// roteiro de teste; nenhuma rota do app forja sessão). Nada de segredo é impresso.
// Só roda contra http://localhost e o NocoDB local. Prints t18-* em docs/prints-das-etapas/apareca/.

import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeMux } from "./fake-mux.mjs";
import { STATE_FILE, assertLocalNocodb, localNocodb } from "./seed-local.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const PRINTS = process.env.E2E_PRINTS ?? "/Users/joao/Desktop/joaoai/Aplicativos/Cardápio Digital/docs/prints-das-etapas/apareca";

const PHONE = { width: 390, height: 844 };
const TV = { width: 1280, height: 720 };
const RETENTION_H = 6;
// Chaves que nunca podem sair por rota pública (spec, Restrições globais).
const FORBIDDEN = /^(device|device_id|table|table_id|ai_reason|reason|motivo|mux_upload_id|mux_asset_id|secret|secret_hash)$/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- argumentos ----------

function parseArgs(argv) {
  const phases = argv.filter((a) => !a.startsWith("--"));
  const val = (k, d) => argv.find((x) => x.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
  const port = Number(val("porta", "3011"));
  const muxPort = Number(val("porta-mux", "3999"));
  const num = (k, d, max) => {
    const n = Number(val(k, d));
    if (!Number.isFinite(n) || n < 0 || n > max) throw new Error(`--${k} de 0 a ${max}.`);
    return n;
  };
  return {
    phases: phases.length ? phases : ["passos"],
    port,
    muxPort,
    base: `http://localhost:${port}`,
    minutes: num("minutos", "30", 120),
    baseMinutes: num("base", "5", 60),
    every: num("intervalo", "2", 30),
    build: argv.includes("--build"),
  };
}

// ---------- Playwright (do cache do npx) ----------

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
      if (!dir.endsWith(`node_modules${path.sep}.bin`)) continue;
      try {
        return createRequire(path.join(dir, "..", "noop.js"))("playwright");
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
  return !!ok;
}
const prints = [];
async function shot(page, name, opts = {}) {
  const file = path.join(PRINTS, `t18-${name}.png`);
  await page.screenshot({ path: file, ...opts });
  prints.push(path.basename(file));
}
function forbiddenKeys(v, at = "") {
  if (Array.isArray(v)) return v.flatMap((x, i) => forbiddenKeys(x, `${at}[${i}]`));
  if (!v || typeof v !== "object") return [];
  return Object.entries(v).flatMap(([k, x]) => [...(FORBIDDEN.test(k) ? [`${at}.${k}`] : []), ...forbiddenKeys(x, `${at}.${k}`)]);
}
async function waitFor(fn, { timeout = 30_000, every = 500, label = "condição" } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`tempo esgotado esperando ${label}`);
    await sleep(every);
  }
}

// ---------- estado do seed, NocoDB e sessão ----------

function seedState() {
  if (!existsSync(STATE_FILE)) throw new Error("Rode antes: node --env-file=.env.local scripts/apareca/seed-local.mjs");
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}

// Dono cujo 1º restaurante (menor Id) é o do seed: é o que o painel abre.
async function panelUser(db, rid) {
  const rows = await db.list("restaurants", {});
  const idOf = new Map(rows.map((r) => [r.uid, r.Id]));
  const mine = idOf.get(rid);
  for (const m of await db.list("members", { restaurant_id: rid })) {
    if (m.role !== "owner") continue;
    const all = await db.list("members", { user_id: m.user_id });
    if (Math.min(...all.map((a) => idOf.get(a.restaurant_id) ?? Infinity)) === mine) return m.user_id;
  }
  throw new Error("Nenhum dono tem este restaurante como o 1º do painel.");
}

// O mesmo formato de src/lib/auth/session.ts (userId.exp.assinatura em base64url). Só no teste.
function sessionCookie(userId) {
  const secret = process.env.AUTH_SECRET || `cardapio-session:${process.env.NOCODB_API_TOKEN ?? ""}`;
  if (secret === "cardapio-session:") throw new Error("Falta AUTH_SECRET ou NOCODB_API_TOKEN (rode com --env-file=.env.local).");
  const payload = `${userId}.${Math.floor(Date.now() / 1000) + 3 * 3600}`;
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

// ---------- servidor do app ----------

function serverEnv(cfg, offsetMs = 0) {
  const mux = `http://localhost:${cfg.muxPort}`;
  return {
    ...process.env,
    STORAGE_DRIVER: "local",
    NOCODB_COUNT: "1",
    MUX_API_BASE: `${mux}/video/v1`,
    MUX_STREAM_BASE: `${mux}/stream`,
    MUX_IMAGE_BASE: `${mux}/image`,
    MUX_TOKEN_ID: "falso",
    MUX_TOKEN_SECRET: "falso",
    ANTHROPIC_API_KEY: "",
    APARECA_OFF: "",
    APARECA_NOW_OFFSET_MS: offsetMs ? String(offsetMs) : "",
    NODE_ENV: "production",
  };
}

async function build() {
  console.log("build (STORAGE_DRIVER=local)…");
  await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "build"], {
      cwd: ROOT, env: { ...process.env, STORAGE_DRIVER: "local" }, stdio: ["ignore", "inherit", "inherit"],
    });
    p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`build saiu com ${c}`))));
  });
}

async function startServer(cfg, offsetMs = 0) {
  const child = spawn(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(cfg.port), "-H", "127.0.0.1"], {
    cwd: ROOT, env: serverEnv(cfg, offsetMs), stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = [];
  const keep = (b) => {
    logs.push(String(b));
    if (logs.length > 200) logs.shift();
  };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  const slugState = seedState();
  await waitFor(
    async () => {
      if (child.exitCode !== null) throw new Error(`o servidor saiu: ${logs.join("").slice(-500)}`);
      const r = await fetch(`${cfg.base}/api/apareca/${slugState.slug}`).catch(() => null);
      return r?.status === 200;
    },
    { timeout: 60_000, label: "o servidor subir" },
  );
  return {
    child,
    logs,
    stop: () =>
      new Promise((r) => {
        if (child.exitCode !== null) return r();
        child.once("exit", () => r());
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5_000);
      }),
  };
}

async function calls(cfg) {
  const r = await fetch(`${cfg.base}/api/arquivos-locais/_calls`, { cache: "no-store" });
  if (r.status !== 200) throw new Error("contador desligado: o servidor precisa de STORAGE_DRIVER=local NOCODB_COUNT=1");
  return r.json();
}

// ---------- contextos ----------

async function launch(chromium) {
  const args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"];
  try {
    // Chrome de verdade: toca H.264 (o Chromium do Playwright não tem o codec dos MP4).
    return await chromium.launch({ channel: "chrome", args });
  } catch {
    console.log("Chrome não encontrado; usando o Chromium do Playwright (MP4 H.264 pode não tocar).");
    return chromium.launch({ args });
  }
}

const phoneCtx = (browser) =>
  browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "pt-BR", permissions: ["camera", "microphone"] });

async function panel(browser, cfg, st, userId) {
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, locale: "pt-BR" });
  await ctx.addCookies([{ name: "cd_session", value: sessionCookie(userId), url: cfg.base, httpOnly: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  await page.goto(`${cfg.base}/painel/apareca`, { waitUntil: "domcontentloaded" });
  await page.locator(".app-fila").waitFor({ state: "visible", timeout: 30_000 });
  if (!page.url().includes("/painel/apareca")) throw new Error(`o painel abriu ${page.url()}`);
  return { ctx, page };
}

// TV pareada pelo seed: o segredo vai para o localStorage antes de a página carregar, e um
// vigia anota a sequência do que fica na frente (institucional ou cliente, com o nome).
async function tvPage(browser, cfg, st, which) {
  const ctx = await browser.newContext({ viewport: TV, deviceScaleFactor: 1, locale: "pt-BR" });
  await ctx.addInitScript(
    ([k, v]) => {
      try {
        localStorage.setItem(k, v);
      } catch {}
      window.__seq = [];
      setInterval(() => {
        const s = document.querySelector(".apt-slot.front.shown");
        const v2 = s?.querySelector("video");
        const kind = !s ? "nada" : s.classList.contains("k-client") ? "cliente" : s.classList.contains("k-house") ? "casa" : "?";
        const name = s?.querySelector(".apt-name")?.textContent ?? null;
        const playing = !!v2 && !v2.paused && v2.currentTime > 0;
        const last = window.__seq[window.__seq.length - 1];
        if (!last || last.kind !== kind || last.name !== name) window.__seq.push({ kind, name, at: Date.now(), playing });
        else if (playing && !last.playing) last.playing = true;
      }, 200);
    },
    [`tl-secret:${st.slug}`, st.secrets[which]],
  );
  const page = await ctx.newPage();
  const programs = [];
  page.on("response", async (r) => {
    if (!r.url().includes(`/api/apareca/${st.slug}/tv/programa`)) return;
    try {
      programs.push({ at: Date.now(), status: r.status(), body: await r.json() });
    } catch {}
  });
  await page.goto(`${cfg.base}/${st.slug}/telao`, { waitUntil: "domcontentloaded" });
  return { ctx, page, programs, seq: () => page.evaluate(() => window.__seq) };
}

// Abre a página do Apareça num celular novo (device novo) e guarda as respostas do "meu".
async function openApareca(browser, cfg, st) {
  const ctx = await phoneCtx(browser);
  const page = await ctx.newPage();
  const mine = [];
  page.on("response", async (r) => {
    if (!r.url().endsWith(`/api/apareca/${st.slug}/meu`)) return;
    try {
      mine.push({ at: Date.now(), status: r.status(), body: await r.json() });
    } catch {}
  });
  await page.goto(`${cfg.base}/${st.slug}/apareca?mesa=${st.mesa}`, { waitUntil: "domcontentloaded" });
  await page.locator(".apa-form").waitFor({ state: "visible", timeout: 30_000 });
  return { ctx, page, mine };
}

// Grava um clipe: espera a câmera, toca no botão, mede o tempo de "Gravando" até a revisão.
async function recordOnce(page, { redo = false } = {}) {
  if (redo) {
    // "Regravar" reabre a câmera e vai direto para a contagem.
    await page.getByRole("button", { name: /^Regravar/ }).click();
  } else {
    const shoot = page.locator(".apa-shoot");
    await shoot.waitFor({ state: "visible", timeout: 20_000 });
    await waitFor(() => shoot.isEnabled(), { timeout: 20_000, label: "a câmera abrir" });
    await shoot.click();
  }
  await page.locator(".apa-recdot").waitFor({ state: "visible", timeout: 15_000 });
  const t0 = Date.now();
  const bar = await page.locator(".apa-bar i").evaluate((el) => getComputedStyle(el).animationDuration).catch(() => null);
  await page.locator(".apa-stage.is-review").waitFor({ state: "visible", timeout: 15_000 });
  return { ms: Date.now() - t0, bar };
}

async function fillAndOpenCamera(page, name) {
  await page.fill(".apa-field input", name);
  await page.locator(".apa-check input").check({ force: true });
  await page.locator(".apa-btn-cam").click();
}

async function sendAndWaitQueue(page) {
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await page.getByText("Seu vídeo está na fila!").waitFor({ state: "visible", timeout: 45_000 });
  return Date.now();
}

const myId = (p) => p.page.evaluate((slug) => JSON.parse(localStorage.getItem(`apa-meu:${slug}`) ?? "null"), p.slug);

// ---------- os 9 passos ----------

async function passos(browser, cfg, ctx) {
  const { st, mux, db } = ctx;
  const userId = await panelUser(db, st.rid);
  const pnl = await panel(browser, cfg, st, userId);
  const tvBar = await tvPage(browser, cfg, st, "bar");
  const tvSalao = await tvPage(browser, cfg, st, "salao");
  ctx.cleanup.push(pnl.ctx, tvBar.ctx, tvSalao.ctx);

  // 1. Convite com mesa; some com o Apareça desligado (pelo interruptor do painel).
  {
    const c = await phoneCtx(browser);
    const p = await c.newPage();
    await p.goto(`${cfg.base}/${st.slug}?mesa=${st.mesa}`, { waitUntil: "domcontentloaded" });
    const inv = p.locator(".apa-inv");
    const shown = await inv.waitFor({ state: "visible", timeout: 30_000 }).then(() => true, () => false);
    if (shown) await shot(p, "01-convite-com-mesa");
    const sw = pnl.page.locator('.app-sw[aria-labelledby="app-sw-l"]');
    if ((await sw.getAttribute("aria-checked")) !== "true") throw new Error("o Apareça começou desligado: rode o seed de novo");
    await sw.click();
    await waitFor(async () => (await sw.getAttribute("aria-checked")) === "false" && (await sw.isEnabled()), { label: "desligar" });
    const head = await fetch(`${cfg.base}/api/apareca/${st.slug}`).then((r) => r.json());
    const p2 = await c.newPage();
    await p2.goto(`${cfg.base}/${st.slug}?mesa=${st.mesa}`, { waitUntil: "domcontentloaded" });
    await p2.locator(".hero").first().waitFor({ state: "visible", timeout: 30_000 });
    await sleep(5_000); // o convite pede a cabeça uma vez ao montar
    const gone = (await p2.locator(".apa-inv").count()) === 0;
    await shot(p2, "02-convite-some-desligado");
    await sw.click();
    await waitFor(async () => (await sw.getAttribute("aria-checked")) === "true" && (await sw.isEnabled()), { label: "religar" });
    check("1 convite aparece com mesa e some com o Apareça desligado", shown && gone && head.enabled === false, `GET público depois de desligar: enabled=${head.enabled}`);
    await c.close();
  }

  // 2. Palavrão no nome é recusado (tela e servidor); sem aceite, não grava (tela e servidor).
  {
    const ph = await openApareca(browser, cfg, st);
    const { page } = ph;
    const cam = page.locator(".apa-btn-cam");
    await page.fill(".apa-field input", "caralho");
    await page.locator(".apa-check input").check({ force: true });
    const errShown = await page.locator(".apa-field small.is-err").isVisible();
    const disabledName = await cam.isDisabled();
    await shot(page, "03-nome-recusado");
    await page.fill(".apa-field input", "");
    await page.locator(".apa-check input").uncheck({ force: true });
    const disabledConsent = await cam.isDisabled();
    const post = (body) =>
      fetch(`${cfg.base}/api/apareca/${st.slug}/enviar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const dev = randomUUID();
    const rName = await post({ mesa: st.mesa, device: dev, name: "caralho", consent: true, consent_at: new Date().toISOString() });
    const rConsent = await post({ mesa: st.mesa, device: dev, name: null, consent: false });
    check(
      "2 nome com palavrão recusado; sem aceite não grava",
      errShown && disabledName && disabledConsent && rName.status === 422 && rName.body.code === "name" && rConsent.status === 422 && rConsent.body.code === "consent",
      `tela: aviso=${errShown}, botão travado com palavrão=${disabledName} e sem aceite=${disabledConsent}; servidor: ${rName.status}/${rName.body.code} e ${rConsent.status}/${rConsent.body.code}`,
    );
    await ph.ctx.close();
  }

  // 3. Grava 6 s e para sozinho; regravar 3 vezes e o botão some.
  const one = await openApareca(browser, cfg, st);
  one.slug = st.slug;
  ctx.cleanup.push(one.ctx);
  {
    const { page } = one;
    await fillAndOpenCamera(page, "@e2e_um");
    const shootP = page.locator(".apa-shoot");
    await waitFor(() => shootP.isEnabled(), { timeout: 20_000, label: "a câmera abrir" });
    await shot(page, "04-camera-aberta");
    const takes = [];
    const first = recordOnce(page);
    await page.locator(".apa-recdot").waitFor({ state: "visible", timeout: 15_000 });
    await sleep(2_500);
    await shot(page, "05-gravando-barra");
    takes.push(await first);
    for (let k = 0; k < 3; k++) {
      takes.push(await recordOnce(page, { redo: true }));
    }
    const redoGone = (await page.getByRole("button", { name: /^Regravar/ }).count()) === 0;
    const tip = await page.getByText("Você já usou as 3 regravações.").isVisible();
    await shot(page, "06-sem-regravar");
    const okTimes = takes.every((t) => t.ms >= 5_500 && t.ms <= 7_500);
    check(
      "3 grava 6 s com a barra e para sozinho; 3 regravações e o botão some",
      okTimes && takes[0].bar === "6s" && redoGone && tip,
      `gravações de ${takes.map((t) => (t.ms / 1000).toFixed(1)).join(", ")} s; barra ${takes[0].bar}; botão some=${redoGone}`,
    );
  }

  // 4. Envia → "Seu vídeo está na fila!" com posição; o Mux falso recebe o passthrough certo.
  let sentAt = 0;
  let v1 = null;
  {
    sentAt = await sendAndWaitQueue(one.page);
    v1 = await myId(one);
    const pos = await waitFor(async () => (/(\d+)º da fila/.exec((await one.page.locator(".apa-queue").textContent()) ?? "") ?? null), {
      timeout: 30_000, label: "a posição na fila",
    });
    await shot(one.page, "07-na-fila");
    const up = [...mux.state.assets.values()].find((a) => a.passthrough?.endsWith(`:${v1.id}`));
    const upl = [...mux.state.uploads.values()].find((u) => u.passthrough?.endsWith(`:${v1.id}`));
    const pt = `apareca:${st.rid}:${st.table_id}:${v1.id}`;
    const s = upl?.settings ?? {};
    check(
      "4 envia e vê \"Seu vídeo está na fila!\" com posição",
      !!pos && up?.passthrough === pt && s.video_quality === "basic" && s.max_resolution_tier === "1080p" && s.static_renditions?.[0]?.resolution === "highest",
      `${pos[1]}º da fila; arquivo ${up?.type} de ${Math.round((up?.bytes ?? 0) / 1024)} KB com ${up?.duration?.toFixed(2)} s; passthrough ${up?.passthrough === pt ? "certo" : "ERRADO"}; basic/1080p/highest`,
    );
  }

  // 5. Painel: aparece em ≤ 10 s; Aprovar com um toque.
  {
    const item = pnl.page.locator(".app-item", { hasText: "@e2e_um" });
    const t0 = Date.now();
    await item.waitFor({ state: "visible", timeout: 40_000 });
    const after = (Date.now() - sentAt) / 1000;
    await shot(pnl.page, "08-painel-fila");
    await item.locator(".app-btn-yes").click();
    await item.waitFor({ state: "detached", timeout: 20_000 });
    const row = await waitFor(async () => (await db.list("apareca_videos", { uid: v1.id }))[0]?.status === "approved" && (await db.list("apareca_videos", { uid: v1.id }))[0], { label: "approved no banco" });
    await shot(pnl.page, "09-painel-aprovado");
    check("5 painel mostra o vídeo em ≤ 10 s e aprova com um toque", after <= 10 && row.decided_by === "equipe", `apareceu ${after.toFixed(1)} s depois da fila no celular (${((Date.now() - t0) / 1000).toFixed(1)} s até aprovar); decided_by=${row.decided_by}`);
  }

  // 6. TV do Bar: entra depois de um institucional; o celular mostra "Olhe para a TV agora!".
  {
    const seq = await waitFor(async () => {
      const s = await tvBar.seq();
      const i = s.findIndex((x) => x.kind === "cliente" && x.name === "@e2e_um");
      return i >= 0 ? { s, i } : null;
    }, { timeout: 90_000, label: "o vídeo na TV do Bar" });
    await sleep(1_500);
    await shot(tvBar.page, "10-tv-bar-cliente");
    const before = seq.s.slice(0, seq.i).filter((x) => x.kind !== "nada").pop();
    const look = await one.page.getByText("Olhe para a TV agora!").waitFor({ state: "visible", timeout: 30_000 }).then(() => true, () => false);
    await shot(one.page, "11-celular-olhe-para-a-tv");
    const leaks = tvBar.programs.flatMap((p) => forbiddenKeys(p.body));
    check(
      "6 TV do Bar toca o vídeo depois do institucional; celular mostra \"Olhe para a TV agora!\"",
      before?.kind === "casa" && look && leaks.length === 0,
      `antes do cliente: ${before?.kind ?? "nada"}; sequência ${seq.s.map((x) => x.kind).join(" → ")}; programa sem chaves proibidas: ${leaks.length === 0 ? "sim" : leaks.join(",")}`,
    );
  }

  // 7. TV do Salão não recebe o vídeo.
  {
    await sleep(6_000);
    const s = await tvSalao.seq();
    const got = s.some((x) => x.kind === "cliente");
    const inProgram = tvSalao.programs.some((p) => JSON.stringify(p.body?.program ?? null).includes(v1.id));
    const houseOk = s.some((x) => x.kind === "casa");
    await shot(tvSalao.page, "12-tv-salao-so-casa");
    check("7 TV do Salão não recebe o vídeo da mesa do Bar", !got && !inProgram && houseOk && tvSalao.programs.length > 0, `${tvSalao.programs.length} programas lidos; institucionais tocando=${houseOk}; cliente na tela=${got}; id no programa=${inProgram}`);
  }

  // 8. Reprovar outro → "Seu vídeo não pôde ser exibido"; "meu" sem ai_reason, device_id, table_id.
  let v2 = null;
  const two = await openApareca(browser, cfg, st);
  two.slug = st.slug;
  ctx.cleanup.push(two.ctx);
  {
    await fillAndOpenCamera(two.page, "@e2e_dois");
    await recordOnce(two.page);
    await sendAndWaitQueue(two.page);
    v2 = await myId(two);
    const item = pnl.page.locator(".app-item", { hasText: "@e2e_dois" });
    await item.waitFor({ state: "visible", timeout: 40_000 });
    await item.locator(".app-btn-no").click();
    await shot(pnl.page, "13-painel-reprovar-desfazer");
    await item.waitFor({ state: "detached", timeout: 30_000 });
    await two.page.getByText("Seu vídeo não pôde ser exibido").waitFor({ state: "visible", timeout: 40_000 });
    await shot(two.page, "14-celular-nao-exibido");
    const row = (await db.list("apareca_videos", { uid: v2.id }))[0];
    const asset = [...mux.state.assets.values()].find((a) => a.passthrough?.endsWith(`:${v2.id}`));
    const leaks = [...one.mine, ...two.mine].flatMap((m) => forbiddenKeys(m.body));
    const last = two.mine[two.mine.length - 1]?.body;
    check(
      "8 reprovado → \"Seu vídeo não pôde ser exibido\"; o \"meu\" não tem ai_reason, device_id nem table_id",
      row?.status === "rejected" && !!asset?.deleted && leaks.length === 0 && last?.state === "not_shown",
      `${one.mine.length + two.mine.length} respostas do "meu" conferidas (chaves: ${Object.keys(last ?? {}).join(", ")}); asset apagado no Mux falso=${!!asset?.deleted}`,
    );
  }

  // 9. Relógio do servidor além do prazo → a linha e o asset somem na próxima leitura.
  {
    const ids = [v1.id, v2.id];
    const asset1 = [...mux.state.assets.values()].find((a) => a.passthrough?.endsWith(`:${v1.id}`));
    const tallyBefore = (await db.list("apareca_tally", { restaurant_id: st.rid })).length;
    // A8: nada consulta o servidor enquanto o relógio pula. Sem isto, a consulta do celular a cada 8 s
    // podia cair no servidor novo antes do reload, receber "gone" e limpar o localStorage: o reload
    // então abria o formulário em vez de "Este vídeo não está mais disponível". As TVs, o painel e o
    // segundo celular fecham; o primeiro sai para about:blank (o localStorage fica no contexto) e
    // volta depois do salto, de modo que a 1ª leitura depois do salto é a dele.
    for (const c of [tvBar.ctx, tvSalao.ctx, two.ctx, pnl.ctx]) await c.close();
    const phoneUrl = one.page.url();
    await one.page.goto("about:blank");
    await ctx.server.stop();
    ctx.server = await startServer(cfg, (RETENTION_H + 1) * 3_600_000);
    await one.page.goto(phoneUrl, { waitUntil: "domcontentloaded" });
    const goneText = await one.page.getByText("Este vídeo não está mais disponível").waitFor({ state: "visible", timeout: 30_000 }).then(() => true, () => false);
    await shot(one.page, "15-celular-vencido");
    const purged = await waitFor(async () => {
      const left = (await Promise.all(ids.map((id) => db.list("apareca_videos", { uid: id })))).flat();
      return left.length === 0 && asset1?.deleted ? true : null;
    }, { timeout: 30_000, label: "a linha e o asset sumirem" }).catch(() => false);
    const tallyAfter = (await db.list("apareca_tally", { restaurant_id: st.rid })).length;
    check(
      "9 relógio adiantado além do prazo: a linha e o asset falso somem na próxima leitura",
      goneText && purged && tallyAfter > tallyBefore,
      `celular: "Este vídeo não está mais disponível"=${goneText}; linhas apagadas=${purged}; asset aprovado apagado=${!!asset1?.deleted}; tally ${tallyBefore} → ${tallyAfter}`,
    );
    await ctx.server.stop();
    ctx.server = await startServer(cfg, 0);
  }
}

// ---------- chamadas por noite ----------

async function medir(browser, cfg, ctx) {
  const { st, db } = ctx;
  const userId = await panelUser(db, st.rid);
  const pnl = await panel(browser, cfg, st, userId);
  const tvs = [await tvPage(browser, cfg, st, "bar"), await tvPage(browser, cfg, st, "salao")];
  ctx.cleanup.push(pnl.ctx, ...tvs.map((t) => t.ctx));
  await sleep(10_000); // tudo aberto e em regime antes de começar a contar

  const diff = (a, b) => {
    const out = {};
    for (const [k, n] of Object.entries(b.byKey)) if (n - (a.byKey[k] ?? 0)) out[k] = n - (a.byKey[k] ?? 0);
    return { total: b.total - a.total, byKey: out };
  };

  // Fase A: só as 2 TVs e o painel (o custo que corre com o tempo, sem envios).
  const a0 = await calls(cfg);
  const tA = Date.now();
  console.log(`medindo ${cfg.baseMinutes} min só com 2 TVs e o painel…`);
  await sleep(cfg.baseMinutes * 60_000);
  const a1 = await calls(cfg);
  const idle = diff(a0, a1);
  const idleMin = (Date.now() - tA) / 60_000;

  // Fase B: um celular novo a cada N min enviando; o painel aprova o que chegar.
  console.log(`medindo ${cfg.minutes} min com um celular a cada ${cfg.every} min…`);
  const tB = Date.now();
  const end = tB + cfg.minutes * 60_000;
  const phones = [];
  let sent = 0;
  let approved = 0;
  let nextPhone = tB;
  let k = 0;
  while (Date.now() < end) {
    if (Date.now() >= nextPhone) {
      nextPhone += cfg.every * 60_000;
      k += 1;
      const name = `@medir_${k}`;
      try {
        const ph = await openApareca(browser, cfg, st);
        await fillAndOpenCamera(ph.page, name);
        await recordOnce(ph.page);
        await sendAndWaitQueue(ph.page);
        sent += 1;
        phones.push({ ...ph, closeAt: Date.now() + 8 * 60_000 });
      } catch (e) {
        console.log(`celular ${k}: ${e.message.split("\n")[0]}`);
      }
    }
    const yes = pnl.page.locator(".app-item .app-btn-yes:not([disabled])").first();
    if (await yes.count()) {
      await yes.click().then(() => (approved += 1), () => {});
    }
    for (const ph of phones.filter((p) => !p.closed && Date.now() >= p.closeAt)) {
      ph.closed = true;
      await ph.ctx.close();
    }
    await sleep(3_000);
  }
  const b1 = await calls(cfg);
  for (const ph of phones.filter((p) => !p.closed)) await ph.ctx.close();
  const busy = diff(a1, b1);
  const busyMin = (Date.now() - tB) / 60_000;

  const perMinIdle = idle.total / idleMin;
  const perVideo = sent ? (busy.total - perMinIdle * busyMin) / sent : 0;
  const night = Math.round(perMinIdle * 300 + perVideo * 50);
  const shown = (await Promise.all(tvs.map((t) => t.seq()))).map((s) => s.filter((x) => x.kind === "cliente").length);
  const out = {
    fase_a: { minutos: +idleMin.toFixed(1), chamadas: idle.total, por_minuto: +perMinIdle.toFixed(2), por_chave: idle.byKey },
    fase_b: { minutos: +busyMin.toFixed(1), chamadas: busy.total, videos_enviados: sent, aprovados_no_painel: approved, por_chave: busy.byKey },
    por_video: +perVideo.toFixed(1),
    projecao_5h_50_videos: night,
    estimativa_t2: 5500,
    clientes_na_tela_por_tv: { bar: shown[0], salao: shown[1] },
  };
  console.log(JSON.stringify(out, null, 2));
  check("medir chamadas por noite", sent > 0, `${night} chamadas projetadas para 5 h e 50 vídeos (estimativa da T2: ~5.500); ${perMinIdle.toFixed(1)}/min parado, ${perVideo.toFixed(1)} por vídeo`);
  ctx.measure = out;
}

// ---------- principal ----------

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  assertLocalNocodb(process.env.NOCODB_URL);
  const st = seedState();
  await mkdir(PRINTS, { recursive: true });
  const db = await localNocodb(process.env);
  if (cfg.build) await build();
  const mux = await startFakeMux({ port: cfg.muxPort, log: (s) => console.log(`[mux falso] ${s}`) });
  const ctx = { st, db, mux, cleanup: [], server: null };
  const { chromium } = await loadPlaywright();
  let browser;
  try {
    ctx.server = await startServer(cfg, 0);
    browser = await launch(chromium);
    const phases = { passos, medir };
    for (const ph of cfg.phases) {
      if (!phases[ph]) throw new Error(`fase desconhecida: ${ph}`);
      console.log(`\n== ${ph} (${st.slug}) ==`);
      try {
        await phases[ph](browser, cfg, ctx);
      } catch (e) {
        check(`${ph}: erro`, false, e.message.split("\n")[0]);
      }
      for (const c of ctx.cleanup.splice(0)) await c.close().catch(() => {});
    }
  } finally {
    await browser?.close().catch(() => {});
    await ctx.server?.stop();
    await mux.close();
  }
  console.log(`\nprints: ${prints.join(", ") || "nenhum"}`);
  console.log(`chamadas ao Mux falso: ${mux.state.calls.length}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length} ok, ${failed.length} falha(s)`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
