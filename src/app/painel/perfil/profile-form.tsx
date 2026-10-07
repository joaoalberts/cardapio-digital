"use client";
/* eslint-disable @next/next/no-img-element -- prévia da logo enviada */

import { useEffect, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { shrinkImage } from "@/lib/images/shrink";
import { mediaUrl } from "@/lib/menu/media";
import { statusLabel, type StatusLabel } from "@/lib/menu/hours";
import { PAYMENT_IDS, paymentLabel } from "@/lib/menu/payments";
import type { OpeningHours } from "@/lib/menu/types";
import { LANG_FLAG, LANG_NAME } from "@/lib/menu/i18n";
import { Flag } from "@/app/[slug]/flag";
import { MediaSlot, useMediaSlot, type SlotMedia } from "../media-slot";
import { saveLanguages, saveProfile, setLogo } from "./actions";

const DAY_NAMES = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
// Começa na segunda, como o restaurante costuma pensar a semana.
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const EMPTY: OpeningHours = [[], [], [], [], [], [], []];
const MAX_SIDE = 512;

export type ProfileData = {
  id: string;
  name: string;
  slug: string;
  email: string;
  logo: string | null;
  banner: SlotMedia;
  phone: string;
  address: string;
  description: string;
  brandColor: string;
  instagram: string;
  facebook: string;
  wifiName: string;
  wifiPassword: string;
  showHours: boolean;
  hours: OpeningHours | null;
  timezone: string;
  showPayments: boolean;
  paymentMethods: string[];
  languages: string[];
};

export function ProfileForm({ data: d, canTranslate, canEdit }: { data: ProfileData; canTranslate: boolean; canEdit: boolean }) {
  const restaurantId = d.id;
  const [langs, setLangs] = useState(d.languages.filter((l) => l !== "pt-BR"));
  const [langBusy, setLangBusy] = useState(false);
  const [logo, setLogoUrl] = useState(d.logo);
  const [logoBusy, setLogoBusy] = useState(false);
  const [f, setF] = useState({
    name: d.name,
    phone: d.phone,
    address: d.address,
    description: d.description,
    brandColor: d.brandColor,
    instagram: d.instagram,
    facebook: d.facebook,
    wifiName: d.wifiName,
    wifiPassword: d.wifiPassword,
    showHours: d.showHours,
    showPayments: d.showPayments,
    paymentMethods: d.paymentMethods,
  });
  const [hours, setHours] = useState<OpeningHours>(d.hours ?? EMPTY);
  const [link, setLink] = useState(`/${d.slug}`);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusLabel | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const banner = useMediaSlot(restaurantId, "cover", d.banner);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    const id = setTimeout(() => setLink(`${location.origin}/${d.slug}`), 0);
    return () => clearTimeout(id);
  }, [d.slug]);

  useEffect(() => {
    const id = setTimeout(() => setStatus(statusLabel(hours, d.timezone, "pt-BR")), 0);
    return () => clearTimeout(id);
  }, [hours, d.timezone]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const fail = (m: string) => {
    setErr(m);
    setToast(m);
  };

  const uploadLogo = async (file: File) => {
    setErr(null);
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return fail("Use uma imagem PNG, JPG ou WebP.");
    setLogoBusy(true);
    try {
      const blob = await shrinkImage(file, MAX_SIDE, 0.9);
      const path = `${restaurantId}/logo-${Date.now()}.webp`;
      const { error } = await createClient()
        .storage.from("media")
        .upload(path, blob, { contentType: "image/webp", cacheControl: "31536000" });
      if (error) throw error;
      const res = await setLogo(restaurantId, path);
      if (res.error) throw new Error(res.error);
      setLogoUrl(mediaUrl(path));
      setToast("Logo atualizada no cardápio.");
    } catch (e) {
      fail(e instanceof Error && e.message.startsWith("Não") ? e.message : "Não foi possível enviar a logo. Tente de novo.");
    } finally {
      setLogoBusy(false);
    }
  };

  const removeLogo = async () => {
    setLogoBusy(true);
    const res = await setLogo(restaurantId, null);
    setLogoBusy(false);
    if (res.error) fail(res.error);
    else {
      setLogoUrl(null);
      setToast("Logo removida.");
    }
  };

  const setDay = (day: number, ranges: OpeningHours[number]) => setHours((h) => h.map((x, i) => (i === day ? ranges : x)));
  const copyToAll = (day: number) => setHours((h) => h.map(() => h[day].map((r) => ({ ...r }))));

  const save = () =>
    startTransition(async () => {
      setErr(null);
      const res = await saveProfile(restaurantId, { ...f, hours, banner: banner.value });
      if (res.error) return fail(res.error);
      banner.committed();
      setToast("Cadastro salvo. O cardápio já mostra as mudanças.");
    });

  const copy = async () => {
    await navigator.clipboard?.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const togglePay = (p: string) =>
    set("paymentMethods", f.paymentMethods.includes(p) ? f.paymentMethods.filter((x) => x !== p) : [...f.paymentMethods, p]);

  return (
    <section className="ap-card pf">
      <div className="ap-card-head">
        <svg className="icon" viewBox="0 0 24 24" aria-hidden>
          <path d="M11 4H5a1 1 0 00-1 1v14a1 1 0 001 1h14a1 1 0 001-1v-6M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4z" />
        </svg>
        <h2>Editar Cadastro</h2>
      </div>

      <fieldset className="pf-form" disabled={!canEdit}>
        <div className="pf-banner">
          <MediaSlot slot={banner} label="banner" shape="wide" />
          <small className="pf-hint">Banner do topo do cardápio: foto ou vídeo, de preferência vertical ou quadrado.</small>
        </div>

        <div className="pf-logo">
          <div className="pf-logo-img">{logo ? <img src={logo} alt={`Logo de ${d.name}`} /> : <b>{d.name}</b>}</div>
          <button type="button" className="ms-link" disabled={logoBusy} onClick={() => fileRef.current?.click()}>
            {logoBusy ? "Enviando…" : logo ? "Alterar logo" : "Enviar logo"}
          </button>
          {logo && (
            <button type="button" className="ms-del" disabled={logoBusy} onClick={removeLogo}>
              Excluir logo
            </button>
          )}
          <small className="pf-hint">Quadrada, de preferência PNG com fundo transparente. Salva na hora.</small>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void uploadLogo(file);
            }}
          />
        </div>

        <div className="pf-field">
          <span className="pf-cap">Link do seu estabelecimento</span>
          <div className="pf-link">
            <input readOnly value={link} aria-label="Link do cardápio" />
            <button type="button" onClick={copy} aria-label="Copiar link" title="Copiar link">
              <svg className="icon" viewBox="0 0 24 24" aria-hidden>
                <path d="M9 9h11v11H9zM5 15H4V4h11v1" />
              </svg>
            </button>
          </div>
          {copied && <small className="pf-hint">Link copiado.</small>}
        </div>

        <Field label="Nome">
          <input value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={80} />
        </Field>
        <Field label="Username">
          <input value={d.slug} readOnly className="ro" />
        </Field>
        <Field label="E-mail">
          <input value={d.email} readOnly className="ro" />
        </Field>
        <Field label="Celular">
          <input value={f.phone} onChange={(e) => set("phone", e.target.value)} maxLength={30} inputMode="tel" placeholder="(11) 90000-0000" />
        </Field>
        <Field label="Endereço">
          <input value={f.address} onChange={(e) => set("address", e.target.value)} maxLength={200} />
        </Field>
        <Field label="Descrição">
          <textarea value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={300} rows={2} />
        </Field>
        <Field label="Trocar cor (cardápio)">
          <input type="color" className="pf-color" value={f.brandColor} onChange={(e) => set("brandColor", e.target.value)} />
        </Field>
        <Field label="Instagram">
          <span className="pf-pre">
            <i>@</i>
            <input value={f.instagram} onChange={(e) => set("instagram", e.target.value)} maxLength={60} />
          </span>
        </Field>
        <Field label="Facebook">
          <span className="pf-pre">
            <i>www.facebook.com/</i>
            <input value={f.facebook} onChange={(e) => set("facebook", e.target.value)} maxLength={80} />
          </span>
        </Field>

        <div className="pf-field">
          <span className="pf-title">
            Horário de funcionamento
            {status && (
              <span className={`pf-status${status.open ? " is-open" : ""}`}>
                <i aria-hidden />
                {status.state}
                {status.detail && <em>{status.detail}</em>}
              </span>
            )}
          </span>
          <label className="pf-small-check">
            <input type="checkbox" checked={f.showHours} onChange={(e) => set("showHours", e.target.checked)} />
            Mostrar horário na página principal para clientes
          </label>
          <div className="pf-days">
            {ORDER.map((day) => {
              const ranges = hours[day];
              const open = ranges.length > 0;
              return (
                <div className="pf-day" key={day}>
                  <label className="pf-toggle">
                    <input
                      type="checkbox"
                      checked={open}
                      onChange={(e) => setDay(day, e.target.checked ? [{ open: "18:00", close: "23:00" }] : [])}
                    />
                    <span>{DAY_NAMES[day]}</span>
                  </label>
                  <div className="pf-ranges">
                    {!open && <span className="pf-closed">Fechado</span>}
                    {ranges.map((r, k) => (
                      <div className="pf-range" key={k}>
                        <input
                          type="time"
                          aria-label={`${DAY_NAMES[day]}: abre`}
                          value={r.open}
                          onChange={(e) => setDay(day, ranges.map((x, j) => (j === k ? { ...x, open: e.target.value } : x)))}
                        />
                        <span>às</span>
                        <input
                          type="time"
                          aria-label={`${DAY_NAMES[day]}: fecha`}
                          value={r.close}
                          onChange={(e) => setDay(day, ranges.map((x, j) => (j === k ? { ...x, close: e.target.value } : x)))}
                        />
                        <button type="button" className="pf-x" aria-label="Tirar este horário" onClick={() => setDay(day, ranges.filter((_, j) => j !== k))}>
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="pf-day-actions">
                    {open && ranges.length < 2 && (
                      <button type="button" onClick={() => setDay(day, [...ranges, { open: "18:00", close: "23:00" }])}>
                        + 2º horário
                      </button>
                    )}
                    {open && (
                      <button type="button" onClick={() => copyToAll(day)}>
                        Usar em todos
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <small className="pf-hint">Se fechar depois da meia-noite, coloque o fechamento normalmente (ex.: 18:00 às 01:00).</small>
        </div>

        <div className="pf-field">
          <span className="pf-title">Meios de pagamento</span>
          <label className="pf-small-check">
            <input type="checkbox" checked={f.showPayments} onChange={(e) => set("showPayments", e.target.checked)} />
            Mostrar meios de pagamento na página principal para clientes
          </label>
          <div className="pf-pays">
            {PAYMENT_IDS.map((p) => (
              <label key={p} className="pf-small-check">
                <input type="checkbox" checked={f.paymentMethods.includes(p)} onChange={() => togglePay(p)} />
                {paymentLabel(p)}
              </label>
            ))}
          </div>
        </div>

        <Field label="Rede Wi-fi">
          <input value={f.wifiName} onChange={(e) => set("wifiName", e.target.value)} maxLength={60} />
        </Field>
        <Field label="Senha Wi-fi">
          <input value={f.wifiPassword} onChange={(e) => set("wifiPassword", e.target.value)} maxLength={60} />
        </Field>

        <div className="pf-field">
          <span className="pf-title">Idiomas do cardápio</span>
          <small className="pf-hint">
            O cliente troca o idioma pela bandeira. O texto base é em português. Salva na hora.
            {canTranslate && " Ao ligar um idioma, o sistema sugere a tradução de todo o cardápio para você revisar em Cardápio."}
          </small>
          <div className="pf-langs">
            {["pt-BR", "en", "es", "fr", "it", "de"].map((l) => {
              const on = l === "pt-BR" || langs.includes(l);
              return (
                <button
                  type="button"
                  key={l}
                  className="pf-lang"
                  aria-pressed={on}
                  disabled={l === "pt-BR" || langBusy}
                  onClick={async () => {
                    const next = on ? langs.filter((x) => x !== l) : [...langs, l];
                    setLangs(next);
                    setLangBusy(true);
                    const res = await saveLanguages(restaurantId, next);
                    setLangBusy(false);
                    if (res.error) {
                      setLangs(langs);
                      fail(res.error);
                    } else {
                      setToast(
                        !on && res.translated
                          ? `${LANG_NAME[l]} ligado. Traduções sugeridas, revise em Cardápio.`
                          : on
                            ? `${LANG_NAME[l]} desligado.`
                            : `${LANG_NAME[l]} ligado.`,
                      );
                    }
                  }}
                >
                  <span className="tr-flag">
                    <Flag code={LANG_FLAG[l]} />
                  </span>
                  {LANG_NAME[l]}
                </button>
              );
            })}
          </div>
          {langBusy && <small className="pf-hint">Salvando e traduzindo o cardápio…</small>}
        </div>

        {err && (
          <p className="md-err" role="alert">
            {err}
          </p>
        )}
        <div>
          <button type="button" className="btn primary" onClick={save} disabled={pending || banner.uploading}>
            {pending ? "Salvando…" : "Salvar Edição"}
          </button>
        </div>
      </fieldset>
      {!canEdit && <p className="pf-hint">Só o dono do restaurante pode mudar o cadastro.</p>}
      {toast && (
        <div className="ap-toast" role="status">
          {toast}
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="pf-field">
      <span className="pf-cap">{label}</span>
      {children}
    </label>
  );
}
