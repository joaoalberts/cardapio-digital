"use client";
/* eslint-disable @next/next/no-img-element -- miniaturas da prévia vêm prontas do Storage */

import { useEffect, useRef, useState, useTransition } from "react";
import type { KeyboardEvent } from "react";
import { FONT_THEMES, fontThemeLabel, type FontThemeId } from "@/lib/menu/font-themes";
import { formatPrice } from "@/lib/menu/media";
import { statusLabel, type StatusLabel } from "@/lib/menu/hours";
import type { OpeningHours } from "@/lib/menu/types";
import { publishFontTheme } from "./actions";

type PreviewItem = {
  name: string;
  description: string;
  price_cents: number;
  image: string | null;
  thumb: string | null;
};

export type PreviewData = {
  name: string;
  logo: string | null;
  hours: OpeningHours | null;
  timezone: string;
  cover: string | null;
  categories: { name: string; count: number; thumb: string | null; items: PreviewItem[] }[];
};

type Tab = "story" | "capa" | "lista";
const TABS: { id: Tab; label: string }[] = [
  { id: "story", label: "Story" },
  { id: "capa", label: "Capa" },
  { id: "lista", label: "Lista" },
];

export function FontPicker({
  restaurantId,
  published: initialPublished,
  canPublish,
  preview,
}: {
  restaurantId: string;
  published: FontThemeId;
  canPublish: boolean;
  preview: PreviewData;
}) {
  const [published, setPublished] = useState(initialPublished);
  const [selected, setSelected] = useState<FontThemeId>(initialPublished);
  const [tab, setTab] = useState<Tab>("story");
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const optRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const screenRef = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLDivElement>(null);
  const dirty = selected !== published;
  const [status, setStatus] = useState<StatusLabel | null>(null);

  // Mesmo selo da capa do cardápio, calculado no navegador para não travar a página.
  useEffect(() => {
    if (!preview.hours) return;
    const hours = preview.hours;
    const id = setTimeout(() => setStatus(statusLabel(hours, preview.timezone, "pt-BR")), 0);
    return () => clearTimeout(id);
  }, [preview.hours, preview.timezone]);

  // Pequena animação na prévia a cada troca de fonte.
  useEffect(() => {
    const el = screenRef.current;
    if (!el) return;
    el.classList.remove("swap");
    void el.offsetWidth;
    el.classList.add("swap");
  }, [selected]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  // No celular, a prévia encolhe por inteiro para caber acima da faixa de fontes.
  useEffect(() => {
    const fit = () => {
      const el = phoneRef.current;
      if (!el) return;
      if (innerWidth > 760) {
        el.style.removeProperty("zoom");
        return;
      }
      const z = Math.max(0.5, Math.min(1, (innerHeight - 335) / 596, (innerWidth - 48) / 290));
      el.style.setProperty("zoom", z.toFixed(3));
    };
    fit();
    addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  }, []);

  const select = (id: FontThemeId) => {
    setSelected(id);
    setError(null);
  };

  const onKey = (e: KeyboardEvent) => {
    const i = FONT_THEMES.findIndex((f) => f.id === selected);
    let n: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % FONT_THEMES.length;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (i - 1 + FONT_THEMES.length) % FONT_THEMES.length;
    if (n === null) return;
    e.preventDefault();
    select(FONT_THEMES[n].id);
    optRefs.current[n]?.focus();
  };

  const publish = () =>
    startTransition(async () => {
      const res = await publishFontTheme(restaurantId, selected);
      if (res.error) {
        setError(res.error);
        return;
      }
      setPublished(selected);
      setToast(`Pronto. O cardápio dos clientes já está com a fonte ${fontThemeLabel(selected)}.`);
    });

  const story = preview.categories[0];
  const storyItem = story?.items[0];
  const listCat = preview.categories.find((c) => c.items.length > 1) ?? story;

  return (
    <>
      <div className="ap-work">
        <div className="ap-preview">
          <div className="ap-seg" role="tablist" aria-label="Tela da prévia">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="ap-phone" ref={phoneRef} data-font={selected}>
            <div className="ap-screen" ref={screenRef}>
              <div className="ap-notch" />

              {tab === "story" && (
                <section className="ap-view v-story">
                  {storyItem?.image && <img className="bgimg" src={storyItem.image} alt="" />}
                  <div className="grad" />
                  <div className="s-top">
                    <div className="s-row">
                      <i className="s-back" />
                      <span className="s-pill">Ver lista</span>
                    </div>
                    <div className="s-tabs">
                      {preview.categories.map((c, k) => (
                        <span key={k} className={k === 0 ? "on" : undefined}>
                          {c.name}
                        </span>
                      ))}
                    </div>
                    <div className="s-bars">
                      {Array.from({ length: Math.max(1, story?.count ?? 1) }, (_, k) => (
                        <i key={k} className={k === 0 ? "on" : undefined} />
                      ))}
                    </div>
                  </div>
                  <div className="s-info">
                    <span className="s-cat">{story?.name}</span>
                    <h3 className="s-name fd">{storyItem?.name}</h3>
                    {storyItem?.description && <p className="s-desc">{storyItem.description}</p>}
                    <div className="s-acts">
                      <span>Compartilhar</span>
                      {storyItem && (
                        <span className="s-price">{formatPrice(storyItem.price_cents, "pt-BR")}</span>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {tab === "capa" && (
                <section className="ap-view v-capa">
                  <div className="c-hero">
                    {preview.cover && <img className="bgimg" src={preview.cover} alt="" />}
                  </div>
                  <div className="c-brand">
                    <div className="c-logo">
                      {preview.logo ? <img src={preview.logo} alt="" /> : <b>{preview.name}</b>}
                    </div>
                    {status && (
                      <span className={`c-status${status.open ? " is-open" : ""}`}>
                        <i aria-hidden />
                        {status.state}
                {status.detail && <em>{status.detail}</em>}
                      </span>
                    )}
                  </div>
                  <div className="c-body">
                    <div className="c-tabs">
                      {preview.categories.map((c, k) => (
                        <span key={k} className={k === 0 ? "on" : undefined}>
                          {c.name}
                        </span>
                      ))}
                    </div>
                    {preview.categories.slice(0, 2).map((c, k) => (
                      <div className="c-card" key={k}>
                        {c.thumb && <img src={c.thumb} alt="" />}
                        <div>
                          <b className="fd">{c.name}</b>
                          <span>
                            {c.count} {c.count === 1 ? "item" : "itens"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {tab === "lista" && (
                <section className="ap-view v-lista">
                  <div className="l-wrap">
                    <div className="l-head">
                      <h3 className="fd">Cardápio em lista</h3>
                      <i />
                    </div>
                    <div className="l-box">
                      <h4 className="fd">{listCat?.name}</h4>
                      {listCat?.items.map((it, k) => (
                        <div className="l-item" key={k}>
                          {it.thumb ? <img src={it.thumb} alt="" /> : <span className="noimg" />}
                          <div>
                            <b>{it.name}</b>
                            {it.description && <span>{it.description}</span>}
                            <em>{formatPrice(it.price_cents, "pt-BR")}</em>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              )}
            </div>
          </div>
          <span className="ap-plabel">Prévia: {fontThemeLabel(selected)}</span>
        </div>

        <div className="ap-opts" role="radiogroup" aria-label="Fontes" onKeyDown={onKey}>
          {FONT_THEMES.map((f, k) => (
            <button
              key={f.id}
              ref={(el) => {
                optRefs.current[k] = el;
              }}
              className="ap-opt"
              role="radio"
              aria-checked={selected === f.id}
              tabIndex={selected === f.id ? 0 : -1}
              data-font={f.id}
              onClick={() => select(f.id)}
            >
              <span className="check" aria-hidden>
                <svg viewBox="0 0 16 16">
                  <path d="M3.5 8.5l3 3L12.5 5" />
                </svg>
              </span>
              {published === f.id && <span className="cur">No ar</span>}
              <span className="aa fd" aria-hidden>
                Aa
              </span>
              <span className="dish fd" aria-hidden>
                {storyItem?.name ?? "Margherita da Casa"}
              </span>
              <span className="meta">
                <b>{f.label}</b>
                <span>{f.tag}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="ap-bar">
        <span className="msg" role="status">
          {error ??
            (!canPublish
              ? "Só o dono do restaurante pode publicar a fonte."
              : dirty
                ? `Prévia não publicada. Seus clientes ainda veem: ${fontThemeLabel(published)}`
                : `Fonte publicada: ${fontThemeLabel(published)}`)}
        </span>
        <button className="btn ghost" disabled={!dirty || pending} onClick={() => select(published)}>
          Descartar
        </button>
        <button className="btn primary" disabled={!dirty || pending || !canPublish} onClick={publish}>
          {pending ? "Publicando…" : "Publicar"}
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
