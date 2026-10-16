"use client";
/* eslint-disable @next/next/no-img-element -- miniaturas pequenas, já em tamanho certo (mesmo motivo do cardápio) */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MediaSlot, useMediaSlot, type SlotMedia } from "../media-slot";
import { Check, ConfirmDelete, FootButtons, Modal, money, parseMoney } from "../cardapio/modals";
import { deleteSpecial, saveSpecial, setSpecialActive } from "./actions";

// Seção "Produtos especiais" do painel: lista das ofertas relâmpago e o formulário.
// Regras e mensagens em validate.ts; o servidor confere de novo ao salvar.

export type EditorSpecial = {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  promoCents: number | null;
  active: boolean;
  everyH: number;
  showS: number;
  days: number[];
  from: string | null;
  to: string | null;
  limit: number;
  media: SlotMedia;
};

const DAYS = ["D", "S", "T", "Q", "Q", "S", "S"];
const DAY_NAMES = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const brl = (c: number | null) => (c == null ? "—" : `R$ ${money(c).replace(/,00$/, "")}`);
const hours = (h: number) => (h === 0.5 ? "30 min" : `${String(h).replace(".", ",")} h`);

function daysText(days: number[]) {
  if (!days.length || days.length === 7) return "Todos os dias";
  return days.map((d) => DAY_NAMES[d].slice(0, 3)).join(", ");
}

