"use client";
/* eslint-disable @next/next/no-img-element -- capa, logo e círculos já vêm no tamanho certo (sizedSrc) */

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { StatusLabel } from "@/lib/menu/hours";
import { t as tr, type StringKey } from "@/lib/menu/i18n";
import { brandTokens, groupSubgroups, listCats, listPrice } from "@/lib/menu/list";
import { CARD_W, mediaUrl, photoSrc, posterSrc, THUMB_W } from "@/lib/menu/media";
import { sizedSrc } from "@/lib/images/sized";
import type { MenuCategory, MenuMedia, PublicMenu } from "@/lib/menu/types";
import { CartButton } from "../order/cart-button";

// Foto pequena de uma mídia: a própria foto ou o pôster do vídeo.
const still = (m: MenuMedia | null | undefined, w: number) =>
  m ? (m.kind === "photo" ? photoSrc(m, w) : posterSrc(m, w)) : null;

/**
 * Cardápio em lista (visual aprovado pelo João em 19/10, protótipo em docs/prototipos/lista,
 * âncora #ref.faixa-2): capa com a foto se desfazendo no fundo escuro, perfil, busca larga,
 * categorias em círculos, a dica e, em cada categoria, uma faixa com o nome e os pratos só com
 * nome e preço. Tocar no prato abre o story dele (onOpenItem).
 */
