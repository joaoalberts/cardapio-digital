// Dados de exemplo do cardápio em lista, só no NocoDB do Docker: três restaurantes fictícios
// (Forno Aurora, Casa Nonna e Casa Simples, este incompleto de propósito) com os pratos do
// protótipo aprovado (docs/prototipos/lista), para conferir a lista no navegador.
//
//   node --env-file=.env.local scripts/lista/seed-local.mjs            cria ou atualiza (pode rodar de novo)
//   node --env-file=.env.local scripts/lista/seed-local.mjs --desfazer apaga só o que o seed criou
//
// Os uids são fixos: rodar de novo atualiza as mesmas linhas e tira as que saíram do seed. As fotos
// são as de public/demo (storage_path "/demo/..."). O script nunca cria coluna: se items.subgroup
// ou categories.doughs ainda não existirem no banco (rode scripts/nocodb/setup.mjs), avisa e grava
// sem elas. Se o usuário de teste local existir, ele vira dono dos três restaurantes (abre o painel).
// Recusa qualquer NOCODB_URL que não seja http://localhost, antes de qualquer chamada.

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertLocalNocodb } from "../comunidade/seed-local.mjs";

export { assertLocalNocodb };

export const TEST_USER_EMAIL = "teste-local@exemplo.test";
export const SLUGS = ["forno-aurora", "casa-nonna", "casa-simples"];

// Fotos grandes que existem em public/demo; as outras só têm a miniatura (-t.jpg).
export const FULL_PHOTOS = new Set([
  "bg-brasa", "bg-classico", "bg-smash", "ms-bolonhesa", "ms-penne", "ms-pomodoro",
  "pz-calabresa", "pz-margherita", "pz-queijos", "sb-chocolate", "sb-mousse", "sb-sorvete",
]);
export const photoPath = (base) => `/demo/${base}${FULL_PHOTOS.has(base) ? "" : "-t"}.jpg`;

/** uid fixo e estável a partir de uma chave ("item:forno-aurora:margherita"), com o prefixo "lista:" para não colidir com os outros seeds. */
export const seedUid = (key) => `5eed0000-115a-4000-8000-${createHash("sha1").update(`lista:${key}`).digest("hex").slice(0, 12)}`;

const LANGS = ["pt-BR", "en", "es", "fr", "it", "de"];
const DAY = (...ranges) => Array.from({ length: 7 }, () => ranges.map(([open, close]) => ({ open, close })));
const DOUGHS = [{ label: "Tradicional", extra_cents: 0 }, { label: "Fina", extra_cents: 500 }];

