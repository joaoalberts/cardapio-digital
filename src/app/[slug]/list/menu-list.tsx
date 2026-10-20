"use client";
/* eslint-disable @next/next/no-img-element -- capa, logo e círculos já vêm no tamanho certo (sizedSrc) */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import type { StatusLabel } from "@/lib/menu/hours";
import { t as tr, type StringKey } from "@/lib/menu/i18n";
import { activeIndex, brandTokens, groupSubgroups, hintSeen, HINT_KEY, listCats, listPrice, searchItems } from "@/lib/menu/list";
import { CARD_W, mediaUrl, photoSrc, posterSrc, THUMB_W } from "@/lib/menu/media";
import { sizedSrc } from "@/lib/images/sized";
import type { MenuCategory, MenuItem, MenuMedia, PublicMenu } from "@/lib/menu/types";
import { CartButton } from "../order/cart-button";
import { useVisible } from "./use-visible";

// Foto pequena de uma mídia: a própria foto ou o pôster do vídeo.
const still = (m: MenuMedia | null | undefined, w: number) =>
  m ? (m.kind === "photo" ? photoSrc(m, w) : posterSrc(m, w)) : null;

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Pílula ativa no meio da faixa, rolando só a faixa (como o centerTab dos stories): nunca a página.
function centerChip(bar: HTMLElement | null, i: number) {
  const chip = bar?.children[i] as HTMLElement | undefined;
  if (!bar || !chip) return;
  const left = chip.offsetLeft - (bar.clientWidth - chip.offsetWidth) / 2;
  bar.scrollTo({ left, behavior: reducedMotion() ? "auto" : "smooth" });
}

/**
 * Cardápio em lista (visual aprovado pelo João em 19/10, protótipo em docs/prototipos/lista,
 * âncora #ref.faixa-2): capa com a foto se desfazendo no fundo escuro, perfil, busca larga,
 * categorias em círculos, a dica e, em cada categoria, uma faixa com o nome e os pratos só com
 * nome e preço. Tocar no prato abre o story dele (onOpenItem). Ao rolar, a barra fixa (nome,
 * busca, carrinho, stories e as pílulas das categorias) assume quando os círculos saem da tela.
 */
