"use client";
/* eslint-disable @next/next/no-img-element -- miniaturas e fotos da casa já vêm no tamanho certo */

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import { houseHighlight, muralLayout, orderableNow, priceInfo, relativeTime } from "@/lib/comunidade/client-logic";
import { ct, ctf } from "@/lib/comunidade/i18n";
import type { PublicPost } from "@/lib/comunidade/types";
import { thumbSrc } from "@/lib/menu/media";
import type { MenuItem } from "@/lib/menu/types";
import { MURAL_PAGE } from "@/lib/comunidade/public-state";
import { useOrder } from "../order/order-context";
import { BuyButton } from "./buy-button";
import { IconClose, priceText, useClock } from "./parts";
import { useComunidade } from "./provider";
import { ShareStoryButton } from "./share";

// Mural de pratos, fase 1a: só fotos da casa (ficha v2, telas 10 a 13). Página de revista:
// a foto mais nova grande (1:1) com "Pedir também" e o preço no botão; depois duas quadradas
// com o nome e o preço dentro da foto e o "Pedir também" embaixo; e uma larga (16:10). Tudo
// o que vende fica acima da dobra. Tocar na foto abre a foto grande (com o story). Prato que
// saiu do cardápio, ou que o carrinho recusaria agora, fica cinza com "indisponível hoje".
// Sem fotos: o destaque da casa. Páginas de 20; "Ver mais" busca as mais antigas
// (?antes=<created_at da última>).

// Foto aberta em tamanho grande; shareable = o prato ainda está no cardápio (a rota do story
// recusa post de prato que saiu).
export type Photo = { id: string; src: string; name: string; shareable: boolean };