// Prato: [chave, nome, descrição, foto, preço | [[tamanho, preço]...], selos, extras]
// extras: featured, serves, country, promo, subgroup, hide, active
const AURORA = {
  slug: "forno-aurora",
  name: "Forno Aurora",
  brand_color: "#E8B04B",
  font_theme: "moderno",
  logo_path: "/demo/logo-forno-aurora.png",
  cover_image_path: "/demo/v-forno-poster.jpg",
  address: "Rua das Acácias, 214 · Vila Aurora",
  opening_hours: DAY(["00:00", "23:00"]),
  languages: LANGS,
  orders_enabled: true,
  table: { label: "Mesa 1", code: "AURORA" },
  cats: [
    { key: "pizzas", name: "Pizzas", cover: "pz-queijos", half: true, items: [
      ["margherita", "Margherita", "Molho de tomate pelado, muçarela de búfala, manjericão fresco e azeite extravirgem.", "pz-queijos", [["Média", 5900], ["Grande", 7900]], ["vegetariano", "com_gluten", "com_lactose"], { featured: true, serves: 2, subgroup: "Tradicionais" }],
      ["calabresa", "Calabresa da casa", "Calabresa defumada fatiada fina, cebola roxa, pimentão, azeitonas pretas e orégano.", "pz-calabresa", [["Média", 6200], ["Grande", 8400]], ["com_gluten", "com_lactose"], { subgroup: "Tradicionais" }],
      ["pepperoni", "Pepperoni picante", "Pepperoni artesanal, muçarela, mel de pimenta e presunto cru.", "pz-pepperoni", [["Média", 6900], ["Grande", 9200]], ["apimentado", "com_gluten", "com_lactose"], { featured: true, subgroup: "Especiais" }],
      ["queijos", "Quatro queijos", "Muçarela puxa-puxa, gorgonzola, provolone e parmesão, com azeitonas e nozes.", "pz-margherita", [["Média", 7200], ["Grande", 9600]], ["vegetariano", "com_lactose", "contem_nozes"], { subgroup: "Especiais" }],
    ] },
    { key: "massas", name: "Massas", cover: "ms-pomodoro", items: [
      ["bolonhesa", "Espaguete à bolonhesa", "Ragu de carne cozido por seis horas, tomate italiano e lascas de parmesão.", "ms-bolonhesa", 5800, ["com_gluten", "com_lactose"], {}],
      ["frango", "Talharim com frango ao limão", "Frango grelhado, molho cremoso de limão-siciliano, alho-poró e salsinha.", "ms-frango", 5400, ["com_gluten", "com_leite"], { featured: true }],
      ["arrabbiata", "Penne arrabbiata", "Molho de tomate com pimenta calabresa, alho dourado e salsinha.", "ms-pomodoro", 4800, ["vegano", "apimentado", "com_gluten"], {}],
      ["sugo", "Fusilli ao sugo", "Tomate cereja confitado e manjericão. Lascas de parmesão à parte, se quiser.", "ms-penne", 4600, ["vegano", "com_gluten"], {}],
      ["risoto", "Risoto do dia", "O risoto que o chef escolheu hoje. Pergunte ao garçom.", null, 0, [], { hide: true }],
    ] },
    { key: "burgers", name: "Burgers", cover: "bg-classico", items: [
      ["classico", "Clássico Aurora", "Blend de 160 g, queijo prato, alface, tomate e maionese da casa no pão de brioche.", "bg-classico", 3900, ["com_gluten", "com_lactose", "com_ovo"], { featured: true }],
      ["bacon", "Bacon duplo", "Dois blends de 120 g, cheddar inglês, bacon crocante e cebola caramelizada.", "bg-bacon", 4900, ["com_gluten", "com_lactose"], { promo: 4200 }],
      ["brasa", "Brasa", "Blend na brasa, queijo coalho grelhado, vinagrete de abacaxi e molho barbecue.", "bg-brasa", 4400, ["com_gluten", "com_lactose"], {}],
      ["smash", "Smash da noite", "Dois smash de 80 g, cheddar e picles. Só depois das 19h.", "bg-smash", 3200, ["com_gluten", "com_lactose"], {}],
    ] },
    { key: "sobremesas", name: "Sobremesas", cover: "sb-chocolate", items: [
      ["chocolate", "Bolo quente de chocolate", "Chocolate 70%, framboesas e calda morna. Leva 12 minutos para sair do forno.", "sb-chocolate", 3200, ["com_gluten", "com_ovo", "com_leite"], { featured: true }],
      ["rocambole", "Rocambole de morango", "Pão de ló, creme de baunilha e frutas vermelhas.", "sb-rocambole", 2800, ["com_gluten", "com_ovo"], {}],
      ["taca", "Taça de frutas vermelhas", "Sorvete de creme, morangos, chantili e calda de amora.", "sb-sorvete", 2600, ["sem_gluten", "com_leite"], {}],
      ["mousse", "Mousse de chocolate", "Camadas de mousse e creme, com farofa de biscoito e framboesa.", "sb-mousse", 2400, ["com_gluten", "com_leite"], {}],
      ["cafe", "Café coado na mesa", "Grãos do sul de Minas, servidos na prensa francesa para duas xícaras.", null, 1200, ["vegano", "sem_gluten", "sem_acucar"], { serves: 2 }],
    ] },
    // A lista não mostra estas duas (sem pratos ativos; fora do horário) nem a categoria especial.
    { key: "bebidas", name: "Bebidas", cover: null, items: [
      ["suco-inativo", "Suco de laranja (fora de linha)", "Prato desativado: a categoria fica sem pratos ativos.", null, 900, [], { active: false }],
    ] },
    { key: "madrugada", name: "Cafés da madrugada", cover: null, from: "03:00:00", to: "03:30:00", items: [
      ["expresso", "Café expresso", "Só entre 3h e 3h30, para quem fecha a casa.", null, 700, ["vegano", "sem_gluten"], {}],
    ] },
    { key: "relampago", name: "Ofertas relâmpago", cover: null, special: true, items: [
      ["oferta-combo", "Combo relâmpago", "Pizza média e refrigerante por tempo limitado.", "pz-queijos", 6900, [], { promo: 4900, special: true }],
    ] },
  ],
  // Traduções em inglês: categorias e alguns pratos.
  en: {
    cats: { pizzas: "Pizzas", massas: "Pasta", burgers: "Burgers", sobremesas: "Desserts", madrugada: "Late-night coffee" },
    items: {
      margherita: ["Margherita", "Peeled tomato sauce, buffalo mozzarella, fresh basil and extra virgin olive oil."],
      calabresa: ["House sausage pizza", "Thinly sliced smoked sausage, red onion, bell pepper, black olives and oregano."],
      pepperoni: ["Spicy pepperoni", "Artisan pepperoni, mozzarella, hot honey and cured ham."],
      bolonhesa: ["Spaghetti bolognese", "Beef ragu slow-cooked for six hours, Italian tomato and parmesan shavings."],
      classico: ["Aurora Classic", "160 g patty, cheese, lettuce, tomato and house mayo on a brioche bun."],
      bacon: ["Double bacon", "Two 120 g patties, aged cheddar, crispy bacon and caramelized onion."],
      chocolate: ["Hot chocolate cake", "70% chocolate, raspberries and warm sauce. Takes 12 minutes to bake."],
      cafe: ["Table-side brewed coffee", "Beans from southern Minas, served in a French press for two cups."],
    },
  },
};

