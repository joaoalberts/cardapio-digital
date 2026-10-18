// Cria (ou completa) a base "Cardápio Digital" no NocoDB com as mesmas tabelas do
// Supabase. Pode rodar de novo: só cria o que ainda não existe.
//
//   NOCODB_API_TOKEN=... node scripts/nocodb/setup.mjs
//   NocoDB local (Docker, sem workspace):
//   NOCODB_SELF_HOSTED=1 NOCODB_URL=http://localhost:8080 NOCODB_API_TOKEN=... node scripts/nocodb/setup.mjs
//
// Ids continuam sendo uuids em texto (coluna "uid"), e as ligações entre tabelas são
// colunas de texto com o uid do pai (restaurant_id, category_id...). Assim os dados do
// Supabase entram sem conversão e o isolamento por restaurante fica no código do app.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const API = process.env.NOCODB_URL ?? "https://app.nocodb.com";
const TOKEN = process.env.NOCODB_API_TOKEN;
const WORKSPACE = process.env.NOCODB_WORKSPACE ?? "wouavjse";
const BASE_TITLE = process.env.NOCODB_BASE_TITLE ?? "Cardápio Digital";

const text = (name) => ({ column_name: name, title: name, uidt: "SingleLineText" });
const long = (name) => ({ column_name: name, title: name, uidt: "LongText" });
const num = (name) => ({ column_name: name, title: name, uidt: "Number" });
const bool = (name) => ({ column_name: name, title: name, uidt: "Checkbox" });
const json = (name) => ({ column_name: name, title: name, uidt: "JSON" });
const date = (name) => ({ column_name: name, title: name, uidt: "DateTime" });

const id = text("uid");
const created = date("created_at");

export const TABLES = {
  users: [id, { ...text("email"), uidt: "Email" }, text("password_hash"), created],
  restaurants: [
    id, text("name"), text("slug"), text("logo_path"), text("brand_color"),
    json("languages"), num("menu_version"), text("plan"), text("subscription_status"),
    date("trial_ends_at"), text("cover_video_path"), text("cover_image_path"),
    text("font_theme"), text("timezone"), json("opening_hours"), long("description"),
    text("phone"), text("address"), text("instagram"), text("facebook"), text("wifi_name"),
    text("wifi_password"), json("payment_methods"), bool("show_hours"),
    bool("show_payments"), bool("orders_enabled"),
    // Modo simples do telão (vazio = desligado; a TV ainda liga sozinha se engasgar). O nome antigo fica
    // para as TVs já configuradas seguirem iguais.
    bool("community_tv_simple"),
    // Apareça na TV: apareca_allowed e apareca_ai_allowed são do João (super admin); apareca_enabled é do dono;
    // apareca_config guarda modo, regra, zonas, horário e retenção.
    bool("apareca_allowed"), bool("apareca_ai_allowed"), bool("apareca_enabled"), json("apareca_config"), created,
  ],
  members: [text("restaurant_id"), text("user_id"), text("role"), created],
  categories: [
    id, text("restaurant_id"), text("name"), long("description"), num("position"),
    bool("active"), text("available_from"), text("available_to"), bool("half_half"), bool("special"), created,
  ],
  items: [
    id, text("restaurant_id"), text("category_id"), text("name"), long("description"),
    num("price_cents"), num("promo_price_cents"), json("price_options"), json("tags"),
    num("position"), bool("active"), bool("featured"), bool("hide_price"), num("serves"),
    text("country"), num("special_every_h"), num("special_show_s"), json("special_days"),
    text("special_from"), text("special_to"), num("special_limit"), json("special_times"), created,
  ],
  media: [
    id, text("restaurant_id"), text("item_id"), text("category_id"), text("kind"),
    text("storage_path"), text("poster_path"), text("mux_asset_id"), text("mux_playback_id"),
    text("mux_upload_id"), text("mux_mp4"), num("position"), text("status"), created,
  ],
  translations: [
    id, text("restaurant_id"), text("category_id"), text("item_id"), text("language"),
    text("name"), long("description"), bool("auto"),
  ],
  dining_tables: [id, text("restaurant_id"), text("label"), text("code"), bool("active"), created],
  orders: [
    id, text("restaurant_id"), text("table_id"), text("table_label"), text("status"), bool("open"),
    json("lines"), num("total_cents"), text("device_id"), text("client_ref"), created, date("status_at"),
    // Envio repetido ou oferta perdida: fechado sem ser um pedido de verdade (fora do placar).
    bool("discarded"),
  ],
  // Cada oferta relâmpago pega: o preço garantido vale só com este registro.
  special_claims: [
    id, text("restaurant_id"), text("table_id"), text("device_id"), text("item_id"), text("item_name"),
    num("unit_cents"), num("qty_max"), date("expires_at"), text("order_id"), created,
  ],
  support_requests: [
    id, text("restaurant_id"), text("user_id"), text("subject"), text("whatsapp"),
    long("message"), created,
  ],
  // TVs do salão (telão). O telão guarda o segredo; aqui fica só o SHA-256 dele. O nome antigo da tabela
  // fica para as TVs já conectadas seguirem funcionando.
  community_tvs: [
    id, text("restaurant_id"), text("label"), text("pair_code"), date("pair_expires_at"), text("secret_hash"),
    date("paired_at"), date("last_seen_at"), bool("revoked"), created,
  ],
  // Apareça na TV: vídeo de 6 s do cliente. device_id, table_id, mux_upload_id e ai_reason nunca saem por rota
  // pública; mux_playback_id só sai com status = approved. A linha e o asset do Mux vencem em expires_at.
  apareca_videos: [
    id, text("restaurant_id"), text("kind"), text("table_id"), text("zone_id"), text("device_id"), text("name"),
    date("consent_at"), text("mux_upload_id"), text("mux_asset_id"), text("mux_playback_id"), num("duration_ms"),
    text("status"), text("decided_by"), date("decided_at"), long("ai_reason"), num("plays"), num("plays_target"),
    date("first_shown_at"), num("downloads"), date("expires_at"), created,
  ],
  // Apareça na TV: vídeos institucionais da casa (loop da TV). Não vencem; ficam até o dono apagar.
  apareca_house_videos: [
    id, text("restaurant_id"), text("title"), text("mux_upload_id"), text("mux_asset_id"), text("mux_playback_id"),
    num("duration_ms"), text("aspect"), num("position"), bool("active"), text("status"), created,
  ],
  // Apareça na TV: contagens por restaurante e dia (sem dado pessoal), gravadas antes de a linha do vídeo sumir.
  apareca_tally: [
    id, text("restaurant_id"), text("day"), text("month"), json("counts"), json("hours"), created,
  ],
};