export function SpecialsEditor({ restaurantId, specials }: { restaurantId: string; specials: EditorSpecial[] }) {
  const router = useRouter();
  const [modal, setModal] = useState<{ item: EditorSpecial | null } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600);
  };

  const toggle = async (s: EditorSpecial) => {
    setBusyId(s.id);
    const res = await setSpecialActive(restaurantId, s.id, !s.active);
    setBusyId(null);
    if (res.error) flash(res.error);
    else flash(s.active ? "Oferta desligada." : "Oferta ligada.");
    router.refresh();
  };

  return (
    <div className="sp">
      <section className="ap-card">
        <div className="ap-card-head">
          <h2>Ofertas relâmpago</h2>
        </div>
        <p className="sp-lead">
          Cada cliente vê a oferta numa hora sorteada só para ele, como um story especial dentro da categoria em que está navegando. Se ele não tocar em
          &quot;Pedir agora&quot; a tempo, a oferta some e só volta depois do intervalo.
        </p>
        <button className="btn primary sp-new" onClick={() => setModal({ item: null })}>
          Novo produto especial
        </button>

        {specials.length ? (
          <ul className="sp-list">
            {specials.map((s) => (
              <li key={s.id} className={`sp-row${s.active ? "" : " off"}`}>
                <button className="sp-open" onClick={() => setModal({ item: s })} aria-label={`Editar ${s.name}`}>
                  {s.media?.thumb ? <img src={s.media.thumb} alt="" /> : <span className="sp-ph" aria-hidden />}
                  <span className="sp-txt">
                    <b>{s.name}</b>
                    <span className="sp-price">
                      <s>{brl(s.priceCents)}</s>
                      <strong>{brl(s.promoCents)}</strong>
                    </span>
                    <span className="sp-chips">
                      <i>a cada {hours(s.everyH)}</i>
                      <i>{s.showS} s na tela</i>
                      <i>{daysText(s.days)}</i>
                      {s.from && s.to && (
                        <i>
                          {s.from}–{s.to}
                        </i>
                      )}
                    </span>
                  </span>
                </button>
                <label className="sp-switch">
                  <input type="checkbox" role="switch" checked={s.active} disabled={busyId === s.id} onChange={() => toggle(s)} aria-label={`${s.name}: oferta ${s.active ? "ligada" : "desligada"}`} />
                  <span className="sp-track" aria-hidden />
                  <span className="sp-state">{s.active ? "Ligada" : "Desligada"}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sp-empty">Nenhum produto especial ainda. Crie o primeiro para ele começar a aparecer no cardápio.</p>
        )}
      </section>

      {modal && (
        <SpecialModal
          restaurantId={restaurantId}
          item={modal.item}
          onClose={(msg) => {
            setModal(null);
            if (msg) flash(msg);
            router.refresh();
          }}
        />
      )}
      {toast && (
        <div className="ap-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function SpecialModal({ restaurantId, item, onClose }: { restaurantId: string; item: EditorSpecial | null; onClose: (msg?: string) => void }) {
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [price, setPrice] = useState(money(item?.priceCents ?? null));
  const [promo, setPromo] = useState(money(item?.promoCents ?? null));
  const [everyH, setEveryH] = useState(String(item?.everyH ?? 2).replace(".", ","));
  const [showS, setShowS] = useState(String(item?.showS ?? 6));
  const [days, setDays] = useState<number[]>(item?.days ?? []);
  const [from, setFrom] = useState(item?.from ?? "");
  const [to, setTo] = useState(item?.to ?? "");
  const [limit, setLimit] = useState(String(item?.limit ?? 1));
  const [active, setActive] = useState(item?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const slot = useMediaSlot(restaurantId, "items", item?.media ?? null);

  const close = (msg?: string) => {
    slot.discard();
    onClose(msg);
  };

  const save = async () => {
    setErr(null);
    setBusy(true);
    const res = await saveSpecial(restaurantId, {
      id: item?.id,
      name,
      description,
      priceCents: parseMoney(price) ?? NaN,
      promoCents: parseMoney(promo) ?? (null as unknown as number),
      everyH: Number(everyH.replace(",", ".")),
      showS: Number(showS),
      days,
      from: from || null,
      to: to || null,
      limit: Number(limit),
      active,
      media: slot.value,
    });
    setBusy(false);
    if (res.error) return setErr(res.error);
    slot.committed();
    onClose(item ? "Produto especial salvo." : "Produto especial criado.");
  };

  const remove = async () => {
    if (!item) return;
    setBusy(true);
    const res = await deleteSpecial(restaurantId, item.id);
    setBusy(false);
    if (res.error) return setErr(res.error);
    close("Produto especial excluído.");
  };

  const toggleDay = (d: number) => setDays((s) => (s.includes(d) ? s.filter((x) => x !== d) : [...s, d].sort()));

  return (
    <Modal
      title={item ? "Editar produto especial" : "Novo produto especial"}
      onClose={() => close()}
      footer={
        <>
          {err && (
            <p className="md-err" role="alert">
              {err}
            </p>
          )}
          <FootButtons onClose={() => close()} onSave={save} busy={busy} disabled={slot.uploading} />
        </>
      }
    >
      <MediaSlot slot={slot} label="foto ou vídeo do produto especial" />

      <label className="md-field">
        <span>Nome</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Pizza da Rainha" />
      </label>
      <label className="md-field">
        <span>Descrição</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={3} />
      </label>

      <div className="sp-two">
        <label className="md-field">
          <span>Preço normal (de)</span>
          <MoneyInput value={price} onChange={setPrice} />
        </label>
        <label className="md-field">
          <span>Preço da oferta (por)</span>
          <MoneyInput value={promo} onChange={setPromo} />
        </label>
      </div>

      <div className="sp-two">
        <label className="md-field">
          <span>Aparece a cada (horas)</span>
          <input inputMode="decimal" value={everyH} onChange={(e) => setEveryH(e.target.value)} />
        </label>
        <label className="md-field">
          <span>Fica na tela (segundos)</span>
          <input inputMode="numeric" value={showS} onChange={(e) => setShowS(e.target.value)} />
        </label>
      </div>

      <div className="md-field">
        <span>Dias (nenhum marcado = todos os dias)</span>
        <div className="sp-days" role="group" aria-label="Dias da semana">
          {DAYS.map((d, i) => (
            <button key={i} type="button" aria-pressed={days.includes(i)} aria-label={DAY_NAMES[i]} onClick={() => toggleDay(i)}>
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="sp-two">
        <label className="md-field">
          <span>Horário de</span>
          <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="md-field">
          <span>até</span>
          <input type="time" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      <label className="md-field">
        <span>Limite cada vez que aparece</span>
        <input inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} />
      </label>

      <Check checked={active} onChange={setActive}>
        Oferta ligada
      </Check>

      {item && (
        <div className="md-danger">
          <ConfirmDelete label="Excluir produto especial" onConfirm={remove} busy={busy} />
        </div>
      )}
    </Modal>
  );
}

function MoneyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <span className="md-money">
      <i>R$</i>
      <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
    </span>
  );
}
