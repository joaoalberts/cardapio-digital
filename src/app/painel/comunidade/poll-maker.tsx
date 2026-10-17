"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState, useTransition } from "react";
import type { PollTemplate } from "@/lib/comunidade/types";
import { Modal } from "../cardapio/modals";
import { createPoll } from "./actions";
import { ICONS, Icon, TPL } from "./shared";
import { LABEL_MAX, POLL_MINUTES, QUESTION_MAX, TEMPLATES, suggestOptions, templateQuestion, type PollMinutes } from "./validate";

// "Nova enquete": o botão, a lista de modelos e o formulário. Sai do editor da Comunidade para a
// tela "Agora" usar o mesmo. Criada a enquete, pede os dados novos e chama onCreated; sem
// onCreated (fora do editor, que mostra o aviso dele), mostra o próprio "Enquete criada.".

export type PollMakerData = {
  restaurantId: string;
  categories: { name: string; items: { id: string; name: string; thumb: string | null }[] }[];
};

export function NewPoll({ data, onCreated }: { data: PollMakerData; onCreated?: () => void }) {
  const router = useRouter();
  const [models, setModels] = useState(false);
  const [form, setForm] = useState<PollTemplate | null>(null);
  const [done, setDone] = useState(false);

  return (
    <>
      <button
        className="btn primary cp-new"
        aria-expanded={models}
        onClick={() => {
          setDone(false); // o "Enquete criada." da anterior sai quando a pessoa começa outra
          setModels((v) => !v);
        }}
      >
        <Icon d={ICONS.plus} />
        Nova enquete
      </button>
      {models && (
        <div className="cp-models">
          <span>Comece de um modelo</span>
          {TEMPLATES.map((t) => (
            <button
              key={t}
              onClick={() => {
                setDone(false);
                setForm(t);
              }}
            >
              <em aria-hidden>{TPL[t].emoji}</em>
              <span>
                <b>{TPL[t].name}</b>
                <small>{t === "custom" ? "Escreva a sua pergunta" : templateQuestion(t)}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      {done && !onCreated && (
        <p className="cp-pairok" role="status">
          ✓ Enquete criada.
        </p>
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
              setDone(true);
              router.refresh();
              onCreated?.();
            }
          }}
        />
      )}
    </>
  );
}

type OptState = { mode: "dish" | "text"; item_id: string; label: string };
const TEXT = "__texto";

function PollModal({ template, data, onClose }: { template: PollTemplate; data: PollMakerData; onClose: (created?: boolean) => void }) {
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