export function MenuList({
  menu,
  cats: allCats,
  lang,
  status,
  langPicker,
  tableTag,
  focus,
  onOpenItem,
  onStories,
  hidden,
}: {
  menu: PublicMenu;
  cats: MenuCategory[]; // os mesmos `cats` do MenuAppInner (com Destaques e oferta); a lista filtra com listCats
  lang: string;
  status: StatusLabel | null;
  langPicker: ReactNode; // o mesmo seletor de bandeiras da capa
  tableTag?: ReactNode;
  focus?: { catId: string } | null; // rolar até esta categoria (ao vir do botão de lista do story); um objeto novo a cada pedido
  onOpenItem: (catId: string, itemId: string) => void;
  onStories: () => void;
  hidden: boolean; // story aberto por cima: a lista fica montada (guarda a rolagem) e sai da leitura de tela
}) {
  const { restaurant } = menu;
  const t = (k: StringKey) => tr(k, lang);
  const cats = useMemo(() => listCats(allCats), [allCats]);
  const tokens = brandTokens(restaurant.brand_color);
  const style = { "--brand": tokens.brand, "--brand-text": tokens.brandText, "--on-brand": tokens.onBrand } as CSSProperties;
  const [hintOpen, setHintOpen] = useState(true);
  const secEls = useRef(new Map<string, HTMLElement>());
  // Ao abrir: no topo, ou na categoria pedida. Depois, só rola quando chega um pedido novo (a
  // rolagem é a da página: com o story por cima, a lista fica parada onde o cliente deixou).
  const opened = useRef(false);
  useLayoutEffect(() => {
    const first = !opened.current;
    opened.current = true;
    const sec = focus ? secEls.current.get(focus.catId) : undefined;
    if (sec) sec.scrollIntoView({ block: "start" });
    else if (first) scrollTo(0, 0);
  }, [focus]);

  // Capa: foto ou pôster do vídeo do banner; sem banner, a capa antiga. Sem nenhuma, só o fundo.
  const banner = restaurant.cover;
  const coverImage = banner ? still(banner, CARD_W) : sizedSrc(mediaUrl(restaurant.cover_image_path), CARD_W);
  const logo = sizedSrc(mediaUrl(restaurant.logo_path), THUMB_W);
  const [hintA, hintRest = ""] = t("listHint").split("{b}");
  const [hintB, hintC = ""] = hintRest.split("{/b}");

  // A dica fecha ao abrir um prato e sairia de cima dos pratos, puxando a lista para cima:
  // guarda onde a linha tocada estava na tela e devolve a rolagem, para "‹ Lista" voltar
  // exatamente ao mesmo ponto.
  const anchor = useRef<{ el: HTMLElement; top: number } | null>(null);
  const openItem = (catId: string, itemId: string, el: HTMLElement) => {
    if (hintOpen) anchor.current = { el, top: el.getBoundingClientRect().top };
    setHintOpen(false);
    onOpenItem(catId, itemId);
  };
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    if (a) scrollBy(0, a.el.getBoundingClientRect().top - a.top);
  }, [hintOpen]);

  return (
    <div className="cm-list" style={style} aria-hidden={hidden || undefined} inert={hidden}>
      <div className={`cover-wrap${coverImage ? "" : " bare"}`}>
        {coverImage && (
          <div className="cover">
            <img src={coverImage} alt="" />
          </div>
        )}
        {/* Fora da .cover: a máscara dela apagaria a coluna de bandeiras aberta. */}
        <div className="cover-top">
          <button className="pill-btn glass" onClick={onStories} aria-label={t("viewStories")}>
            <svg className="icon" viewBox="0 0 24 24" aria-hidden>
              <rect x="6" y="3" width="12" height="18" rx="3" />
              <path d="M10.5 9.5v5l4-2.5z" />
            </svg>
            {t("viewStories")}
          </button>
          {tableTag}
          <span className="cover-r">
            <CartButton inViewer={false} className="round glass" />
            {langPicker}
          </span>
        </div>
      </div>

      <main className="wrap">
        <div className={`profile${logo ? "" : " nologo"}`}>
          {logo && (
            <div className="logo">
              <img src={logo} alt="" />
            </div>
          )}
          <div className="who">
            <h1 className="fd">{restaurant.name}</h1>
            {restaurant.opening_hours && status && (
              <div className="status">
                <b className={status.open ? "is-open" : undefined}>{status.state}</b>
                {status.detail && <span>· {status.detail}</span>}
              </div>
            )}
            {restaurant.address && (
              <div className="address">
                <svg className="icon" viewBox="0 0 24 24" aria-hidden>
                  <path d="M12 21s7-6.2 7-11.5a7 7 0 0 0-14 0C5 14.8 12 21 12 21z" />
                  <circle cx="12" cy="9.5" r="2.5" />
                </svg>
                {restaurant.address}
              </div>
            )}
          </div>
          <div className="actions">
            {/* A camada da busca chega na Tarefa 8. */}
            <button className="search-pill">
              <svg className="icon" viewBox="0 0 24 24" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.6-3.6" />
              </svg>
              {t("listSearch")}
            </button>
          </div>
        </div>

        {cats.length > 0 && (
          <>
            <div className="sec-title cats-title">
              <h2 className="fd">{t("listCats")}</h2>
            </div>
            <nav className="cats" aria-label={t("listCats")}>
              {cats.map((c) => {
                const img = still(c.cover, THUMB_W);
                return (
                  <button
                    key={c.id}
                    className="cat"
                    onClick={() => secEls.current.get(c.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  >
                    <span className="ring">
                      {img ? <img src={img} alt="" loading="lazy" /> : <span className="mono fd">{[...c.name][0]}</span>}
                    </span>
                    <span className="name">{c.name}</span>
                  </button>
                );
              })}
            </nav>
          </>
        )}

        {hintOpen && cats.length > 0 && (
          <div className="hint" role="note">
            <span className="hi" aria-hidden>
              <svg className="icon" viewBox="0 0 24 24">
                <rect x="3.5" y="5" width="17" height="14" rx="3" />
                <circle cx="9" cy="10" r="1.6" />
                <path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" />
              </svg>
            </span>
            <span>
              {hintA}
              <b>{hintB}</b>
              {hintC}
            </span>
            <button className="x" onClick={() => setHintOpen(false)} aria-label={t("listHintClose")}>
              <svg className="icon" viewBox="0 0 24 24" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        )}

        {cats.map((c) => {
          const n = c.items.length;
          return (
            <section
              key={c.id}
              className="cat-sec"
              ref={(el) => {
                if (el) secEls.current.set(c.id, el);
                else secEls.current.delete(c.id);
              }}
            >
              <div className="sec-title">
                <h2 className="fd">{c.name}</h2>
                <small>
                  {n} {t(n === 1 ? "item" : "items")}
                  <svg className="icon" viewBox="0 0 24 24" aria-hidden>
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </small>
              </div>
              <div className="grid">
                {groupSubgroups(c.items).flatMap((g) => [
                  g.label && (
                    <div key={`g:${g.label}`} className="subgroup">
                      <span>{g.label}</span>
                    </div>
                  ),
                  ...g.items.map((it) => {
                    const p = listPrice(it, lang);
                    return (
                      <button key={it.id} className="trow" onClick={(e) => openItem(c.id, it.id, e.currentTarget)}>
                        <span className="nm fd">{it.name}</span>
                        {/* Preço escondido: nada à direita, mas o toque ainda abre o story. */}
                        {p && (
                          <span className="price">
                            {p.from && <span className="ate">{t("from")}</span>}
                            {p.old && <s>{p.old}</s>}
                            {p.now}
                          </span>
                        )}
                      </button>
                    );
                  }),
                ])}
              </div>
            </section>
          );
        })}
        <div className="end" />
      </main>
    </div>
  );
}