export function MenuList({
  menu,
  cats: allCats,
  lang,
  status,
  langPicker,
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
  // A dica entra só depois de ler o localStorage (o servidor e a 1ª pintura não a mostram).
  const [hintOpen, setHintOpen] = useState(false);
  useLayoutEffect(() => {
    let seen = false;
    try {
      seen = hintSeen(localStorage.getItem(HINT_KEY));
    } catch {}
    if (!seen) queueMicrotask(() => setHintOpen(true));
  }, []);
  const closeHint = () => {
    setHintOpen(false);
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {}
  };
  const secEls = useRef(new Map<string, HTMLElement>());
  const headRef = useRef<HTMLElement>(null);
  const catsRef = useRef<HTMLElement>(null);
  const chipsRef = useRef<HTMLElement>(null);
  const [showHead, setShowHead] = useState(false);
  const [active, setActive] = useState(-1); // categoria ativa (-1: nenhuma passou da linha ainda)
  const [searchOpen, setSearchOpen] = useState(false);
  const searchFrom = useRef<HTMLElement | null>(null); // o botão que abriu a busca recebe o foco de volta
  const openSearch = (e: MouseEvent<HTMLElement>) => {
    searchFrom.current = e.currentTarget;
    setSearchOpen(true);
  };
  const closeSearch = () => {
    setSearchOpen(false);
    searchFrom.current?.focus({ preventScroll: true });
  };

  // Barra fixa e categoria ativa, medidas uma vez por quadro durante a rolagem. A linha fica 24 px
  // abaixo da barra: a seção que acabou de entrar embaixo dela já conta (sem a ativa "uma atrás");
  // no fim da página, a última.
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const circles = catsRef.current?.getBoundingClientRect().top ?? Infinity;
      setShowHead(circles < 20); // os círculos começaram a sair: a barra compacta assume
      const line = (headRef.current?.offsetHeight ?? 0) + 24;
      const tops = cats.map((c) => secEls.current.get(c.id)?.getBoundingClientRect().top ?? Infinity);
      const atEnd = scrollY > 0 && scrollY + innerHeight >= document.documentElement.scrollHeight - 2;
      setActive(activeIndex(tops, line, atEnd));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [cats]);
  useEffect(() => centerChip(chipsRef.current, active), [active]);

  // Pílula ou círculo: rola até a seção; o scroll-margin-top dela (list.css) desconta a barra fixa.
  const goTo = (catId: string) =>
    secEls.current.get(catId)?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
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
  // Vindo da busca, a linha tocada está na camada: a âncora é a primeira categoria da lista
  // (abaixo da dica), para a lista atrás da busca também ficar no mesmo ponto.
  const hintRef = useRef<HTMLDivElement>(null);
  const hintVisible = useVisible(hintRef, hintOpen);
  // Os brilhos só rodam com a lista à vista: nada anima com o story ou a busca por cima.
  const live = !hidden && !searchOpen;
  const anchor = useRef<{ el: HTMLElement; top: number } | null>(null);
  const openItem = (catId: string, itemId: string, el: HTMLElement | undefined) => {
    if (hintOpen && el) anchor.current = { el, top: el.getBoundingClientRect().top };
    closeHint();
    onOpenItem(catId, itemId);
  };
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    if (a?.el.isConnected) scrollBy(0, a.el.getBoundingClientRect().top - a.top);
  }, [hintOpen]);
  const openFromSearch = (catId: string, itemId: string) => openItem(catId, itemId, secEls.current.get(cats[0]?.id));

  return (
    <div className="cm-list" style={style} aria-hidden={hidden || undefined} inert={hidden}>
      {/* Barra fixa: fica montada (para medir a altura) e desce quando os círculos saem da tela. */}
      <header ref={headRef} className={`head${showHead ? " show" : ""}`} inert={!showHead} aria-hidden={!showHead || undefined}>
        <div className="wrap bar">
          <span className="title fd">{restaurant.name}</span>
          <button className="round" onClick={openSearch} aria-label={t("listSearch")}>
            <svg className="icon" viewBox="0 0 24 24" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.6-3.6" />
            </svg>
          </button>
          <CartButton inViewer={false} className="round" />
          <button className="round" onClick={onStories} aria-label={t("viewStories")}>
            <svg className="icon" viewBox="0 0 24 24" aria-hidden>
              <rect x="6" y="3" width="12" height="18" rx="3" />
              <path d="M10.5 9.5v5l4-2.5z" />
            </svg>
          </button>
        </div>
        <nav ref={chipsRef} className="chips" aria-label={t("listCats")}>
          {cats.map((c, i) => {
            const img = still(c.cover, THUMB_W);
            return (
              <button key={c.id} className={`chip${i === active ? " on" : ""}`} onClick={() => goTo(c.id)}>
                {img ? <img src={img} alt="" loading="lazy" /> : <i className="fd">{[...c.name][0]}</i>}
                {c.name}
              </button>
            );
          })}
        </nav>
      </header>

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
            <button className="search-pill" onClick={openSearch}>
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
            <nav ref={catsRef} className="cats" aria-label={t("listCats")}>
              {cats.map((c, i) => {
                const img = still(c.cover, THUMB_W);
                return (
                  <button key={c.id} className={`cat${i === active ? " on" : ""}`} onClick={() => goTo(c.id)}>
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
          <div className="hint" role="note" ref={hintRef} data-live={hintVisible && live ? "" : undefined}>
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
            <button className="x" onClick={closeHint} aria-label={t("listHintClose")}>
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
              <SecTitle name={c.name} still={live}>
                {n} {t(n === 1 ? "item" : "items")}
              </SecTitle>
              <div className="grid">
                {groupSubgroups(c.items).flatMap((g) => [
                  g.label && (
                    <div key={`g:${g.label}`} className="subgroup">
                      <span>{g.label}</span>
                    </div>
                  ),
                  ...g.items.map((it) => {
                    return (
                      <button key={it.id} className="trow" onClick={(e) => openItem(c.id, it.id, e.currentTarget)}>
                        <span className="nm fd">{it.name}</span>
                        <RowPrice item={it} lang={lang} />
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

      {searchOpen && <SearchLayer cats={cats} lang={lang} onOpenItem={openFromSearch} onClose={closeSearch} />}
    </div>
  );
}

// Faixa da categoria; o brilho só roda (data-live) enquanto ela está na tela.
function SecTitle({ name, still, children }: { name: string; still: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useVisible(ref);
  return (
    <div className="sec-title" ref={ref} data-live={visible && still ? "" : undefined}>
      <h2 className="fd">{name}</h2>
      <small>
        {children}
        <svg className="icon" viewBox="0 0 24 24" aria-hidden>
          <path d="m9 6 6 6-6 6" />
        </svg>
      </small>
    </div>
  );
}

// À direita da linha do prato. Preço escondido: nada, mas o toque ainda abre o story.
function RowPrice({ item, lang }: { item: MenuItem; lang: string }) {
  const p = listPrice(item, lang);
  if (!p) return null;
  return (
    <span className="price">
      {p.from && <span className="ate">{tr("from", lang)}</span>}
      {p.old && <s>{p.old}</s>}
      {p.now}
    </span>
  );
}

/**
 * Busca: camada por cima da lista com o campo, "voltar" e os pratos achados (a mesma linha da
 * lista, com o nome da categoria pequeno acima). A lista fica parada atrás (list.css trava a
 * rolagem da página), então "voltar" devolve ao mesmo ponto. Tocar num prato abre o story; a
 * busca fica por baixo e "‹ Lista" volta aos resultados.
 */
function SearchLayer({
  cats,
  lang,
  onOpenItem,
  onClose,
}: {
  cats: MenuCategory[];
  lang: string;
  onOpenItem: (catId: string, itemId: string) => void;
  onClose: () => void;
}) {
  const t = (k: StringKey) => tr(k, lang);
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const shown = q.trim().replace(/\s+/g, " ");
  const found = useMemo(() => searchItems(cats, q, lang), [cats, q, lang]);
  return (
    <div className="search" role="dialog" aria-modal="true" aria-label={t("listSearch")} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="wrap search-wrap">
        <div className="search-head">
          <div className="row">
            <button className="round" onClick={onClose} aria-label={t("back")}>
              <svg className="icon" viewBox="0 0 24 24" aria-hidden>
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
            <h2 className="fd">{t("listSearch")}</h2>
            <span />
          </div>
          {/* Enter (ou "Buscar" no teclado do celular) só fecha o teclado: a busca já anda a cada letra. */}
          <form
            className="field"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              input.current?.blur();
            }}
          >
            <svg className="icon" viewBox="0 0 24 24" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.6-3.6" />
            </svg>
            <input
              ref={input}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("searchPlaceholder")}
              aria-label={t("listSearch")}
              enterKeyHint="search"
              autoComplete="off"
              autoFocus
            />
            {q && (
              <button
                type="button"
                className="clear"
                onClick={() => {
                  setQ("");
                  input.current?.focus();
                }}
                aria-label={t("searchClear")}
              >
                <svg className="icon" viewBox="0 0 24 24" aria-hidden>
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            )}
          </form>
        </div>

        <div aria-live="polite">
          {!shown ? (
            <p className="note">{t("searchHint")}</p>
          ) : found.length ? (
            <p className="note">{t("searchCount").replace("{q}", () => shown).replace("{n}", () => String(found.length))}</p>
          ) : (
            <p className="empty">{t("searchEmpty").replace("{q}", () => shown)}</p>
          )}
        </div>
        {found.length > 0 && (
          <div className="grid">
            {found.map(({ cat, item }) => (
              <button key={`${cat.id}:${item.id}`} className="trow found" onClick={() => onOpenItem(cat.id, item.id)}>
                <span className="txt">
                  <small>{cat.name}</small>
                  <span className="nm fd">{item.name}</span>
                </span>
                <RowPrice item={item} lang={lang} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