export function Mural({ onPhoto }: { onPhoto: (p: Photo) => void }) {
  const c = useComunidade();
  const o = useOrder();
  const s = c.state;
  const L = o.lang;
  const menu = o.menu;
  const nowSeed = s ? Date.parse(s.now) : 0;
  const now = useClock(c.open, nowSeed, c.skew, 30_000);
  const minute = c.minute || nowSeed;
  const highlight = useMemo(() => (menu ? houseHighlight(menu, new Date(minute)) : null), [menu, minute]);

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

  if (!posts.length) {
    const th = highlight ? thumbSrc(highlight) : null;
    return (
      <>
        <div className="cmu-mhead">
          <h2 className="fd">{ct("muralHead", L)}</h2>
        </div>
        <p className="cmu-mempty">
          <b>{ct(highlight ? "emptyLead" : "emptyNone", L)}</b> {highlight && ct("emptyLead2", L)}
        </p>
        {highlight && (
          <div className="cmu-spread">
            <article className="cmu-mp big">
              <div className="cmu-ph">{th && <img src={th} alt="" />}</div>
              <span className="cmu-chip">
                <i>★</i>
                {ct("highlightLower", L)}
              </span>
              <div className="cmu-cap">
                <div>
                  <h3 className="fd">{highlight.name}</h3>
                  {highlight.description && <p className="cmu-meta">{highlight.description}</p>}
                </div>
                <BuyButton itemId={highlight.id} source={null} photo price />
              </div>
            </article>
          </div>
        )}
        <p className="cmu-mfoot">{ct("emptyNote", L)}</p>
      </>
    );
  }

  type Card = { post: PublicPost; item: MenuItem | undefined; off: boolean; name: string; rel: string };
  const info = (post: PublicPost): Card => {
    const item = o.itemById(post.item_id);
    // Fora do cardápio, ou que o carrinho recusaria agora (categoria fora do horário):
    // "indisponível hoje", como o "Pedir também" do cartão.
    const off = !item || !orderableNow(menu, item.id, new Date(minute));
    return { post, item, off, name: item?.name ?? ct("unavailable", L), rel: relativeTime(post.created_at, new Date(now), L) };
  };

  const card = (k: Card, kind: "big" | "sq" | "wide", i: number) => {
    const { post, item, off, name, rel } = k;
    const pr = priceText(priceInfo(item), L);
    const star = !off && kind === "big" && highlight?.id === post.item_id;
    const chip = off ? ct("unavailableToday", L) : kind === "big" ? null : rel;
    return (
      <article key={post.id} className={`cmu-mp ${kind}${off ? " off" : ""}`} style={{ "--d": `${0.3 + Math.min(i, 8) * 0.08}s` } as CSSProperties}>
        <button
          className="cmu-ph"
          onClick={() => onPhoto({ id: post.id, src: post.photo, name, shareable: !!item })}
          aria-label={ctf("photoOpen", L, { name })}
        >
          <img src={kind === "sq" ? post.thumb : post.photo} alt="" loading={i > 0 ? "lazy" : undefined} decoding="async" />
          <span className="cmu-streak" />
        </button>
        {star ? (
          <span className="cmu-chip">
            <i>★</i>
            {ct("highlightLower", L)}
          </span>
        ) : chip ? (
          <span className="cmu-chip">{chip}</span>
        ) : null}
        <div className="cmu-cap">
          <div>
            <h3 className="fd">{name}</h3>
            {kind === "big" ? (
              <p className="cmu-meta">{ctf("fromKitchen", L, { t: rel })}</p>
            ) : pr && !off ? (
              <p className="cmu-meta">
                <b>{pr}</b>
              </p>
            ) : null}
          </div>
          {kind === "big" && <BuyButton itemId={post.item_id} source={{ kind: "mural", ref: post.id }} photo price />}
          {kind === "wide" && <BuyButton itemId={post.item_id} source={{ kind: "mural", ref: post.id }} variant="sm" photo />}
        </div>
      </article>
    );
  };

  return (
    <>
      <div className="cmu-mhead">
        <h2 className="fd">{ct("muralHead", L)}</h2>
        <p>{ct("muralHeadSub", L)}</p>
      </div>
      <div className="cmu-spread">
        {muralLayout(posts.map(info)).map((b) =>
          b.kind === "pair" ? (
            <Fragment key={b.posts[0].post.id}>
              <div className="cmu-mrow">{b.posts.map((k, j) => card(k, "sq", b.i + j))}</div>
              <div className="cmu-mrow cmu-mbuy">
                {b.posts.map((k) => (
                  <div key={k.post.id}>
                    <BuyButton itemId={k.post.item_id} source={{ kind: "mural", ref: k.post.id }} variant="sm" />
                  </div>
                ))}
              </div>
            </Fragment>
          ) : (
            card(b.posts[0], b.kind, b.i)
          ),
        )}
      </div>
      {canMore ? (
        <button className="cmu-more" onClick={() => void loadMore()} disabled={more === "loading"} aria-busy={more === "loading"}>
          {more === "loading" ? <i className="cmu-spin" aria-hidden /> : ct("seeMore", L)}
        </button>
      ) : (
        <p className="cmu-mfoot">{ct("muralFoot", L)}</p>
      )}
    </>
  );
}

// Foto grande, por cima da camada (sem outro desfoque: um só por camada), com "Compartilhar
// no story" quando o prato ainda está no cardápio.
export function PhotoView({
  photo, onClose, onShare, lang,
}: {
  photo: Photo;
  onClose: () => void;
  onShare: (postId: string) => void;
  lang: string;
}) {
  return (
    <div className="cmu-photo" role="dialog" aria-label={photo.name} onClick={onClose}>
      <img src={photo.src} alt={photo.name} />
      <b>{photo.name}</b>
      {photo.shareable && (
        <div onClick={(e) => e.stopPropagation()}>
          <ShareStoryButton onClick={() => onShare(photo.id)} className="cmu-share-photo" />
        </div>
      )}
      <button className="cmu-x" onClick={onClose} aria-label={ct("photoClose", lang)}>
        <IconClose />
      </button>
    </div>
  );
}
