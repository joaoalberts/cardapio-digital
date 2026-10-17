"use client";
/* eslint-disable @next/next/no-img-element -- miniaturas pequenas, já em tamanho certo (mesmo motivo do cardápio) */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useOptimistic, useState, useTransition } from "react";
import type { Goals } from "@/lib/comunidade/scoreboard";
import type { FunnelKey, PollTemplate } from "@/lib/comunidade/types";
import { money } from "../cardapio/modals";
import {
  closePoll,
  deletePoll,
  deletePost,
  hidePost,
  pairTv,
  revokeTv,
  setCommunityEnabled,
  setDayStart,
  setPostTv,
  setTvSimple,
} from "./actions";
import { Confirm } from "./confirm";
import { HousePhotoSend } from "./house-photo";
import { NewPoll } from "./poll-maker";
import { ICONS, Icon, TPL } from "./shared";

// Seção "Comunidade" do painel: interruptor, Instagram e hora do dia, enquetes por modelo,
// fotos da casa no Mural, pareamento do telão e o placar do dia com as metas. Visual dos
// prints 38 e 39 da ficha v2 (docs/prototipos/comunidade-v2/recomendada), no molde do painel (cartões brancos, botões dourados). As regras e as
// mensagens estão em validate.ts; o servidor confere tudo de novo ao gravar.

export type EditorPoll = {
  id: string;
  template: PollTemplate;
  question: string;
  meta: string;
  options: string;
  thumb: string | null;
  phase: "open" | "scheduled" | "closed";
};
type Dish = { id: string; name: string; thumb: string | null };
export type EditorData = {
  restaurantId: string;
  isOwner: boolean;
  off: boolean;
  enabled: boolean;
  instagram: string | null;
  dayStart: string;
  dayStartText: string;
  tvUrl: string;
  tvSimple: boolean;
  categories: { name: string; items: Dish[] }[];
  polls: { open: EditorPoll[]; scheduled: EditorPoll[]; closed: EditorPoll[] };
  posts: { id: string; thumb: string; dish: string; when: string; onTv: boolean; hidden: boolean }[];
  tvs: { id: string; label: string; seen: string }[];
  score: { orders: number; lines: number; cents: number; funnel: Record<FunnelKey, number>; tables: { qr: number; open: number; pct: number }; polls: number };
  goals: { night: Goals; month: Goals };
  // Primeira noite contada inteira quando o teto de leitura cortou o período ("DD/MM"); senão null.
  goalsFrom: string | null;
};

type Res = { error?: string };

const brl = (c: number) => `R$ ${money(c)}`;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function ComunidadeEditor({ data }: { data: EditorData }) {
  const router = useRouter();
  // Cada aviso é um objeto novo: o mesmo texto duas vezes seguidas reinicia o prazo.
  const [toast, setToast] = useState<{ msg: string } | null>(null);

  const flash = (msg: string) => setToast({ msg });
  // O prazo do aviso conta de quando ele aparece: um aviso que espera o refresh não some antes.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  // Deu certo: pede os dados novos e avisa junto. Chamado dentro da transição de quem pediu,
  // o aviso, o fim do "pendente" e o estado otimista saem na mesma pintura em que os dados
  // novos chegam, e não quando a action responde (no NocoDB da nuvem o refresh leva segundos).
  const saved = (ok: string) =>
    startTransition(() => {
      flash(ok);
      router.refresh();
    });
  // Roda uma action. Quem chama faz isso dentro de startTransition (com useOptimistic ou o
  // isPending de useTransition), para o controle ficar no valor novo até o refresh chegar.
  const run = async (fn: () => Promise<Res>, ok: string): Promise<boolean> => {
    const res = await fn().catch(() => ({ error: "Não foi possível salvar. Tente de novo." }));
    if (res.error) {
      flash(res.error);
      return false;
    }
    saved(ok);
    return true;
  };

  return (
    <div className="cp">
      {data.off && (
        <p className="cp-off" role="status">
          A Comunidade está desligada no sistema todo agora. Nenhum cliente vê o balão, a camada ou o telão, mesmo com o interruptor ligado aqui.
        </p>
      )}
      <MainCard data={data} run={run} />
      <PollsCard data={data} run={run} flash={flash} />
      <PostsCard data={data} run={run} flash={flash} />
      <TvCard data={data} run={run} />
      <ScoreCard data={data} />
      {toast && (
        <div className="ap-toast" role="status">
          {toast.msg}
        </div>
      )}
    </div>
  );
}