async function api(path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { "xc-token": TOKEN, "content-type": "application/json", ...init.headers },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${body}`);
  return body ? JSON.parse(body) : null;
}

async function main() {
  if (!TOKEN) throw new Error("Falta NOCODB_API_TOKEN");
  // NOCODB_SELF_HOSTED=1: NocoDB local (Docker), sem workspaces.
  const selfHosted = process.env.NOCODB_SELF_HOSTED === "1";
  const basesPath = selfHosted ? "/api/v2/meta/bases/" : `/api/v2/meta/workspaces/${WORKSPACE}/bases`;
  const bases = await api(basesPath);
  let base = bases.list.find((b) => b.title === BASE_TITLE);
  if (!base) {
    base = await api(basesPath, { method: "POST", body: JSON.stringify({ title: BASE_TITLE }) });
    console.log(`base criada: ${base.id}`);
  } else {
    console.log(`base existente: ${base.id}`);
  }

  const tables = await api(`/api/v2/meta/bases/${base.id}/tables`);
  for (const [name, columns] of Object.entries(TABLES)) {
    let table = tables.list.find((t) => t.table_name === name || t.title === name);
    if (!table) {
      table = await api(`/api/v2/meta/bases/${base.id}/tables`, {
        method: "POST",
        body: JSON.stringify({ table_name: name, title: name, columns }),
      });
      console.log(`tabela criada: ${name} (${table.id})`);
      continue;
    }
    const meta = await api(`/api/v2/meta/tables/${table.id}`);
    const have = new Set(meta.columns.map((c) => c.column_name));
    for (const col of columns.filter((c) => !have.has(c.column_name))) {
      await api(`/api/v2/meta/tables/${table.id}/columns`, {
        method: "POST",
        body: JSON.stringify(col),
      });
      console.log(`coluna criada: ${name}.${col.column_name}`);
    }
    console.log(`tabela ok: ${name} (${table.id})`);
  }
}

// Só roda quando chamado direto (node scripts/nocodb/setup.mjs); importado pelos testes, não.
// Comparar import.meta.url com `file://${argv[1]}` não serve aqui: o "á" e o espaço de
// "Cardápio Digital" vêm codificados na URL.
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
