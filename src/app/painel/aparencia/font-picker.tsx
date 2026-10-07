"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { KeyboardEvent } from "react";
import { FONT_THEMES, fontThemeLabel, type FontThemeId } from "@/lib/menu/font-themes";
import { publishFontTheme } from "./actions";

type Tab = "capa" | "story" | "lista";
const TABS: { id: Tab; label: string }[] = [
  { id: "capa", label: "Capa" },
  { id: "story", label: "Story" },
  { id: "lista", label: "Lista" },
];

export function FontPicker({
  restaurantId,
  slug,
  sampleDish,
  published: initialPublished,
  canPublish,
}: {
  restaurantId: string;
  slug: string;
  sampleDish: string;
  published: FontThemeId;
  canPublish: boolean;
}) {
  const [published, setPublished] = useState(initialPublished);
  const [selected, setSelected] = useState<FontThemeId>(initialPublished);
  const [tab, setTab] = useState<Tab>("capa");
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const optRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const phoneRef = useRef<HTMLDivElement>(null);
  const dirty = selected !== published;

  // A prévia é o cardápio de verdade num iframe; aqui só mandamos a fonte e a tela.
  const send = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage({ type: "cm-preview", font: selected, view: tab }, location.origin);
  }, [selected, tab]);
  useEffect(() => {
    send();
  }, [send]);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin === location.origin && e.data?.type === "cm-ready") send();
    };
    addEventListener("message", on);
    return () => removeEventListener("message", on);
  }, [send]);

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
          <div className="ap-phone" ref={phoneRef}>
            <div className="ap-screen">
              {/* O próprio cardápio, ao vivo: a prévia é sempre igual ao que o cliente vê. */}
              <iframe ref={frameRef} className="ap-frame" src={`/${slug}`} title="Prévia do cardápio" />
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
                {sampleDish}
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
