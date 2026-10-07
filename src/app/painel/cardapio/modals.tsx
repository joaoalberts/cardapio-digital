"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LANG_FLAG, LANG_NAME } from "@/lib/menu/i18n";
import { COUNTRIES, countryLabel, TAG_IDS, tagLabel } from "@/lib/menu/tags";
import { Flag } from "@/app/[slug]/flag";
import { MediaSlot, useMediaSlot } from "../media-slot";
import {
  deleteCategory,
  deleteItem,
  duplicateItem,
  saveItem,
  saveTranslations,
  suggestTranslations,
  updateCategory,
  type TranslationRow,
} from "./actions";
import type { EditorCategory, EditorContext, EditorItem, EditorTranslation } from "./menu-editor";

// "62,00" ou "62" -> 6200. Vazio ou inválido -> null.
export function parseMoney(s: string): number | null {
  const t = s.replace(/[^\d,.]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
export const money = (cents: number | null) =>
  cents == null ? "" : (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Janela branca no centro, título fino em cima e Fechar / Salvar embaixo (como no DGuests).
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    // A página de trás não rola enquanto a janela está aberta.
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      removeEventListener("keydown", k);
      document.documentElement.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="md-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`md${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="md-title">{title}</h2>
        <div className="md-body">{children}</div>
        {footer && <footer className="md-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function FootButtons({ onClose, onSave, busy, disabled }: { onClose: () => void; onSave: () => void; busy: boolean; disabled?: boolean }) {
  return (
    <div className="md-actions">
      <button className="btn outline" onClick={onClose} disabled={busy}>
        Fechar
      </button>
      <button className="btn primary" onClick={onSave} disabled={busy || disabled}>
        {busy ? "Salvando…" : "Salvar"}
      </button>
    </div>
  );
}

function ConfirmDelete({ label, onConfirm, busy }: { label: string; onConfirm: () => void; busy: boolean }) {
  const [ask, setAsk] = useState(false);
  if (!ask)
    return (
      <button className="btn danger" onClick={() => setAsk(true)} disabled={busy}>
        {label}
      </button>
    );
  return (
    <span className="md-confirm">
      <span>Tem certeza? Não dá para desfazer.</span>
      <button className="btn danger" onClick={onConfirm} disabled={busy}>
        Sim, excluir
      </button>
      <button className="btn outline" onClick={() => setAsk(false)}>
        Não
      </button>
    </span>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="md-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

// ---------- Traduções ----------

function Translations({
  ctx,
  base,
  initial,
  withDescription,
  rows,
  setRows,
}: {
  ctx: EditorContext;
  base: { name: string; description: string };
  initial: EditorTranslation[];
  withDescription: boolean;
  rows: Record<string, EditorTranslation>;
  setRows: (fn: (r: Record<string, EditorTranslation>) => Record<string, EditorTranslation>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const pending = initial.some((t) => t.auto);

  if (!ctx.languages.length) {
    return (
      <p className="md-note">
        O cardápio está só em português. Para mostrar outros idiomas, ligue-os em{" "}
        <Link href="/painel/perfil">Editar Perfil</Link>.
      </p>
    );
  }

  const suggest = async () => {
    setBusy(true);
    setMsg(null);
    const res = await suggestTranslations(base, ctx.languages);
    setBusy(false);
    if (res.error) return setMsg(res.error);
    setRows((r) => {
      const n = { ...r };
      for (const [lang, t] of Object.entries(res.suggestions ?? {})) n[lang] = { language: lang, ...t, auto: true };
      return n;
    });
  };

  return (
    <details
      className="tr"
      open={pending || undefined}
      onToggle={(e) => e.currentTarget.open && setRows((r) => (Object.keys(r).length ? r : seed(initial)))}
    >
      <summary>
        Traduções
        <span className="tr-flags">
          {ctx.languages.map((l) => (
            <span key={l} className="tr-flag">
              <Flag code={LANG_FLAG[l] ?? "xx"} />
            </span>
          ))}
        </span>
        {pending && <em className="me-badge">a revisar</em>}
      </summary>
      <div className="tr-head">
        <p className="md-note">
          Sem tradução, o cliente vê o texto em português.
          {ctx.canTranslate && " As sugestões automáticas aparecem marcadas; revise e salve."}
        </p>
        {ctx.canTranslate && (
          <button className="btn outline small" onClick={suggest} disabled={busy || !base.name.trim()}>
            {busy ? "Traduzindo…" : "Sugerir traduções"}
          </button>
        )}
      </div>
      {msg && <p className="md-err">{msg}</p>}
      {ctx.languages.map((lang) => {
        const r = rows[lang] ?? initial.find((t) => t.language === lang) ?? { language: lang, name: "", description: "", auto: false };
        const set = (patch: Partial<EditorTranslation>) => setRows((all) => ({ ...all, [lang]: { ...r, ...patch } }));
        return (
          <fieldset key={lang} className="tr-lang">
            <legend>
              <span className="tr-flag">
                <Flag code={LANG_FLAG[lang] ?? "xx"} />
              </span>
              {LANG_NAME[lang] ?? lang}
              {r.auto && r.name && <em className="me-badge">sugestão automática</em>}
            </legend>
            <input
              aria-label={`Nome em ${LANG_NAME[lang] ?? lang}`}
              placeholder={base.name}
              value={r.name}
              maxLength={80}
              onChange={(e) => set({ name: e.target.value, auto: false })}
            />
            {withDescription && (
              <textarea
                aria-label={`Descrição em ${LANG_NAME[lang] ?? lang}`}
                placeholder={base.description}
                rows={2}
                value={r.description}
                maxLength={500}
                onChange={(e) => set({ description: e.target.value, auto: false })}
              />
            )}
          </fieldset>
        );
      })}
    </details>
  );
}

// Ao abrir as traduções, o que aparece na tela conta como revisado quando o dono salva.
const seedIfOpen = (initial: EditorTranslation[]) => (initial.some((t) => t.auto) ? seed(initial) : {});
const seed = (initial: EditorTranslation[]) => Object.fromEntries(initial.map((t) => [t.language, t]));

const toRows = (rows: Record<string, EditorTranslation>): TranslationRow[] =>
  Object.values(rows).map(({ language, name, description }) => ({ language, name, description }));

// ---------- Produto ----------

const TAG_TEXT: Record<string, string> = { apimentado: "Produto apimentado", contem_nozes: "Contém nozes", contem_frutos_do_mar: "Contém frutos do mar" };
const tagText = (t: string) => TAG_TEXT[t] ?? `Produto ${tagLabel(t).toLowerCase()}`;

type Opt = { label: string; price: string };

export function ItemModal({
  ctx,
  item,
  categoryId: initialCat,
  onClose,
}: {
  ctx: EditorContext;
  item: EditorItem | null;
  categoryId: string;
  onClose: (msg?: string) => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [featured, setFeatured] = useState(item?.featured ?? false);
  const [hidePrice, setHidePrice] = useState(item?.hidePrice ?? false);
  const [multi, setMulti] = useState(!!item?.priceOptions?.length);
  const [price, setPrice] = useState(money(item?.priceCents ?? null));
  const [hasPromo, setHasPromo] = useState(item?.promoCents != null);
  const [promo, setPromo] = useState(money(item?.promoCents ?? null));
  const [options, setOptions] = useState<Opt[]>(
    item?.priceOptions?.map((o) => ({ label: o.label, price: money(o.priceCents) })) ?? [
      { label: "", price: "" },
      { label: "", price: "" },
    ],
  );
  const [tags, setTags] = useState<string[]>(item?.tags ?? []);
  const [serves, setServes] = useState(item?.serves ?? null);
  const [country, setCountry] = useState(item?.country ?? "");
  const [active, setActive] = useState(item?.active ?? true);
  const [categoryId, setCategoryId] = useState(initialCat);
  const [rows, setRows] = useState<Record<string, EditorTranslation>>(() => seedIfOpen(item?.translations ?? []));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const slot = useMediaSlot(ctx.restaurantId, "items", item?.media ?? null);

  const close = (msg?: string) => {
    slot.discard();
    onClose(msg);
  };

  const save = async () => {
    setErr(null);
    const priceCents = parseMoney(price);
    const promoCents = hasPromo ? parseMoney(promo) : null;
    const priceOptions = multi ? options.map((o) => ({ label: o.label.trim(), priceCents: parseMoney(o.price) ?? NaN })) : null;
    if (!name.trim()) return setErr("Dê um nome para o produto.");
    if (!multi && priceCents == null) return setErr("Informe o preço.");
    if (!multi && hasPromo && promoCents == null) return setErr("Informe o preço com desconto ou remova o desconto.");
    if (priceOptions && priceOptions.some((o) => !o.label || !Number.isFinite(o.priceCents))) {
      return setErr("Preencha o nome e o valor de cada opção de preço.");
    }
    setBusy(true);
    const res = await saveItem(ctx.restaurantId, {
      id: item?.id,
      categoryId,
      name,
      description,
      priceCents: priceCents ?? 0,
      promoCents,
      tags,
      active,
      featured,
      hidePrice,
      serves,
      country: country || null,
      priceOptions,
      media: slot.value,
    });
    if (!res.error && res.id && Object.keys(rows).length) {
      const t = await saveTranslations(ctx.restaurantId, { itemId: res.id }, toRows(rows));
      if (t.error) res.error = t.error;
    }
    setBusy(false);
    if (res.error) return setErr(res.error);
    slot.committed();
    onClose(item ? "Produto salvo." : "Produto criado.");
  };

  const remove = async () => {
    if (!item) return;
    setBusy(true);
    const res = await deleteItem(ctx.restaurantId, item.id);
    setBusy(false);
    if (res.error) return setErr(res.error);
    close("Produto excluído.");
  };

  const duplicate = async () => {
    if (!item) return;
    setBusy(true);
    const res = await duplicateItem(ctx.restaurantId, item.id);
    setBusy(false);
    if (res.error) return setErr(res.error);
    close("Cópia criada, oculta no cardápio até você revisar.");
  };

  const toggleTag = (t: string) => setTags((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));
  const setOpt = (i: number, patch: Partial<Opt>) => setOptions((o) => o.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  return (
    <Modal
      title={item ? "Editar Produto" : "Criar Produto"}
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
      <MediaSlot slot={slot} label="foto ou vídeo do produto" />

      <label className="md-field">
        <span>Nome</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </label>
      <label className="md-field">
        <span>Descrição</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={3} />
      </label>

      <Check checked={featured} onChange={setFeatured}>
        Colocar produto como destaque
      </Check>
      <Check checked={hidePrice} onChange={setHidePrice}>
        Ocultar preço
      </Check>

      <div className="md-seg" role="tablist" aria-label="Tipo de preço">
        <button role="tab" aria-selected={!multi} onClick={() => setMulti(false)}>
          Preço único
        </button>
        <button role="tab" aria-selected={multi} onClick={() => setMulti(true)}>
          Múltiplos preços
        </button>
      </div>

      {!multi ? (
        <>
          <label className="md-field">
            <span>Preço</span>
            <Money value={price} onChange={setPrice} />
          </label>
          <button className="md-link" onClick={() => setHasPromo((v) => !v)}>
            {hasPromo ? "Remover desconto" : "Adicionar desconto"}
          </button>
          {hasPromo && (
            <label className="md-field">
              <span>Preço desconto</span>
              <Money value={promo} onChange={setPromo} />
            </label>
          )}
        </>
      ) : (
        <div className="md-field">
          <span>Opções de preço (ex.: Pequena, Média, Grande)</span>
          {options.map((o, i) => (
            <div key={i} className="md-opt">
              <input aria-label={`Nome da opção ${i + 1}`} placeholder="Nome" value={o.label} maxLength={30} onChange={(e) => setOpt(i, { label: e.target.value })} />
              <Money value={o.price} onChange={(v) => setOpt(i, { price: v })} label={`Preço da opção ${i + 1}`} />
              <button
                className="md-x"
                aria-label={`Remover opção ${i + 1}`}
                disabled={options.length <= 2}
                onClick={() => setOptions((all) => all.filter((_, k) => k !== i))}
              >
                ×
              </button>
            </div>
          ))}
          {options.length < 8 && (
            <button className="md-link" onClick={() => setOptions((o) => [...o, { label: "", price: "" }])}>
              Adicionar opção
            </button>
          )}
        </div>
      )}

      <div className="md-checks">
        {TAG_IDS.map((t) => (
          <Check key={t} checked={tags.includes(t)} onChange={() => toggleTag(t)}>
            {tagText(t)}
          </Check>
        ))}
      </div>

      <label className="md-field">
        <span>Quantidade de pessoas (Opcional)</span>
        <select value={serves ?? ""} onChange={(e) => setServes(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Não se aplica</option>
          {Array.from({ length: 20 }, (_, k) => k + 1).map((n) => (
            <option key={n} value={n}>
              Serve {n} {n === 1 ? "pessoa" : "pessoas"}
            </option>
          ))}
        </select>
      </label>
      <label className="md-field">
        <span>País (Opcional)</span>
        <select value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">Não se aplica</option>
          {Object.keys(COUNTRIES).map((c) => (
            <option key={c} value={c}>
              {countryLabel(c)}
            </option>
          ))}
        </select>
      </label>

      <Check checked={!active} onChange={(v) => setActive(!v)}>
        Ocultar Produto?
      </Check>

      <label className="md-field">
        <span>Trocar produto de categoria</span>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {ctx.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <Translations ctx={ctx} base={{ name, description }} initial={item?.translations ?? []} withDescription rows={rows} setRows={setRows} />

      {item && (
        <div className="md-danger">
          <button className="btn outline" onClick={duplicate} disabled={busy}>
            Duplicar Produto
          </button>
          <ConfirmDelete label="Excluir Produto" onConfirm={remove} busy={busy} />
        </div>
      )}
    </Modal>
  );
}

function Money({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <span className="md-money">
      <i>R$</i>
      <input
        inputMode="decimal"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onChange(money(parseMoney(value)))}
        placeholder="0,00"
      />
    </span>
  );
}

// ---------- Categoria ----------

export function CategoryModal({
  ctx,
  category,
  onClose,
}: {
  ctx: EditorContext;
  category: EditorCategory;
  onClose: (msg?: string) => void;
}) {
  const [name, setName] = useState(category.name);
  const [active, setActive] = useState(category.active);
  const [description, setDescription] = useState(category.description);
  const [timed, setTimed] = useState(!!category.availableFrom);
  const [from, setFrom] = useState(category.availableFrom ?? "11:00");
  const [to, setTo] = useState(category.availableTo ?? "15:00");
  const [rows, setRows] = useState<Record<string, EditorTranslation>>(() => seedIfOpen(category.translations));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const slot = useMediaSlot(ctx.restaurantId, "categories", category.media);

  const close = (msg?: string) => {
    slot.discard();
    onClose(msg);
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    const res = await updateCategory(ctx.restaurantId, category.id, {
      name,
      active,
      description,
      availableFrom: timed ? from : null,
      availableTo: timed ? to : null,
      media: slot.value,
    });
    if (!res.error && Object.keys(rows).length) {
      const t = await saveTranslations(ctx.restaurantId, { categoryId: category.id }, toRows(rows));
      if (t.error) res.error = t.error;
    }
    setBusy(false);
    if (res.error) return setErr(res.error);
    slot.committed();
    onClose("Categoria salva.");
  };

  const remove = async () => {
    setBusy(true);
    const res = await deleteCategory(ctx.restaurantId, category.id);
    setBusy(false);
    if (res.error) return setErr(res.error);
    close("Categoria excluída.");
  };

  const n = category.items.length;
  return (
    <Modal
      title="Editar categoria"
      onClose={() => close()}
      footer={
        <>
          {err && (
            <p className="md-err" role="alert">
              {err}
            </p>
          )}
          <FootButtons onClose={() => close()} onSave={save} busy={busy} disabled={slot.uploading || !name.trim()} />
        </>
      }
    >
      <MediaSlot slot={slot} label="foto ou vídeo da categoria" />
      <p className="md-note center">Aparece no card da categoria, na página inicial do cardápio.</p>

      <label className="md-field">
        <span>Nome</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </label>
      <Check checked={!active} onChange={(v) => setActive(!v)}>
        Ocultar Categoria?
      </Check>
      <label className="md-field">
        <span>Observação</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} rows={2} />
      </label>

      <div className="md-field">
        <span>Horário de funcionamento</span>
        <Check checked={timed} onChange={setTimed}>
          Ativar categoria em horários específicos
        </Check>
        {timed && (
          <div className="md-times">
            <label>
              Das
              <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              até
              <input type="time" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
        )}
      </div>

      <Translations
        ctx={ctx}
        base={{ name, description }}
        initial={category.translations}
        withDescription
        rows={rows}
        setRows={setRows}
      />

      <div className="md-danger">
        <ConfirmDelete label={n ? `Excluir Categoria e ${n} ${n === 1 ? "produto" : "produtos"}` : "Excluir Categoria"} onConfirm={remove} busy={busy} />
      </div>
    </Modal>
  );
}
