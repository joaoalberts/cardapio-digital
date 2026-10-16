"use client";
/* eslint-disable @next/next/no-img-element -- miniaturas pequenas, já em tamanho certo (mesmo motivo do cardápio) */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import type { FunnelKey, PollTemplate } from "@/lib/comunidade/types";
import { extOf, IMAGE_TYPES, shrinkImage } from "@/lib/images/shrink";
import { uploadFile } from "@/lib/upload-client";
import { uuid } from "@/lib/uuid";
import { Modal, money } from "../cardapio/modals";
import { discardFiles } from "../files-actions";
import {
  addHousePost,
  closePoll,
  createPoll,
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
import { LABEL_MAX, POLL_MINUTES, QUESTION_MAX, TEMPLATES, suggestOptions, templateQuestion, type PollMinutes } from "./validate";

// Seção "Comunidade" do painel: interruptor, Instagram e hora do dia, enquetes por modelo,
// fotos da casa no Mural, pareamento do telão e o placar do dia. Visual das telas 21 e 22
// do protótipo, no molde do painel (cartões brancos, botões dourados). As regras e as
// mensagens estão em validate.ts; o servidor confere tudo de novo ao gravar.

export type EditorPoll = {
  id: string;
  template: PollTemplate;
  question: string;
  meta: string;
  options: string;
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
};

type Res = { error?: string };

const TPL: Record<PollTemplate, { emoji: string; name: string }> = {
  dessert: { emoji: "🍰", name: "Sobremesa" },
  drink: { emoji: "🍹", name: "Bebida" },
  music: { emoji: "🎵", name: "Música" },
  custom: { emoji: "💬", name: "Personalizada" },
};

const ICONS = {
  chat: "M21 12a8 8 0 01-11.6 7.1L4 20l1-4.3A8 8 0 1121 12z",
  clock: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 100-8 4 4 0 000 8z",
  tv: "M5 5h14a2.5 2.5 0 012.5 2.5v7A2.5 2.5 0 0119 17H5a2.5 2.5 0 01-2.5-2.5v-7A2.5 2.5 0 015 5zM8 21h8M12 17v4",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  plus: "M12 5v14M5 12h14",
};
function Icon({ d }: { d: string }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden>
      <path d={d} />
    </svg>
  );
}

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
      <PollsCard data={data} run={run} saved={saved} />
      <PostsCard data={data} run={run} saved={saved} />
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
type Saved = (ok: string) => void;

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
      <p className="cp-lead">Enquetes da casa e mural de pratos para quem está no salão. Só aparece para quem leu o QR da mesa.</p>

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

