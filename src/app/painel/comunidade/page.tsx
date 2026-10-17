import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import * as db from "@/lib/db/nocodb";
import { localTime, questionText, relativeTime } from "@/lib/comunidade/client-logic";
import { communityDay, dayBounds, pollPhase } from "@/lib/comunidade/clock";
import { communityOff } from "@/lib/comunidade/off";
import { goalNights, goalsCut, salesGoals, scoreboard } from "@/lib/comunidade/scoreboard";
import type { PollRow, TallyRow } from "@/lib/comunidade/types";
import { toContent, toHead } from "@/lib/comunidade/votes";
import { getPublicMenu } from "@/lib/menu/data";
import { mediaUrl, thumbSrc } from "@/lib/menu/media";
import type { MenuItem } from "@/lib/menu/types";
import type { OrderRow } from "@/lib/orders/service";
import { currentRestaurant } from "../current";
import { PanelShell } from "../shell";
import { ComunidadeEditor, type EditorData, type EditorPoll } from "./comunidade-editor";
import "../panel.css";
import "../cardapio/cardapio.css";
import "./comunidade.css";

export const metadata: Metadata = { title: "Comunidade" };

// Pedidos e linhas do funil lidos para o placar e as metas (8 semanas: as 4 do acumulado e as
// 4 de comparação), dos mais novos aos mais velhos, numa leitura só e com teto: o filtro do
// NocoDB aqui só faz igualdade, então o recorte por data é em memória. Filtrar o funil por
// day seria uma consulta por dia (56 ou mais chamadas por abertura do painel), por isso não.
// Acima do teto, as semanas mais antigas contam menos e o painel avisa (goalsCut).
const ORDERS_READ = 5000;
const TALLY_READ = 5000;
const POSTS_READ = 100;

export default function ComunidadePage() {
  return (
    <div className="ap">
      <Suspense fallback={<div className="ap-loading" />}>
        <Comunidade />
      </Suspense>
    </div>
  );
}