const NONNA = {
  slug: "casa-nonna",
  name: "Casa Nonna",
  brand_color: "#9E2A3A",
  font_theme: "boutique",
  logo_path: "/demo/logo-casa-nonna.svg",
  cover_image_path: "/demo/ms-bolonhesa.jpg",
  address: "Rua Itália, 88 · Bixiga",
  opening_hours: DAY(["00:00", "22:30"]),
  languages: LANGS,
  orders_enabled: true,
  table: { label: "Mesa 1", code: "NONNAA" },
  cats: [
    { key: "massas", name: "Massas", cover: "ms-bolonhesa", items: [
      ["bolo", "Spaghetti alla bolognese", "Ragu de carne e porco cozido devagar, tomate San Marzano e parmigiano.", "ms-bolonhesa", 6400, ["com_gluten", "com_lactose"], { serves: 1, subgroup: "Clássicas da Nonna" }],
      ["penne", "Penne al pomodoro", "Tomate fresco, manjericão e azeite da Sicília. Simples como em casa.", "ms-penne", 5200, ["vegano", "com_gluten"], { featured: true, subgroup: "Clássicas da Nonna" }],
      ["limone", "Tagliatelle al limone", "Massa fresca, frango grelhado, creme leve de limão-siciliano e pimenta-do-reino.", "ms-frango", 5900, ["com_gluten", "com_leite", "com_ovo"], { featured: true, subgroup: "Molhos leves" }],
      ["arr", "Penne all'arrabbiata", "Tomate, alho, pimenta seca e salsinha. Picância média.", "ms-pomodoro", 5400, ["vegano", "apimentado", "com_gluten"], { subgroup: "Molhos leves" }],
    ] },
    { key: "pizzas", name: "Pizzas", cover: "pz-queijos", half: true, items: [
      ["margherita", "Margherita napoletana", "Massa de fermentação longa, fior di latte, tomate pelado e manjericão. Assada a 450 °C.", "pz-queijos", [["Individual", 4800], ["Para dividir", 7600]], ["vegetariano", "com_gluten", "com_lactose"], { featured: true, serves: 2, country: "IT" }],
      ["formaggi", "Quattro formaggi", "Fior di latte, gorgonzola, taleggio e parmigiano, com mel de laranjeira.", "pz-calabresa", [["Individual", 5200], ["Para dividir", 8200]], ["vegetariano", "com_lactose"], {}],
      ["diavola", "Diavola", "Salame picante, fior di latte, azeite de pimenta e orégano siciliano.", "pz-margherita", [["Individual", 5400], ["Para dividir", 8600]], ["apimentado", "com_gluten", "com_lactose"], {}],
    ] },
    { key: "dolci", name: "Dolci", cover: "sb-mousse", items: [
      ["caprese", "Torta caprese", "Chocolate amargo e amêndoas, sem farinha de trigo, com raspas de limão.", "sb-chocolate", 3400, ["sem_gluten", "com_amendoas", "com_ovo"], { featured: true }],
      ["tira", "Tiramisù na taça", "Mascarpone, café espresso, biscoito savoiardi e cacau.", "sb-mousse", 3200, ["com_gluten", "com_ovo", "com_lactose"], {}],
      ["coppa", "Coppa di frutti", "Gelato de baunilha, morangos e calda de frutas vermelhas.", "sb-sorvete", 2900, ["sem_gluten", "com_leite"], {}],
    ] },
    // Sem foto de categoria: a lista mostra a inicial.
    { key: "vinhos", name: "Vinhos", cover: null, items: [
      ["chianti", "Chianti Classico", "Tinto toscano de Sangiovese, com cereja e um leve toque de especiarias.", null, [["Taça", 3800], ["Garrafa", 21000]], [], { country: "IT", subgroup: "Tintos" }],
      ["malbec", "Malbec reserva", "Tinto encorpado de Mendoza, com ameixa e baunilha. Vai bem com a Diavola.", null, [["Taça", 3200], ["Garrafa", 18000]], [], { country: "AR", subgroup: "Tintos" }],
      ["vermentino", "Vermentino di Sardegna", "Branco leve e salino, com frutas cítricas. Ótimo com as massas de molho leve.", null, [["Taça", 3400], ["Garrafa", 19000]], [], { country: "IT", subgroup: "Brancos" }],
    ] },
  ],
  en: { cats: {}, items: {} },
};