function PollsCard({ data, run, saved }: { data: EditorData; run: Run; saved: Saved }) {
  const [models, setModels] = useState(false);
  const [form, setForm] = useState<PollTemplate | null>(null);
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

      <button className="btn primary cp-new" aria-expanded={models} onClick={() => setModels((v) => !v)}>
        <Icon d={ICONS.plus} />
        Nova enquete
      </button>
      {models && (
        <div className="cp-models">
          <span>Comece de um modelo</span>
          {TEMPLATES.map((t) => (
            <button key={t} onClick={() => setForm(t)}>
              <em aria-hidden>{TPL[t].emoji}</em>
              <span>
                <b>{TPL[t].name}</b>
                <small>{t === "custom" ? "Escreva a sua pergunta" : templateQuestion(t)}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      {form && (
        <PollModal
          template={form}
          data={data}
          onClose={(created) => {
            // Criada: chamado dentro da transição do modal, que fica em "Criando…" até a
            // lista nova chegar; o modal fecha junto com a enquete aparecendo em "Agora".
            setForm(null);
            if (created) {
              setModels(false);
              saved("Enquete criada.");
            }
          }}
        />
      )}
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
              {TPL[p.template].emoji}
            </span>
            <span className="cp-pt">
              <b>{p.question}</b>
              <small>{p.meta}</small>
              <small className="cp-popts">{p.options}</small>
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

// Botão discreto que pede confirmação antes de uma ação que não dá para desfazer. Deu certo,
// a linha fica em "Um instante…" até o refresh tirá-la da lista; deu errado, volta na hora.
function Confirm({ label, ask, yes, onYes }: { label: string; ask: string; yes: string; onYes: () => Promise<boolean> }) {
  const [asking, setAsking] = useState(false);
  const [busy, startYes] = useTransition();
  if (!asking)
    return (
      <span className="cp-acts">
        <button className="cp-link" onClick={() => setAsking(true)}>
          {label}
        </button>
      </span>
    );
  return (
    <span className="cp-acts asking">
      <span>{ask}</span>
      <button
        className="cp-link danger"
        disabled={busy}
        onClick={() =>
          startYes(async () => {
            if (await onYes()) startTransition(() => setAsking(false));
            else setAsking(false);
          })
        }
      >
        {busy ? "Um instante…" : yes}
      </button>
      <button className="cp-link" disabled={busy} onClick={() => setAsking(false)}>
        Não
      </button>
    </span>
  );
}

type OptState = { mode: "dish" | "text"; item_id: string; label: string };
const TEXT = "__texto";

function PollModal({ template, data, onClose }: { template: PollTemplate; data: EditorData; onClose: (created?: boolean) => void }) {
  const dishes = new Map(data.categories.flatMap((c) => c.items.map((i) => [i.id, i] as const)));
  const textFirst = template === "music" || template === "custom";
  const [question, setQuestion] = useState("");
  const [opts, setOpts] = useState<OptState[]>(() =>
    suggestOptions(template, data.categories).map((o) => ({
      mode: o.item_id || !textFirst ? "dish" : "text",
      item_id: o.item_id ?? "",
      label: o.item_id ? "" : o.label,
    })),
  );
  const [later, setLater] = useState(false);
  const [start, setStart] = useState("");
  const [minutes, setMinutes] = useState<PollMinutes>(10);
  const [busy, startSaving] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const setOpt = (k: number, patch: Partial<OptState>) => setOpts((s) => s.map((o, i) => (i === k ? { ...o, ...patch } : o)));
  const pick = (k: number, v: string) => (v === TEXT ? setOpt(k, { mode: "text", item_id: "" }) : setOpt(k, { mode: "dish", item_id: v }));

  const save = () => {
    setErr(null);
    if (later && !start) return setErr("Escolha a hora de início.");
    startSaving(async () => {
      const res = await createPoll(data.restaurantId, {
        template,
        question,
        options: opts.map((o) =>
          o.mode === "dish" ? { item_id: o.item_id || null, label: dishes.get(o.item_id)?.name ?? "" } : { item_id: null, label: o.label },
        ),
        start: later ? start : null,
        minutes,
      }).catch(() => ({ error: "Não foi possível salvar. Tente de novo." }));
      if (res.error) return setErr(res.error);
      startTransition(() => onClose(true));
    });
  };

  return (
    <Modal
      title={`Nova enquete: ${TPL[template].name.toLowerCase()}`}
      onClose={() => onClose()}
      footer={
        <>
          {err && (
            <p className="md-err" role="alert">
              {err}
            </p>
          )}
          <div className="md-actions">
            <button className="btn outline" onClick={() => onClose()} disabled={busy}>
              Fechar
            </button>
            <button className="btn primary" onClick={save} disabled={busy}>
              {busy ? "Criando…" : later ? "Agendar enquete" : "Pôr no ar agora"}
            </button>
          </div>
        </>
      }
    >
      {template === "custom" ? (
        <label className="md-field">
          <span>Pergunta</span>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={QUESTION_MAX} placeholder="Qual prato sai primeiro hoje?" />
        </label>
      ) : (
        <div className="md-field">
          <span>Pergunta</span>
          <p className="cp-q">{templateQuestion(template)}</p>
          <small className="cp-hint">O cliente lê a pergunta no idioma dele.</small>
        </div>
      )}

      <div className="md-field">
        <span>Opções (2 ou 3)</span>
        <div className="cp-opts">
          {opts.map((o, k) => (
            <div key={k} className="cp-opt">
              <i aria-hidden>{String.fromCharCode(65 + k)}</i>
              <div className="cp-opt-in">
                <select value={o.mode === "text" ? TEXT : o.item_id} onChange={(e) => pick(k, e.target.value)} aria-label={`Opção ${k + 1}`}>
                  <option value="">Escolha um prato…</option>
                  {data.categories.map((c) => (
                    <optgroup key={c.name} label={c.name}>
                      {c.items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                  <option value={TEXT}>Escrever um texto</option>
                </select>
                {o.mode === "text" && (
                  <input
                    value={o.label}
                    onChange={(e) => setOpt(k, { label: e.target.value })}
                    maxLength={LABEL_MAX}
                    placeholder={template === "music" ? "ex.: Rock clássico" : "Texto curto da casa"}
                    aria-label={`Texto da opção ${k + 1}`}
                  />
                )}
              </div>
              {opts.length > 2 && (
                <button className="cp-x" onClick={() => setOpts((s) => s.filter((_, i) => i !== k))} aria-label={`Tirar a opção ${k + 1}`}>
                  ×
                </button>
              )}
            </div>
          ))}
          {opts.length < 3 && (
            <button className="cp-link" onClick={() => setOpts((s) => [...s, { mode: textFirst ? "text" : "dish", item_id: "", label: "" }])}>
              + Adicionar a 3ª opção
            </button>
          )}
        </div>
      </div>

      <div className="md-field">
        <span>Começa</span>
        <div className="cp-seg" role="radiogroup" aria-label="Começa">
          <button role="radio" aria-checked={!later} onClick={() => setLater(false)}>
            Agora
          </button>
          <button role="radio" aria-checked={later} onClick={() => setLater(true)}>
            Mais tarde, hoje
          </button>
        </div>
        {later && (
          <span className="cp-in cp-time">
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Hora de início" />
          </span>
        )}
      </div>

      <div className="md-field">
        <span>Duração</span>
        <div className="cp-seg" role="radiogroup" aria-label="Duração">
          {POLL_MINUTES.map((m) => (
            <button key={m} role="radio" aria-checked={minutes === m} onClick={() => setMinutes(m)}>
              {m} min
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ---------- Fotos da casa ----------

type PostPatch = { id: string; onTv?: boolean; hidden?: boolean };

function PostsCard({ data, run, saved }: { data: EditorData; run: Run; saved: Saved }) {
  const file = useRef<HTMLInputElement>(null);
  const [dish, setDish] = useState("");
  const [tv, setTv] = useState(false);
  const [busy, startSend] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const rid = data.restaurantId;
  // "No telão" e "Ocultar" mudam a linha na hora e ficam assim até o refresh trazer o banco.
  const [posts, patchPost] = useOptimistic(data.posts, (list, p: PostPatch) => list.map((x) => (x.id === p.id ? { ...x, ...p } : x)));
  const [, startPost] = useTransition();
  const patch = (p: PostPatch, fn: () => Promise<Res>, ok: string) =>
    startPost(async () => {
      patchPost(p);
      await run(fn, ok);
    });

  // Foto até 1.600 px e miniatura até 480 px, reduzidas aqui no navegador; as duas vão para
  // a pasta comunidade do restaurante. Se gravar o post falhar, os arquivos são apagados.
  // O botão fica em "Enviando…" até a foto nova aparecer na lista.
  const send = (f: File) => {
    setErr(null);
    if (!IMAGE_TYPES.test(f.type)) return setErr("Use uma foto (PNG, JPG ou WebP).");
    startSend(async () => {
      const sent: string[] = [];
      try {
        const [full, small] = await Promise.all([shrinkImage(f, 1600, 0.85, "image/jpeg"), shrinkImage(f, 480, 0.8, "image/jpeg")]);
        const id = uuid();
        sent.push(await uploadFile(rid, `comunidade/${id}-full.${extOf(full)}`, full));
        sent.push(await uploadFile(rid, `comunidade/${id}-thumb.${extOf(small)}`, small));
        const res = await addHousePost(rid, { item_id: dish, photo_url: sent[0], thumb_url: sent[1], on_tv: tv });
        if (res.error) throw new Error(res.error);
        sent.length = 0;
        startTransition(() => setTv(false));
        saved("Foto publicada no Mural.");
      } catch (e) {
        if (sent.length) await discardFiles(rid, sent).catch(() => undefined);
        setErr(e instanceof Error && e.message.length > 12 ? e.message : "Não foi possível enviar a foto. Tente de novo.");
      } finally {
        if (file.current) file.current.value = "";
      }
    });
  };

  return (
    <section className="ap-card">
      <div className="ap-card-head">
        <h2>Fotos da casa no Mural</h2>
        <Icon d={ICONS.camera} />
      </div>
      <p className="cp-lead">Fotos dos pratos tiradas pela casa. Aparecem no Mural para quem está no salão, com &quot;Pedir também&quot;.</p>

      <div className="cp-send">
        <label className="cp-fld">
          <span>Prato da foto</span>
          <span className="cp-in">
            <select value={dish} onChange={(e) => setDish(e.target.value)}>
              <option value="">Escolha um prato…</option>
              {data.categories.map((c) => (
                <optgroup key={c.name} label={c.name}>
                  {c.items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </span>
        </label>
        <label className="cp-check">
          <input type="checkbox" checked={tv} onChange={(e) => setTv(e.target.checked)} />
          <span>Pode ir para o telão: só o prato, sem pessoas</span>
        </label>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) send(f);
          }}
        />
        <button className="btn primary cp-new" disabled={!dish || busy} onClick={() => file.current?.click()}>
          <Icon d={ICONS.camera} />
          {busy ? "Enviando…" : "Enviar foto"}
        </button>
        {!dish && <small className="cp-hint">Escolha o prato antes de enviar a foto.</small>}
        {err && (
          <p className="cp-err" role="alert">
            {err}
          </p>
        )}
      </div>

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
      <div className="cp-tvs">
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
        <b>{brl(s.cents)}</b> em {s.lines} {plural(s.lines, "linha", "linhas")} com &quot;Pedir também&quot;
      </p>

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

      <p className="cp-tiles-h">A noite em números</p>
      <div className="cp-tiles">
        <div>
          <b>{s.tables.pct}%</b>
          <span>
            das mesas que leram o QR abriram a Comunidade ({s.tables.open} de {s.tables.qr})
          </span>
        </div>
        <div>
          <b>{f.vote}</b>
          <span>{plural(f.vote, "voto", "votos")}</span>
        </div>
        <div>
          <b>{s.polls}</b>
          <span>{plural(s.polls, "enquete no ar", "enquetes no ar")}</span>
        </div>
        <div>
          <b>{f.share}</b>
          <span>{plural(f.share, "compartilhamento no story", "compartilhamentos no story")}</span>
        </div>
        <div>
          <b>{f.ref_story}</b>
          <span>{plural(f.ref_story, "chegada pelo story", "chegadas pelo story")}</span>
        </div>
        <div>
          <b>{f.ref_telao}</b>
          <span>{plural(f.ref_telao, "chegada pelo QR do telão", "chegadas pelo QR do telão")}</span>
        </div>
      </div>
      <p className="cp-note">Conta a partir das {data.dayStartText}. O funil chega em lotes, com até 1 minuto de atraso.</p>
    </section>
  );
}