type Run = (fn: () => Promise<Res>, ok: string) => Promise<boolean>;

// ---------- Interruptor, Instagram e hora do dia ----------

function MainCard({ data, run }: { data: EditorData; run: Run }) {
  // O interruptor fica no valor novo até o refresh trazer data.enabled; se a action falhar,
  // volta sozinho ao valor do banco.
  const [on, setOn] = useOptimistic(data.enabled);
  const [busy, startToggle] = useTransition();
  const [saving, startSave] = useTransition();
  const [dayStart, setDay] = useState(data.dayStart);

  const toggle = () =>
    startToggle(async () => {
      const next = !on;
      setOn(next);
      await run(() => setCommunityEnabled(data.restaurantId, next), next ? "Comunidade ligada." : "Comunidade desligada.");
    });

  return (
    <section className="ap-card">
      <div className="ap-card-head">
        <h2>Comunidade</h2>
        <Icon d={ICONS.chat} />
      </div>
      <div className="cp-sw-row">
        <div>
          <b id="cp-sw-l">Comunidade ligada</b>
          <small>{on ? "Ligada: o balão aparece na capa para quem leu o QR da mesa." : "Desligada: ninguém vê o balão na capa."}</small>
        </div>
        <button className="cp-sw" role="switch" aria-checked={on} aria-labelledby="cp-sw-l" disabled={!data.isOwner || busy} onClick={toggle}>
          <i />
        </button>
      </div>
      {!data.isOwner && <p className="cp-note">Só o dono do restaurante liga ou desliga a Comunidade.</p>}
      <p className="cp-lead">Enquetes da casa e mural de pratos para quem está no salão. Só vota quem leu o QR da mesa.</p>

      <div className="cp-fld">
        <span>Instagram da casa</span>
        {data.instagram ? (
          <span className="cp-in ro">
            <em>@</em>
            {data.instagram}
          </span>
        ) : (
          <span className="cp-warn">Sem Instagram cadastrado: o telão e a arte dos stories ficam sem o @ da casa.</span>
        )}
        <small>
          Aparece no telão e na arte dos stories. <Link href="/painel/perfil">{data.instagram ? "Mudar no Perfil" : "Cadastrar no Perfil"}</Link>
        </small>
      </div>

      <div className="cp-fld">
        <span>O dia da Comunidade vira às</span>
        <div className="cp-row">
          <span className="cp-in">
            <input type="time" value={dayStart} onChange={(e) => setDay(e.target.value)} aria-label="Hora em que o dia da Comunidade vira" />
          </span>
          <button
            className="btn outline"
            disabled={saving || dayStart === data.dayStart || !dayStart}
            onClick={() =>
              startSave(async () => {
                await run(() => setDayStart(data.restaurantId, dayStart), "Hora do dia salva.");
              })
            }
          >
            Salvar
          </button>
        </div>
        <small>O placar e as enquetes de hoje contam a partir dessa hora. O dia de hoje começou às {data.dayStartText}.</small>
      </div>
    </section>
  );
}

// ---------- Enquetes ----------

function PollsCard({ data, run, flash }: { data: EditorData; run: Run; flash: (msg: string) => void }) {
  const { open, scheduled, closed } = data.polls;
  const none = !open.length && !scheduled.length && !closed.length;

  return (
    <section className="ap-card">
      <div className="ap-card-head">
        <h2>Enquetes</h2>
        <Icon d={ICONS.clock} />
      </div>
      <PollGroup title="Agora" polls={open} restaurantId={data.restaurantId} run={run} />
      <PollGroup title="Agendadas" polls={scheduled} restaurantId={data.restaurantId} run={run} />
      <PollGroup title="Encerradas hoje" polls={closed} restaurantId={data.restaurantId} run={run} />
      {none && <p className="cp-empty">Nenhuma enquete hoje. Comece de um modelo: em menos de um minuto ela vai ao ar.</p>}

      <NewPoll data={data} onCreated={() => flash("Enquete criada.")} />
    </section>
  );
}

