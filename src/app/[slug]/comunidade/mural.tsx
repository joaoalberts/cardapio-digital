"use client";
/* eslint-disable @next/next/no-img-element -- miniaturas e fotos da casa já vêm no tamanho certo */

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { houseHighlight, muralColumns, relativeTime } from "@/lib/comunidade/client-logic";
import { ct, ctf } from "@/lib/comunidade/i18n";
import type { PublicPost } from "@/lib/comunidade/types";
import { mediaUrl, thumbSrc } from "@/lib/menu/media";
import { MURAL_PAGE } from "@/lib/comunidade/public-state";
import { useOrder } from "../order/order-context";
import { BuyButton } from "./buy-button";
import { IconCamera, IconClose, useClock } from "./parts";
import { useComunidade } from "./provider";

// Mural de pratos, fase 1a: só fotos da casa (ficha: telas 11 e 12). Mosaico de 2 colunas
// desencontradas, miniatura no mosaico (carregada só perto da tela) e a foto grande ao
// tocar. Cada cartão: o prato no idioma do cliente, há quanto tempo e "Pedir também". Prato
// que saiu do cardápio fica cinza com "indisponível hoje". Sem fotos: o destaque da casa.
// Páginas de 20; "Ver mais" busca as mais antigas (?antes=<created_at da última>).

export function Mural({ onPhoto }: { onPhoto: (p: { src: string; name: string }) => void }) {
  const c = useComunidade();
  const o = useOrder();
  const s = c.state;
  const L = o.lang;
  const menu = o.menu;
  const nowSeed = s ? Date.parse(s.now) : 0;
  const now = useClock(c.open, nowSeed, c.skew, 30_000);
  const highlight = useMemo(() => (menu ? houseHighlight(menu, new Date(nowSeed)) : null), [menu, nowSeed]);

  // Páginas mais antigas, buscadas com "Ver mais". A primeira página vem do estado.
  const [older, setOlder] = useState<PublicPost[]>([]);
  const [more, setMore] = useState<"idle" | "loading" | "end">("idle");
  const first = useMemo(() => s?.mural ?? [], [s]);
  const posts = useMemo(() => {
    const seen = new Set<string>();
    return [...first, ...older].filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  }, [first, older]);
  const lastPage = older.length ? older.length % MURAL_PAGE === 0 : first.length === MURAL_PAGE;
  const canMore = posts.length > 0 && lastPage && more !== "end";

  // Uma nova primeira página (post novo ou ocultado) refaz a paginação a partir dela.
  const firstKey = first.map((p) => p.id).join(",");
  useEffect(() => {
    queueMicrotask(() => {
      setOlder([]);
      setMore("idle");
    });
  }, [firstKey]);

  const loadMore = async () => {
    const last = posts[posts.length - 1];
    if (!last || more === "loading" || !o.slug) return;
    setMore("loading");
    try {
      const r = await fetch(`/api/comunidade/${o.slug}?antes=${encodeURIComponent(last.created_at)}`);
      const page = r.ok ? ((await r.json()) as { mural?: PublicPost[] }).mural : null;
      if (!Array.isArray(page)) return setMore("idle");
      setOlder((prev) => [...prev, ...page]);
      setMore(page.length < MURAL_PAGE ? "end" : "idle");
    } catch {
      setMore("idle");
    }
  };

  if (!s || !menu) return null;
  const logo = mediaUrl(menu.restaurant.logo_path);

  if (!posts.length) {
    return (
      <div className="cmu-empty">
        <p className="cmu-el">{ct(highlight ? "emptyLead" : "emptyNone", L)}</p>
        {highlight && (
          <article className="cmu-post cmu-top1">
            <div className="cmu-pimg">
              {thumbSrc(highlight) && <img className="cmu-p" src={thumbSrc(highlight)!} alt="" />}
              <span className="cmu-chip">
                <i className="cmu-star">★</i> {ct("highlightLower", L)}
              </span>
            </div>
            <div className="cmu-pm">
              <b className="fd">{highlight.name}</b>
              <span>{ct("fromMenu", L)}</span>
            </div>
            <BuyButton itemId={highlight.id} source={null} big />
          </article>
        )}
        <p className="cmu-en">
          <IconCamera />
          {ct("emptyNote", L)}
        </p>
      </div>
    );
  }

  const { left, right } = muralColumns(posts);
  const card = ({ post, ar, i }: { post: PublicPost; ar: string; i: number }) => {
    const item = o.itemById(post.item_id);
    const off = !item;
    const name = item?.name ?? ct("unavailable", L);
    return (
      <article key={post.id} className={`cmu-post${off ? " off" : ""}`} style={{ "--i": Math.min(i, 8) } as CSSProperties}>
        <button
          className="cmu-pimg"
          style={{ aspectRatio: ar }}
          onClick={() => onPhoto({ src: post.photo, name })}
          aria-label={ctf("photoOpen", L, { name })}
        >
          <img className="cmu-p" src={post.thumb} alt="" loading="lazy" decoding="async" />
          <span className="cmu-by">
            {logo && <img src={logo} alt="" />}
            {ct("byHouse", L)}
          </span>
          {!off && highlight?.id === post.item_id && (
            <span className="cmu-chip">
              <i className="cmu-star">★</i> {ct("highlightLower", L)}
            </span>
          )}
          {off && <span className="cmu-chip">{ct("unavailableToday", L)}</span>}
        </button>
        <div className="cmu-pm">
          <b>{name}</b>
          <span>{relativeTime(post.created_at, new Date(now), L)}</span>
        </div>
        <BuyButton itemId={post.item_id} source={{ kind: "mural", ref: post.id }} />
      </article>
    );
  };

  return (
    <>
      <div className="cmu-mhead">
        <b className="fd">{ct("muralHead", L)}</b>
        <span>{ct("muralHeadSub", L)}</span>
      </div>
      <div className="cmu-mos">
        <div className="cmu-col">{left.map(card)}</div>
        <div className="cmu-col r">{right.map(card)}</div>
      </div>
      {canMore ? (
        <button className="cmu-more" onClick={() => void loadMore()} disabled={more === "loading"} aria-busy={more === "loading"}>
          {more === "loading" ? <i className="cmu-spin" aria-hidden /> : ct("seeMore", L)}
        </button>
      ) : (
        <p className="cmu-mend">{ct("muralEnd", L)}</p>
      )}
    </>
  );
}

// Foto grande, por cima da camada (sem outro desfoque: um só por camada).
export function PhotoView({ photo, onClose, lang }: { photo: { src: string; name: string }; onClose: () => void; lang: string }) {
  return (
    <div className="cmu-photo" role="dialog" aria-label={photo.name} onClick={onClose}>
      <img src={photo.src} alt={photo.name} />
      <b>{photo.name}</b>
      <button className="cmu-x" onClick={onClose} aria-label={ct("photoClose", lang)}>
        <IconClose />
      </button>
    </div>
  );
}