type Raw = Record<string, unknown>;
// O NocoDB devolve "AAAA-MM-DD HH:MM:SS+00:00"; o T no lugar do espaço vale em qualquer motor.
const isoOf = (v: unknown) => {
  const t = typeof v === "string" && v.trim() ? Date.parse(v.trim().replace(" ", "T")) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

async function Comunidade() {
  const { restaurant, isOwner } = await currentRestaurant();
  const r = restaurant as typeof restaurant & { logo_path: string | null; instagram: string | null };
  const head = toHead(r)!;
  const tz = head.timezone;
  const now = new Date();
  const day = communityDay(now, tz, head.day_start);
  const bounds = dayBounds(day, tz, head.day_start);

  const mine = { restaurant_id: r.id };
  const [pollRows, postRows, tvRows, orders, tallies, menu, h] = await Promise.all([
    db.list<Raw>("community_polls", mine, { sort: "-Id", limit: 200 }),
    db.list<Raw>("community_posts", mine, { sort: "-Id", limit: POSTS_READ }),
    db.list<Raw>("community_tvs", mine),
    db.list<OrderRow>("orders", mine, { sort: "-Id", limit: ORDERS_READ }),
    db.list<TallyRow>("community_tally", mine, { sort: "-Id", limit: TALLY_READ }),
    getPublicMenu(r.slug),
    headers(),
  ]);

  // Pratos do cardápio (o mesmo que o cliente vê), para as opções e as fotos da casa.
  const items = new Map<string, MenuItem>();
  const categories = (menu?.categories ?? []).map((c) => ({
    name: c.name,
    items: c.items.filter((i) => !i.special).map((i) => {
      items.set(i.id, i);
      return { id: i.id, name: i.name, thumb: thumbSrc(i) };
    }),
  })).filter((c) => c.items.length);

  // Miniatura mais nova de foto da casa (aprovada) por prato, para a linha da enquete.
  const houseThumb = new Map<string, string>();
  for (const p of postRows) {
    const item = str(p.item_id);
    const thumb = str(p.thumb_path);
    if (item && thumb && p.status === "approved" && !houseThumb.has(item)) houseThumb.set(item, mediaUrl(thumb) ?? thumb);
  }

  // Enquetes: as que terminaram nas últimas 24 h e as futuras, já no formato da Comunidade.
  const polls = toContent({ polls: pollRows, posts: [], tvs: [] }, now).polls;
  const today = communityDay(now, tz, "00:00");
  const when = (iso: string) => {
    const d = communityDay(new Date(iso), tz, "00:00");
    const label = d === today ? "hoje" : d > today ? "amanhã" : "ontem";
    return `${label}, ${localTime(iso, tz, "pt-BR")}`;
  };
  const endOf = (p: PollRow) => Math.min(Date.parse(p.ends_at), p.closed_at ? Date.parse(p.closed_at) : Infinity);
  const toEditor = (p: PollRow, phase: EditorPoll["phase"]): EditorPoll => {
    const minutes = Math.round((Date.parse(p.ends_at) - Date.parse(p.starts_at)) / 60_000);
    const dishes = p.options.map((o) => (o.item_id ? items.get(o.item_id) : undefined));
    const names = p.options.map((o, k) => dishes[k]?.name ?? (o.label || "prato fora do cardápio"));
    // Ficha v2 (print 38): "hoje, 20h30 · 1 h · 3 pratos". No ar e encerrada dizem a hora do fim.
    const length = minutes % 60 === 0 ? `${minutes / 60} h` : minutes > 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
    const tail =
      phase === "open"
        ? `fecha às ${localTime(p.ends_at, tz, "pt-BR")}`
        : phase === "closed"
          ? `encerrou às ${localTime(new Date(endOf(p)).toISOString(), tz, "pt-BR")}`
          : length;
    const n = p.options.length;
    const kind = dishes.every(Boolean) ? plural(n, "prato", "pratos") : plural(n, "opção", "opções");
    // Foto do primeiro prato da enquete (a do cardápio; sem ela, a última foto da casa daquele
    // prato); sem foto nenhuma (música, texto livre), o emoji do modelo.
    const thumb = p.options.map((o) => (o.item_id ? (thumbSrc(items.get(o.item_id)) ?? houseThumb.get(o.item_id)) : null)).find(Boolean) ?? null;
    return {
      id: p.id,
      template: p.template,
      question: questionText(p, "pt-BR"),
      meta: `${when(p.starts_at)} · ${tail} · ${n} ${kind}`,
      options: names.join(" · "),
      thumb,
      phase,
    };
  };
  const open = polls.filter((p) => pollPhase(p, now) === "open").sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const scheduled = polls.filter((p) => pollPhase(p, now) === "scheduled").sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const closed = polls
    .filter((p) => pollPhase(p, now) === "closed" && endOf(p) > Date.parse(p.starts_at) && endOf(p) >= bounds.from.getTime())
    .sort((a, b) => endOf(b) - endOf(a));
  // Enquetes que abriram no dia da Comunidade (para "a noite em números").
  const pollsToday = polls.filter((p) => {
    const s = Date.parse(p.starts_at);
    return s >= bounds.from.getTime() && s <= now.getTime() && endOf(p) > s;
  }).length;

  // Fotos da casa: aprovadas e ocultas (as ocultas só com "Apagar").
  const posts: EditorData["posts"] = postRows.flatMap((p) => {
    const id = str(p.id);
    const thumb = str(p.thumb_path);
    const created = isoOf(p.created_at);
    if (!id || !thumb || (p.status !== "approved" && p.status !== "hidden")) return [];
    const item = str(p.item_id);
    return [
      {
        id,
        thumb: mediaUrl(thumb) ?? thumb,
        dish: (item && items.get(item)?.name) || "prato fora do cardápio",
        when: created ? relativeTime(created, now, "pt-BR") : "",
        onTv: p.on_tv === true,
        hidden: p.status === "hidden",
      },
    ];
  });

  // Telões pareados e não desconectados. O hash do segredo nunca sai daqui.
  const tvs: EditorData["tvs"] = tvRows
    .flatMap((t) => {
      const id = str(t.id);
      const paired = isoOf(t.paired_at);
      if (!id || !paired || t.revoked === true) return [];
      const seen = isoOf(t.last_seen_at);
      return [{ id, label: str(t.label) ?? "TV", paired, seen: seen ? `vista ${relativeTime(seen, now, "pt-BR")}` : "ainda não conferiu" }];
    })
    .sort((a, b) => Date.parse(b.paired) - Date.parse(a.paired))
    .map(({ id, label, seen }) => ({ id, label, seen }));

  const score = scoreboard(orders, tallies.filter((t) => t.day === day), bounds);
  // Metas (Decisão do João, 16/10): a noite contra os 4 mesmos dias da semana anteriores e
  // as 4 semanas contra as 4 de antes.
  const nights = goalNights(day, tz, head.day_start);
  const goals = salesGoals(orders, tallies, nights);
  const cut = goalsCut({ orders, ordersCap: ORDERS_READ, tallies, tallyCap: TALLY_READ }, nights);
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  const data: EditorData = {
    restaurantId: r.id,
    isOwner,
    off: communityOff(),
    enabled: head.enabled,
    instagram: head.instagram,
    dayStart: head.day_start,
    dayStartText: `${localTime(bounds.from.toISOString(), tz, "pt-BR")} de ${day.slice(8, 10)}/${day.slice(5, 7)}`,
    tvUrl: host ? `${proto}://${host}/${r.slug}/telao` : `/${r.slug}/telao`,
    tvSimple: head.tv_simple,
    categories,
    polls: {
      open: open.map((p) => toEditor(p, "open")),
      scheduled: scheduled.map((p) => toEditor(p, "scheduled")),
      closed: closed.map((p) => toEditor(p, "closed")),
    },
    posts,
    tvs,
    score: { ...score, polls: pollsToday },
    goals,
    goalsFrom: cut ? `${cut.slice(8, 10)}/${cut.slice(5, 7)}` : null,
  };

  return (
    <PanelShell restaurant={{ id: r.id, name: r.name, slug: r.slug, logo: mediaUrl(r.logo_path) }} active="/painel/comunidade" title="Comunidade">
      <ComunidadeEditor data={data} />
    </PanelShell>
  );
}