function PollGroup({ title, polls, restaurantId, run }: { title: string; polls: EditorPoll[]; restaurantId: string; run: Run }) {
  if (!polls.length) return null;
  return (
    <div className="cp-group">
      <h3>{title}</h3>
      <ul className="cp-plist">
        {polls.map((p) => (
          <li key={p.id} className={`cp-prow ${p.phase}`}>
            <span className="cp-pe" aria-hidden>
              {p.thumb ? <img src={p.thumb} alt="" /> : TPL[p.template].emoji}
            </span>
            <span className="cp-pt" title={p.options}>
              <b>{p.question}</b>
              <small>{p.meta}</small>
            </span>
            <span className={`cp-tag ${p.phase}`}>{p.phase === "open" ? "no ar" : p.phase === "scheduled" ? "agendada" : "encerrada"}</span>
            {p.phase === "open" && (
              <Confirm label="Encerrar agora" ask="Encerrar a enquete agora?" yes="Sim, encerrar" onYes={() => run(() => closePoll(restaurantId, p.id), "Enquete encerrada.")} />
            )}
            {p.phase === "scheduled" && (
              <Confirm label="Apagar" ask="Apagar esta enquete?" yes="Sim, apagar" onYes={() => run(() => deletePoll(restaurantId, p.id), "Enquete apagada.")} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}



// ---------- Fotos da casa ----------

type PostPatch = { id: string; onTv?: boolean; hidden?: boolean };

function PostsCard({ data, run, flash }: { data: EditorData; run: Run; flash: (msg: string) => void }) {
  const rid = data.restaurantId;
  // "No telão" e "Ocultar" mudam a linha na hora e ficam assim até o refresh trazer o banco.
  const [posts, patchPost] = useOptimistic(data.posts, (list, p: PostPatch) => list.map((x) => (x.id === p.id ? { ...x, ...p } : x)));
  const [, startPost] = useTransition();
  const patch = (p: PostPatch, fn: () => Promise<Res>, ok: string) =>
    startPost(async () => {
      patchPost(p);
      await run(fn, ok);
    });


  return (
    <section className="ap-card">
      <div className="ap-card-head">
        <h2>Fotos da casa no Mural</h2>
        <Icon d={ICONS.camera} />
      </div>
      <p className="cp-lead">Fotos dos pratos tiradas pela casa. Aparecem no Mural para quem está no salão, com &quot;Pedir também&quot;.</p>

      <HousePhotoSend data={data} onSent={() => flash("Foto publicada no Mural.")} />

      {posts.length ? (
        <ul className="cp-posts">
          {posts.map((p) => (
            <li key={p.id} className={p.hidden ? "hidden" : undefined}>
              <img src={p.thumb} alt="" loading="lazy" />
              <b>{p.dish}</b>
              <small>
                {p.hidden ? "oculta · fora do Mural" : p.when}
              </small>
              {!p.hidden && (
                <label className="cp-check sm">
                  <input
                    type="checkbox"
                    checked={p.onTv}
                    onChange={(e) => {
                      const on = e.target.checked;
                      patch({ id: p.id, onTv: on }, () => setPostTv(rid, p.id, on), on ? "Foto liberada para o telão." : "Foto fora do telão.");
                    }}
                  />
                  <span>no telão</span>
                </label>
              )}
              <span className="cp-post-acts">
                {!p.hidden && (
                  <button className="cp-link" onClick={() => patch({ id: p.id, hidden: true }, () => hidePost(rid, p.id), "Foto ocultada.")}>
                    Ocultar
                  </button>
                )}
                <Confirm label="Apagar" ask="Apagar a foto?" yes="Sim" onYes={() => run(() => deletePost(rid, p.id), "Foto apagada.")} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="cp-empty">Nenhuma foto ainda. Sem fotos, o Mural mostra o destaque da casa.</p>
      )}
    </section>
  );
}

// ---------- Telão ----------

function TvCard({ data, run }: { data: EditorData; run: Run }) {
  const [code, setCode] = useState("");
  const [busy, startPair] = useTransition();
  // Mesmo molde do interruptor da Comunidade: valor novo até o refresh; falhou, volta sozinho.
  const [simple, setSimple] = useOptimistic(data.tvSimple);
  const [simpleBusy, startSimple] = useTransition();
  const toggleSimple = () =>
    startSimple(async () => {
      const next = !simple;
      setSimple(next);
      await run(() => setTvSimple(data.restaurantId, next), next ? "Modo simples ligado." : "Modo simples desligado.");
    });
  const [ok, setOk] = useState<string | null>(null);
  const labels = new Set(data.tvs.map((t) => t.label));
  let label = "TV do salão";
  for (let n = 2; labels.has(label); n++) label = `TV do salão ${n}`;
  const clean = code.replace(/\s+/g, "");

  // "Pareando…" até a TV aparecer na lista; o "pareada agora" sai junto com ela.
  const pair = () => {
    setOk(null);
    const name = label;
    startPair(async () => {
      if (await run(() => pairTv(data.restaurantId, clean, name), `${name} pareada.`))
        startTransition(() => {
          setOk(name);
          setCode("");
        });
    });
  };

  return (
    <section className="ap-card">
      <div className="ap-card-head">
        <h2>Telão</h2>
        <Icon d={ICONS.tv} />
      </div>
      <p className="cp-lead">
        Na TV do salão, abra o endereço do cardápio com /telao no final. A TV mostra um código de 6 caracteres: digite aqui e aperte Parear.
        <a className="cp-url" href={data.tvUrl} target="_blank" rel="noreferrer">
          {data.tvUrl.replace(/^https?:\/\//, "")}
        </a>
      </p>
      <div className="cp-fld">
        <span>Código da TV</span>
        <div className="cp-row">
          <span className="cp-in cp-code">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && clean.length === 6 && !busy && pair()}
              maxLength={7}
              placeholder="ex.: K7M2Q9"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-label="Código da TV"
            />
          </span>
          <button className="btn primary" disabled={clean.length !== 6 || busy} onClick={pair}>
            {busy ? "Pareando…" : "Parear"}
          </button>
        </div>
      </div>
      {ok && <p className="cp-pairok">✓ {ok} pareada agora</p>}
      <div className={`cp-tvs${data.tvs.length ? " has" : ""}`}>
        <span>TVs pareadas</span>
        {data.tvs.length ? (
          <ul>
            {data.tvs.map((t) => (
              <li key={t.id}>
                <span>
                  <b>{t.label}</b>
                  <small>{t.seen}</small>
                </span>
                <Confirm label="Desconectar" ask="Desconectar esta TV?" yes="Sim" onYes={() => run(() => revokeTv(data.restaurantId, t.id), "TV desconectada.")} />
              </li>
            ))}
          </ul>
        ) : (
          <b>nenhuma ainda</b>
        )}
      </div>
      <div className="cp-sw-row cp-sw-last">
        <div>
          <b id="cp-simple-l">Modo simples</b>
          <small>Para TV mais antiga: sem animação. Liga sozinho se a TV engasgar.</small>
        </div>
        <button className="cp-sw" role="switch" aria-checked={simple} aria-labelledby="cp-simple-l" disabled={simpleBusy} onClick={toggleSimple}>
          <i />
        </button>
      </div>
    </section>
  );
}

// ---------- Placar do dia ----------

function ScoreCard({ data }: { data: EditorData }) {
  const s = data.score;
  const f = s.funnel;
  const steps = [
    { n: f.balloon_seen, t: "viram o balão na capa" },
    { n: f.open, t: "abriram a Comunidade" },
    { n: f.vote, t: "votaram" },
    { n: f.buy_tap, t: "tocaram em Pedir também" },
    { n: s.lines, t: plural(s.lines, "linha pedida", "linhas pedidas") },
  ];
  const top = Math.max(1, ...steps.map((x) => x.n));
  return (
    <section className="ap-card">
      <div className="ap-card-head">
        <h2>Hoje na Comunidade</h2>
        <Icon d={ICONS.chart} />
      </div>
      <div className="cp-score">
        <b>{s.orders}</b>
        <span>
          {plural(s.orders, "pedido saiu", "pedidos saíram")}
          <br />
          da Comunidade
        </span>
      </div>
      <p className="cp-score-sub">
        <b>{brl(s.cents)}</b> em pedidos com &quot;Pedir também&quot;
      </p>

      <Goals goals={data.goals} from={data.goalsFrom} />

      <p className="cp-tiles-h">A noite em números</p>
      <div className="cp-tiles">
        <div>
          <b>{s.tables.pct}%</b>
          <span>
            das mesas que leram o QR abriram a Comunidade ({s.tables.open} de {s.tables.qr})
          </span>
        </div>
        <div>
          <b>{f.buy_tap}</b>
          <span>{plural(f.buy_tap, "toque em Pedir também", "toques em Pedir também")}</span>
        </div>
        <div>
          <b>{s.polls}</b>
          <span>{plural(s.polls, "enquete hoje", "enquetes hoje")}</span>
        </div>
        <div>
          <b>{f.vote}</b>
          <span>{plural(f.vote, "voto", "votos")}</span>
        </div>
        <div>
          <b>{f.share}</b>
          <span>{plural(f.share, "compartilhamento no story", "compartilhamentos no story")}</span>
        </div>
        <div>
          <b>{f.ref_story + f.ref_telao}</b>
          <span>
            {plural(f.ref_story + f.ref_telao, "chegada", "chegadas")} pelo story ({f.ref_story}) e pelo QR do telão ({f.ref_telao})
          </span>
        </div>
      </div>

      <p className="cp-tiles-h">O caminho de hoje</p>
      <ol className="cp-funnel">
        {steps.map((x) => (
          <li key={x.t}>
            <b>{x.n}</b>
            <span>{x.t}</span>
            <i aria-hidden style={{ transform: `scaleX(${x.n / top})` }} />
          </li>
        ))}
      </ol>
      <p className="cp-note">Conta a partir das {data.dayStartText}. O funil chega em lotes, com até 1 minuto de atraso.</p>
    </section>
  );
}

// ---------- Metas: vender mais e mais interação ----------

const pctText = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${pctText(Math.abs(n))}`;
const dec = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

type GoalRow = { key: string; name: string; goal: string; cell: (g: Goals) => { value: string; hint: string; hit: boolean | null } };
const GOAL_ROWS: GoalRow[] = [
  {
    key: "share",
    name: "Itens pedidos que saíram da Comunidade",
    goal: "meta 5%",
    cell: (g) => ({ value: g.share.pct === null ? "—" : pctText(g.share.pct), hint: "das linhas pedidas pelo QR", hit: g.share.hit }),
  },
  {
    key: "ticket",
    name: "Ticket por mesa",
    goal: "meta +5%",
    cell: (g) => ({
      value: g.ticket.cents === null ? "—" : brl(Math.round(g.ticket.cents)),
      hint:
        g.ticket.delta === null
          ? "sem base para comparar"
          : `${signed(g.ticket.delta)} sobre ${brl(Math.round(g.ticket.baseline ?? 0))}`,
      hit: g.ticket.hit,
    }),
  },
  {
    key: "interactions",
    name: "Interações por mesa",
    goal: "meta 1,5",
    cell: (g) => ({ value: g.interactions.perTable === null ? "—" : dec(g.interactions.perTable), hint: "votos, Pedir também e stories por mesa que leu o QR", hit: g.interactions.hit }),
  },
];

function Mark({ hit }: { hit: boolean | null }) {
  if (hit === null) return <em className="cp-goal-mark none">sem dados</em>;
  return <em className={`cp-goal-mark ${hit ? "hit" : "miss"}`}>{hit ? "✓ atingiu" : "não atingiu"}</em>;
}

function Goals({ goals, from }: { goals: EditorData["goals"]; from: string | null }) {
  return (
    <div className="cp-goals">
      <p className="cp-tiles-h">Metas</p>
      <ul>
        {GOAL_ROWS.map((r) => {
          const night = r.cell(goals.night);
          const month = r.cell(goals.month);
          return (
            <li key={r.key}>
              <div className="cp-goal-h">
                <b>{r.name}</b>
                <small>{r.goal}</small>
              </div>
              <div className="cp-goal-cols">
                <div>
                  <span>Hoje</span>
                  <strong>{night.value}</strong>
                  <small>{night.hint}</small>
                  <Mark hit={night.hit} />
                </div>
                <div>
                  <span>4 semanas</span>
                  <strong>{month.value}</strong>
                  <small>{month.hint}</small>
                  <Mark hit={month.hit} />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="cp-note">
        O ticket de hoje é comparado com o mesmo dia da semana nas 4 semanas anteriores; o de 4 semanas, com as 4 semanas de antes.
      </p>
      {from && (
        <p className="cp-note">
          Período cortado: o painel lê no máximo 5.000 pedidos e 5.000 registros do funil, então as metas só contam inteiras a partir de {from}.
        </p>
      )}
    </div>
  );
}
