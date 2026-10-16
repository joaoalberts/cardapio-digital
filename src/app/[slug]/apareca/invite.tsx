"use client";

import { useEffect, useRef, useState } from "react";
import { useOrder } from "../order/order-context";

// Convite "Apareça na TV!" na capa do cardápio, na linha dos botões do topo, logo acima do
// balão da Comunidade. Só aparece com mesa válida (lida agora ou lembrada) e com o recurso
// ligado e aberto (GET público, uma consulta). Desligado, fechado, pausado ou com erro: não
// renderiza nada, e o cardápio fica igual ao de antes.
// Com o balão na versão compacta (ele ocupa a linha do topo), o convite vira só o ícone, na
// coluna da direita (CSS, .hero:has(.cmu-bal-c)).

type Head = { enabled?: unknown; open?: unknown };

// "Meu vídeo" guardado no aparelho: só o mínimo (id, device, prazo, formato e se já vibrou).
// Nunca a miniatura: o rosto fica só na memória da tela da fila.
export type MineSaved = { id: string; device: string; expires_at: string; ext: "mp4" | "webm"; buzzed?: boolean };
export const mineKey = (slug: string) => `apa-meu:${slug}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Lê a chave e a limpa: vencida ou torta é apagada; guardada com campos a mais (como a
// miniatura de versões antigas) é regravada só com o mínimo.
export function pruneMine(slug: string, now: number): MineSaved | null {
  const k = mineKey(slug);
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    let m: Partial<MineSaved> & Record<string, unknown>;
    try {
      m = JSON.parse(raw);
    } catch {
      m = {};
    }
    const exp = typeof m.expires_at === "string" ? Date.parse(m.expires_at) : Number.NaN;
    if (typeof m.id !== "string" || !UUID.test(m.id) || typeof m.device !== "string" || !UUID.test(m.device) || !(exp > now)) {
      localStorage.removeItem(k);
      return null;
    }
    const clean: MineSaved = { id: m.id, device: m.device, expires_at: m.expires_at as string, ext: m.ext === "webm" ? "webm" : "mp4" };
    if (m.buzzed === true) clean.buzzed = true;
    const out = JSON.stringify(clean);
    if (out !== raw) localStorage.setItem(k, out);
    return clean;
  } catch {
    return null;
  }
}

export function AparecaInvite() {
  const { table, slug } = useOrder();
  const [open, setOpen] = useState(false);
  const asked = useRef(false);
  const hasTable = !!table;

  // Toda visita ao cardápio limpa o "meu vídeo" vencido deste restaurante.
  useEffect(() => {
    pruneMine(slug, Date.now());
  }, [slug]);

  useEffect(() => {
    if (!hasTable || asked.current) return;
    asked.current = true;
    const ctrl = new AbortController();
    fetch(`/api/apareca/${encodeURIComponent(slug)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<Head>) : null))
      .then((h) => setOpen(h?.enabled === true && h.open === true))
      .catch(() => {});
    return () => {
      ctrl.abort();
      asked.current = false;
    };
  }, [hasTable, slug]);

  if (!open || !table) return null;
  return (
    <a className="apa-inv" href={`/${slug}/apareca?mesa=${encodeURIComponent(table.code)}`} aria-label="Apareça na TV! Grave 6 segundos e apareça no telão">
      <span className="apa-inv-ic" aria-hidden>
        <TvIcon />
      </span>
      <span className="apa-inv-t">Apareça na TV!</span>
    </a>
  );
}

export function TvIcon() {
  return (
    <svg viewBox="0 0 24 24" className="apa-ic">
      <rect x="3" y="6" width="18" height="12.5" rx="2.6" />
      <path d="M9 3.5l3 2.5 3-2.5M8.5 21h7" />
      <circle cx="12" cy="12.25" r="2.4" className="apa-ic-dot" />
    </svg>
  );
}
