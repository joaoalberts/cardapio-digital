"use client";
/* eslint-disable @next/next/no-img-element -- prévia da logo enviada */

import { useEffect, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { shrinkImage } from "@/lib/images/shrink";
import { mediaUrl } from "@/lib/menu/media";
import { statusLabel, type StatusLabel } from "@/lib/menu/hours";
import type { OpeningHours } from "@/lib/menu/types";
import { saveHours, saveLanguages, setLogo } from "./actions";
import { Flag } from "@/app/[slug]/flag";
import { LANG_FLAG, LANG_NAME } from "@/lib/menu/i18n";

const DAY_NAMES = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
// Começa na segunda, como o restaurante costuma pensar a semana.
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const EMPTY: OpeningHours = [[], [], [], [], [], [], []];
const MAX_SIDE = 512;

export function ProfileForm({
  restaurantId,
  name,
  logo: initialLogo,
  hours: initialHours,
  timezone,
  languages: initialLangs,
  canTranslate,
  canEdit,
}: {
  restaurantId: string;
  name: string;
  logo: string | null;
  hours: OpeningHours | null;
  timezone: string;
  languages: string[];
  canTranslate: boolean;
  canEdit: boolean;
}) {
  const [langs, setLangs] = useState(initialLangs.filter((l) => l !== "pt-BR"));
  const [langBusy, setLangBusy] = useState(false);
  const [logo, setLogoUrl] = useState(initialLogo);
  const [logoBusy, setLogoBusy] = useState(false);
  const [hours, setHours] = useState<OpeningHours>(initialHours ?? EMPTY);
  const [saved, setSaved] = useState(JSON.stringify(initialHours ?? EMPTY));
  const [msg, setMsgState] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // No celular a barra esconde a mensagem; o erro também aparece no aviso flutuante.
  const setMsg = (m: string | null) => {
    setMsgState(m);
    if (m) setToast(m);
  };
  const [status, setStatus] = useState<StatusLabel | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(hours) !== saved;

  useEffect(() => {
    const id = setTimeout(() => setStatus(statusLabel(hours, timezone, "pt-BR")), 0);
    return () => clearTimeout(id);
  }, [hours, timezone]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const upload = async (file: File) => {
    setMsg(null);
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setMsg("Use uma imagem PNG, JPG ou WebP.");
      return;
    }
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
      setMsg(e instanceof Error && e.message.startsWith("Não") ? e.message : "Não foi possível enviar a logo. Tente de novo.");
    } finally {
      setLogoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeLogo = async () => {
    setLogoBusy(true);
    const res = await setLogo(restaurantId, null);
    setLogoBusy(false);
    if (res.error) setMsg(res.error);
    else {
      setLogoUrl(null);
      setToast("Logo removida.");
    }
  };

  const setDay = (d: number, ranges: OpeningHours[number]) =>
    setHours((h) => h.map((x, i) => (i === d ? ranges : x)));

  const copyToAll = (d: number) => setHours((h) => h.map(() => h[d].map((r) => ({ ...r }))));

  const save = () =>
    startTransition(async () => {
      setMsg(null);
      const res = await saveHours(restaurantId, hours);
      if (res.error) setMsg(res.error);
      else {
        setSaved(JSON.stringify(hours));
        setToast("Horário publicado no cardápio.");
      }
    });

  return (
    <>
      <div className="pf">
        <section className="pf-card">
          <h2>Logo</h2>
          <div className="pf-logo-row">
            <div className="pf-logo">{logo ? <img src={logo} alt={`Logo de ${name}`} /> : <b>{name}</b>}</div>
            <div className="pf-logo-actions">
              <p>Quadrada, de preferência PNG com fundo transparente. Ela aparece recortada num círculo.</p>
              <div className="pf-btns">
                <button
                  className="btn primary"
                  disabled={!canEdit || logoBusy}
                  onClick={() => fileRef.current?.click()}
                >
                  {logoBusy ? "Enviando…" : logo ? "Trocar logo" : "Enviar logo"}
                </button>
                {logo && (
                  <button className="btn ghost" disabled={!canEdit || logoBusy} onClick={removeLogo}>
                    Remover
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
              />
            </div>
          </div>
        </section>

        <section className="pf-card">
          <h2>Idiomas do cardápio</h2>
          <p className="pf-note">
            O cliente troca o idioma pela bandeira. O texto base é em português.
            {canTranslate
              ? " Ao ligar um idioma, o sistema sugere a tradução de todo o cardápio para você revisar em Cardápio."
              : " As traduções de cada prato ficam em Cardápio, na aba Traduções."}
          </p>
          <div className="pf-langs">
            {["pt-BR", "en", "es", "fr", "it", "de"].map((l) => {
              const on = l === "pt-BR" || langs.includes(l);
              return (
                <button
                  key={l}
                  className="pf-lang"
                  aria-pressed={on}
                  disabled={l === "pt-BR" || !canEdit || langBusy}
                  onClick={async () => {
                    const next = on ? langs.filter((x) => x !== l) : [...langs, l];
                    setLangs(next);
                    setLangBusy(true);
                    const res = await saveLanguages(restaurantId, next);
                    setLangBusy(false);
                    if (res.error) {
                      setLangs(langs);
                      setMsg(res.error);
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
          {langBusy && <p className="pf-note">Salvando e traduzindo o cardápio…</p>}
        </section>

        <section className="pf-card">
          <div className="pf-head">
            <h2>Horário de funcionamento</h2>
            {status && (
              <span className={`pf-status${status.open ? " is-open" : ""}`}>
                <i aria-hidden />
                {status.state}
                {status.detail && <em>{status.detail}</em>}
              </span>
            )}
          </div>
          <p className="pf-note">Se fechar depois da meia-noite, coloque o fechamento normalmente (ex.: 18:00 às 01:00).</p>
          <div className="pf-days">
            {ORDER.map((d) => {
              const ranges = hours[d];
              const open = ranges.length > 0;
              return (
                <div className="pf-day" key={d}>
                  <label className="pf-toggle">
                    <input
                      type="checkbox"
                      checked={open}
                      disabled={!canEdit}
                      onChange={(e) => setDay(d, e.target.checked ? [{ open: "18:00", close: "23:00" }] : [])}
                    />
                    <span>{DAY_NAMES[d]}</span>
                  </label>
                  <div className="pf-ranges">
                    {!open && <span className="pf-closed">Fechado</span>}
                    {ranges.map((r, k) => (
                      <div className="pf-range" key={k}>
                        <input
                          type="time"
                          aria-label={`${DAY_NAMES[d]}: abre`}
                          value={r.open}
                          disabled={!canEdit}
                          onChange={(e) => setDay(d, ranges.map((x, j) => (j === k ? { ...x, open: e.target.value } : x)))}
                        />
                        <span>às</span>
                        <input
                          type="time"
                          aria-label={`${DAY_NAMES[d]}: fecha`}
                          value={r.close}
                          disabled={!canEdit}
                          onChange={(e) => setDay(d, ranges.map((x, j) => (j === k ? { ...x, close: e.target.value } : x)))}
                        />
                        <button
                          className="pf-x"
                          aria-label="Tirar este horário"
                          disabled={!canEdit}
                          onClick={() => setDay(d, ranges.filter((_, j) => j !== k))}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="pf-day-actions">
                    {open && ranges.length < 3 && (
                      <button
                        disabled={!canEdit}
                        onClick={() => setDay(d, [...ranges, { open: "18:00", close: "23:00" }])}
                      >
                        + horário
                      </button>
                    )}
                    {open && (
                      <button disabled={!canEdit} onClick={() => copyToAll(d)}>
                        Usar em todos
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <div className="ap-bar">
        <span className="msg" role="status">
          {msg ??
            (!canEdit
              ? "Só o dono do restaurante pode mudar o perfil."
              : dirty
                ? "Horário ainda não publicado."
                : "Tudo publicado.")}
        </span>
        <button className="btn ghost" disabled={!dirty || pending} onClick={() => setHours(JSON.parse(saved))}>
          Descartar
        </button>
        <button className="btn primary" disabled={!dirty || pending || !canEdit} onClick={save}>
          {pending ? "Publicando…" : "Publicar horário"}
        </button>
      </div>
      {toast && (
        <div className="ap-toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
