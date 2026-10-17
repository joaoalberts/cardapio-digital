"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { ringText } from "@/lib/comunidade/client-logic";
import { ct } from "@/lib/comunidade/i18n";
import type { PublicMenu } from "@/lib/menu/types";
import { formatPrice, mediaUrl, posterSrc, thumbSrc } from "@/lib/menu/media";
import { t as tr } from "@/lib/menu/i18n";

// Peças pequenas da Comunidade: relógio que anda por segundo, anel do tempo, ponto "ao vivo",
// preço e ícones. O anel gira pelo ângulo --cmu-left (@property em comunidade.css).

// Relógio do celular (mais a correção do servidor) que anda a cada `every` ms só enquanto
// `active`; parado, fica no último valor. Começa no relógio do servidor (seed) para a
// primeira pintura já mostrar o tempo certo.
export function useClock(active: boolean, seed: number, skew = 0, every = 1000): number {
  const [now, setNow] = useState(seed);
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now() + skew);
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, every);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [active, skew, every]);
  return now;
}

// Anel do tempo (ficha v2): "41 / min" dentro; sem `left`, só o anel (pílula da capa).
// paused = sem conexão (anel cinza, parado no último valor).
export function Ring({ angle, left, lang, paused = false, className = "" }: { angle: number; left?: number; lang?: string; paused?: boolean; className?: string }) {
  const t = left == null ? null : ringText(left);
  return (
    <span className={`cmu-ring${paused ? " paused" : ""} ${className}`} style={{ "--cmu-left": `${angle}deg` } as CSSProperties} aria-hidden>
      {t && (
        <span>
          <b>{t.n}</b>
          {t.unit && <small>{ct(t.unit === "min" ? "ringMin" : "ringSec", lang ?? "pt-BR")}</small>}
        </span>
      )}
    </span>
  );
}

export const Live = ({ off }: { off?: boolean }) => <i className={`cmu-dot${off ? " off" : ""}`} aria-hidden />;

// Preço junto do nome: "R$ 42"; com tamanhos de preços diferentes, "a partir de R$ 38".
export function priceText(p: { cents: number; from: boolean } | null, lang: string): string | null {
  if (!p) return null;
  return `${p.from ? `${tr("from", lang)} ` : ""}${formatPrice(p.cents, lang)}`;
}

// Capa da casa (banner do perfil, a capa antiga ou o 1º prato com foto): fundo do Palco quando
// as opções não são pratos.
export function houseCover(menu: PublicMenu): string | null {
  const r = menu.restaurant;
  const b = r.cover;
  if (b) return b.kind === "photo" ? mediaUrl(b.storage_path) : posterSrc(b);
  return mediaUrl(r.cover_image_path) ?? thumbSrc(menu.categories.flatMap((c) => c.items).find((i) => thumbSrc(i)));
}

export const IconQr = () => (
  <svg className="icon" viewBox="0 0 24 24" aria-hidden>
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <path d="M14 14h2v2M20 14v.01M14 20h.01M17 17h3v3" />
  </svg>
);
export const IconClose = () => (
  <svg className="icon" viewBox="0 0 24 24" aria-hidden>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const IconCheck = () => (
  <svg className="icon" viewBox="0 0 24 24" aria-hidden>
    <path d="M5 12.5 10 17l9-10" />
  </svg>
);
export const IconPlus = () => (
  <svg className="icon" viewBox="0 0 24 24" aria-hidden>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconShare = () => (
  <svg className="icon" viewBox="0 0 24 24" aria-hidden>
    <path d="M12 15V4M8 8l4-4 4 4" />
    <path d="M6 12v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6" />
  </svg>
);