// Restaurante incompleto de propósito: sem capa, logo, endereço, horário nem cor; categoria e pratos sem foto.
const SIMPLES = {
  slug: "casa-simples",
  name: "Casa Simples",
  brand_color: null,
  font_theme: "moderno",
  logo_path: null,
  cover_image_path: null,
  address: null,
  opening_hours: null,
  languages: ["pt-BR"],
  orders_enabled: false,
  table: null,
  cats: [
    { key: "pratos", name: "Pratos", cover: null, items: [
      ["pf", "Prato feito", "Arroz, feijão, bife e salada.", null, 2800, [], {}],
      ["chef", "Prato do chef", "Pergunte ao garçom o que saiu hoje.", null, 0, [], { hide: true }],
      ["suco", "Suco da casa", "Fruta da estação, sem açúcar.", null, 1200, [], { promo: 900 }],
    ] },
  ],
  en: { cats: {}, items: {} },
};

export const RESTAURANTS = { aurora: AURORA, nonna: NONNA, simples: SIMPLES };
export const restaurantUid = (slug) => seedUid(`restaurant:${slug}`);

const iso = (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * Linhas do seed (puro: sem rede nem disco). `columns` diz se as colunas novas existem no banco.
 * @param {{ now: Date; columns?: { subgroup?: boolean; doughs?: boolean }; userId?: string | null }} i
 */
export function buildSeed({ now, columns = { subgroup: true, doughs: true }, userId = null }) {
  /** @type {Record<"restaurants" | "categories" | "items" | "media" | "translations" | "tables" | "members", any[]>} */
  const out = { restaurants: [], categories: [], items: [], media: [], translations: [], tables: [], members: [] };
  const trial = iso(now.getTime() + 30 * 86_400_000);
  for (const def of Object.values(RESTAURANTS)) {
    const rid = restaurantUid(def.slug);
    out.restaurants.push({
      uid: rid,
      name: def.name,
      slug: def.slug,
      logo_path: def.logo_path,
      brand_color: def.brand_color,
      languages: def.languages,
      menu_version: 1,
      plan: "trial",
      subscription_status: "trial",
      trial_ends_at: trial,
      cover_video_path: null,
      cover_image_path: def.cover_image_path,
      font_theme: def.font_theme,
      timezone: "America/Sao_Paulo",
      opening_hours: def.opening_hours,
      show_hours: !!def.opening_hours,
      show_payments: false,
      orders_enabled: def.orders_enabled,
      description: "",
      address: def.address,
      created_at: iso(now.getTime()),
    });
    if (userId) out.members.push({ restaurant_id: rid, user_id: userId, role: "owner" });
    if (def.table) {
      out.tables.push({ uid: seedUid(`table:${def.slug}`), restaurant_id: rid, label: def.table.label, code: def.table.code, active: true, created_at: iso(now.getTime()) });
    }
    def.cats.forEach((c, ci) => {
      const cid = seedUid(`cat:${def.slug}:${c.key}`);
      const cat = {
        uid: cid,
        restaurant_id: rid,
        name: c.name,
        description: "",
        position: ci,
        active: true,
        available_from: c.from ?? null,
        available_to: c.to ?? null,
        half_half: !!c.half,
        special: !!c.special,
        created_at: iso(now.getTime()),
      };
      if (columns.doughs) cat.doughs = c.half ? DOUGHS : null;
      out.categories.push(cat);
      if (c.cover) out.media.push({ uid: seedUid(`media:${def.slug}:cat:${c.key}`), restaurant_id: rid, item_id: null, category_id: cid, kind: "photo", storage_path: photoPath(c.cover), position: 0, status: "ready", created_at: iso(now.getTime()) });
      const en = def.en.cats[c.key];
      if (en) out.translations.push({ uid: seedUid(`tr:${def.slug}:cat:${c.key}:en`), restaurant_id: rid, category_id: cid, item_id: null, language: "en", name: en, description: "", auto: false });
      c.items.forEach(([key, name, description, photo, price, tags, x], ii) => {
        const iid = seedUid(`item:${def.slug}:${key}`);
        const sizes = Array.isArray(price);
        const item = {
          uid: iid,
          restaurant_id: rid,
          category_id: cid,
          name,
          description,
          price_cents: sizes ? Math.min(...price.map((p) => p[1])) : price,
          promo_price_cents: x.promo ?? null,
          price_options: sizes ? price.map(([label, price_cents]) => ({ label, price_cents })) : null,
          tags,
          position: ii,
          active: x.active !== false,
          featured: !!x.featured,
          hide_price: !!x.hide,
          serves: x.serves ?? null,
          country: x.country ?? null,
          created_at: iso(now.getTime()),
        };
        if (x.special) Object.assign(item, { special_every_h: 2, special_show_s: 6, special_days: [0, 1, 2, 3, 4, 5, 6], special_from: "00:00", special_to: "23:59", special_limit: 1 });
        if (columns.subgroup) item.subgroup = x.subgroup ?? null;
        out.items.push(item);
        if (photo) out.media.push({ uid: seedUid(`media:${def.slug}:item:${key}`), restaurant_id: rid, item_id: iid, category_id: null, kind: "photo", storage_path: photoPath(photo), position: 0, status: "ready", created_at: iso(now.getTime()) });
        const t = def.en.items[key];
        if (t) out.translations.push({ uid: seedUid(`tr:${def.slug}:item:${key}:en`), restaurant_id: rid, category_id: null, item_id: iid, language: "en", name: t[0], description: t[1], auto: false });
      });
    });
  }
  return out;
}

// Tabelas filhas do restaurante, com a chave que o --desfazer usa para apagar (a ordem não importa).
const CHILD_TABLES = ["translations", "media", "items", "categories", "dining_tables", "members", "orders", "special_claims"];
const SEED_TABLES = { categories: "categories", items: "items", media: "media", translations: "translations", tables: "dining_tables" };

// ---------- rede ----------

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
    columns: async (t) => new Set((await api(`/api/v2/meta/tables/${tid(t)}`)).columns.map((c) => c.column_name)),
    list: async (t, w = {}) => {
      const out = [];
      for (let offset = 0; ; offset += 1000) {
        const q = where(w) ? `&where=${encodeURIComponent(where(w))}` : "";
        const r = await api(`/api/v2/tables/${tid(t)}/records?limit=1000&offset=${offset}${q}`);
        out.push(...r.list);
        if (r.pageInfo?.isLastPage !== false || !r.list.length) return out;
      }
    },
    patch: (t, rows) => api(`/api/v2/tables/${tid(t)}/records`, { method: "PATCH", body: JSON.stringify(rows.map(enc)) }),
    insert: (t, rows) => api(`/api/v2/tables/${tid(t)}/records`, { method: "POST", body: JSON.stringify(rows.map(enc)) }),
    remove: async (t, ids) => {
      for (let i = 0; i < ids.length; i += 100) {
        await api(`/api/v2/tables/${tid(t)}/records`, { method: "DELETE", body: JSON.stringify(ids.slice(i, i + 100).map((Id) => ({ Id }))) });
      }
    },
  };
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
  const db = await localNocodb(env, fetchImpl);
  const rids = SLUGS.map(restaurantUid);

  // Só mexe em restaurante que o seed criou (uid fixo); um slug igual com outro uid é de outra pessoa.
  const existing = new Map();
  for (const slug of SLUGS) {
    const [row] = await db.list("restaurants", { slug });
    if (row && row.uid !== restaurantUid(slug)) throw new Error(`O slug ${slug} já existe no banco local e não é do seed; nada foi alterado.`);
    if (row) existing.set(slug, row);
  }

  if (argv.includes("--desfazer")) {
    for (const rid of rids) {
      for (const t of CHILD_TABLES) {
        const rows = await db.list(t, { restaurant_id: rid });
        if (rows.length) {
          await db.remove(t, rows.map((r) => r.Id));
          log(`apagado: ${rows.length} em ${t}`);
        }
      }
    }
    for (const [slug, row] of existing) {
      await db.remove("restaurants", [row.Id]);
      log(`apagado: restaurante ${slug}`);
    }
    log("Dados de exemplo da lista removidos.");
    return { undone: true };
  }

  const itemCols = await db.columns("items");
  const catCols = await db.columns("categories");
  const columns = { subgroup: itemCols.has("subgroup"), doughs: catCols.has("doughs") };
  if (!columns.subgroup) log("AVISO: items.subgroup não existe; gravando sem subgrupos (rode scripts/nocodb/setup.mjs para criar a coluna).");
  if (!columns.doughs) log("AVISO: categories.doughs não existe; gravando sem massas (rode scripts/nocodb/setup.mjs para criar a coluna).");

  const [user] = await db.list("users", { email: TEST_USER_EMAIL });
  if (!user) log(`AVISO: usuário ${TEST_USER_EMAIL} não existe no banco local; os restaurantes ficam sem dono (o painel não os abre).`);
  const seed = buildSeed({ now: new Date(), columns, userId: user?.uid ?? null });

  const upsert = async (t, rows, key = (r) => ({ uid: r.uid })) => {
    let created = 0;
    for (const row of rows) {
      const [have] = await db.list(t, key(row));
      if (have) await db.patch(t, [{ ...row, Id: have.Id }]);
      else {
        await db.insert(t, [row]);
        created++;
      }
    }
    log(`${t}: ${created} criado(s), ${rows.length - created} atualizado(s)`);
  };
  await upsert("restaurants", seed.restaurants);
  await upsert("members", seed.members, (r) => ({ restaurant_id: r.restaurant_id, user_id: r.user_id }));
  for (const [k, table] of Object.entries(SEED_TABLES)) await upsert(table, seed[k]);

  // Tira o que saiu do seed (um prato renomeado, por exemplo), para rodar de novo nunca duplicar.
  for (const [k, table] of Object.entries(SEED_TABLES)) {
    const keep = new Set(seed[k].map((r) => r.uid));
    for (const rid of rids) {
      const stale = (await db.list(table, { restaurant_id: rid })).filter((r) => !keep.has(r.uid));
      if (stale.length) {
        await db.remove(table, stale.map((r) => r.Id));
        log(`removido do que saiu do seed: ${stale.length} em ${table}`);
      }
    }
  }
  log(`Prontos: ${SLUGS.join(", ")}. Mesa de teste: ?mesa=AURORA em forno-aurora.`);
  return { seed, columns };
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
